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

export async function mergePdfs(files, callbacks) {
    const { onProgress, onStatus } = callbacks;

    if (files.length === 0) {
        onStatus('status.noFiles', {}, 'error');
        return null;
    }

    onStatus('status.loading', {});

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();
        const total = files.length;

        for (let i = 0; i < total; i++) {
            const file = files[i];
            const current = i + 1;

            onProgress(current, total);
            onStatus('status.processing', { current, total, name: file.name });

            const arrayBuffer = await file.arrayBuffer();

            let sourcePdf;
            try {
                sourcePdf = await PDFDocument.load(arrayBuffer);
            } catch (loadErr) {
                onStatus('status.error.load', { name: file.name, message: loadErr.message }, 'error');
                return null;
            }

            const pageIndices = sourcePdf.getPageIndices();
            const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        onStatus('status.saving', {});
        onProgress(total, total);

        const mergedBytes = await mergedPdf.save();
        const blob = new Blob([mergedBytes], { type: 'application/pdf' });
        const pageCount = mergedPdf.getPageCount();

        return {
            blob,
            pageCount,
            filename: buildTimestampFilename(),
            sizeLabel: formatFileSize(blob.size),
        };
    } catch (err) {
        onStatus('status.error.merge', { message: err.message }, 'error');
        return null;
    }
}
