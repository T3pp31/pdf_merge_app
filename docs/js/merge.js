export const MAX_FILES = 20;

export function formatFileSize(bytes) {
    if (bytes >= 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    return (bytes / 1024).toFixed(1) + ' KB';
}

function buildTimestampFilename() {
    const now = new Date();
    const timestamp = now.getFullYear().toString()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0')
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
    return 'merged_' + timestamp + '.pdf';
}

// Reads every file's bytes up front in parallel, then hands the buffers to the
// Web Worker which runs load/copyPages/addPage/save off the main thread.
// The Worker's protocol is:
//   {type:'progress', current, total, name}  before each file is processed
//   {type:'saving'}                          after all files, before save()
//   {type:'done', bytes, pageCount}          after save()
//   {type:'error', kind:'load', name, message}  when a source PDF fails to load
//   {type:'error', kind:'merge', message}     for any other failure
// The main thread mirrors the original mergePdfs callback order exactly.
export async function mergePdfs(files, callbacks) {
    const { onProgress, onStatus } = callbacks;

    if (files.length === 0) {
        onStatus('status.noFiles', {}, 'error');
        return null;
    }

    onStatus('status.loading', {});
    const total = files.length;

    // When a specific error status (e.g. 'status.error.load') is already emitted by the
    // Worker bridge below, the generic catch must not emit a second status. This mirrors
    // the original mergePdfs, which emits exactly one terminal status per failure.
    const state = { statusEmitted: false };

    try {
        const arrayBuffers = await Promise.all(files.map((file) => file.arrayBuffer()));
        const names = files.map((file) => file.name);

        const { bytes, pageCount } = await runInWorker(arrayBuffers, names, {
            onProgress,
            onStatus,
            total,
            state,
        });

        const blob = new Blob([bytes], { type: 'application/pdf' });

        return {
            blob,
            pageCount,
            filename: buildTimestampFilename(),
            sizeLabel: formatFileSize(blob.size),
        };
    } catch (err) {
        if (!state.statusEmitted) {
            onStatus('status.error.merge', { message: err.message }, 'error');
        }
        return null;
    }
}

// Bridges the Worker message stream back onto the UI callbacks, preserving the
// original per-file order: onProgress(current,total) then onStatus('status.processing').
function runInWorker(arrayBuffers, names, { onProgress, onStatus, total, state }) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./merge.worker.js', import.meta.url), { type: 'module' });
        // Only ArrayBuffers are transferable; File.arrayBuffer() resolves to one, but
        // filtering keeps the transfer list valid if a buffer is a typed view.
        const transfer = arrayBuffers.filter((buffer) => buffer instanceof ArrayBuffer);

        worker.onmessage = (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'progress':
                    onProgress(msg.current, msg.total);
                    onStatus('status.processing', { current: msg.current, total: msg.total, name: msg.name });
                    break;
                case 'saving':
                    onStatus('status.saving', {});
                    onProgress(total, total);
                    break;
                case 'done':
                    cleanup();
                    resolve({ bytes: msg.bytes, pageCount: msg.pageCount });
                    break;
                case 'error':
                    cleanup();
                    state.statusEmitted = true;
                    if (msg.kind === 'load') {
                        onStatus('status.error.load', { name: msg.name, message: msg.message }, 'error');
                    } else {
                        onStatus('status.error.merge', { message: msg.message }, 'error');
                    }
                    reject(new Error(msg.message));
                    break;
            }
        };

        worker.onerror = (event) => {
            cleanup();
            reject(new Error(event.message || 'Worker error'));
        };

        const cleanup = () => worker.terminate();

        worker.postMessage(
            { arrayBuffers, names },
            transfer,
        );
    });
}
