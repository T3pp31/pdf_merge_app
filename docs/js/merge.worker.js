// Module Web Worker that runs PDF load/copy/save off the main thread.
// It shares docs/js/merge-core.js with the Node tests, so the merge logic is
// identical whether it runs in the browser worker or in the benchmark.
//
// pdf-lib is loaded from the same CDN build the rest of the app has always used
// (v1.17.1), but as an ES module so this file can be a module worker.
import { mergePdfBytes } from './merge-core.js';
import { PDFDocument } from 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.esm.js';

self.onmessage = async (event) => {
    const { arrayBuffers, names } = event.data;

    try {
        const { bytes, pageCount } = await mergePdfBytes(arrayBuffers, names, PDFDocument, {
            onFile: (current, total, name) => {
                self.postMessage({ type: 'progress', current, total, name });
            },
            onSaving: () => {
                self.postMessage({ type: 'saving' });
            },
        });
        // save() returns a Uint8Array; the transferable is its underlying ArrayBuffer.
        const transferList =
            bytes && bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
        self.postMessage({ type: 'done', bytes, pageCount }, transferList);
    } catch (err) {
        if (err && err.kind === 'load') {
            self.postMessage({ type: 'error', kind: 'load', name: err.name, message: err.message });
        } else {
            self.postMessage({ type: 'error', kind: 'merge', message: err ? err.message : 'Unknown error' });
        }
    }
};
