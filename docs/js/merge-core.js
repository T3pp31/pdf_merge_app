// Pure merge core shared by the browser Web Worker and the Node benchmark/tests.
// It is intentionally dependency-free: the PDFDocument class is injected via DI so
// the same code runs against the CDN build (worker) and the npm build (Node).
//
// Observable behavior is preserved by mirroring the original mergePdfs loop exactly:
//   - one merged target document created up front
//   - per file: progress callback, then load (throwing on failure with the file name),
//     then copyPages over every page index, then addPage in order
//   - saving callback, then save() (default options), then getPageCount()

// Error shape thrown when a single source PDF fails to load.
export function createLoadError(name, message) {
    const err = new Error(message || 'Failed to load PDF');
    err.kind = 'load';
    err.name = name;
    err.message = message || 'Failed to load PDF';
    return err;
}

export async function mergePdfBytes(arrayBuffers, names, PDFDocument, handlers = {}) {
    const total = arrayBuffers.length;
    const onFile = handlers.onFile;
    const onSaving = handlers.onSaving;

    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < total; i++) {
        if (onFile) onFile(i + 1, total, names[i]);

        let sourcePdf;
        try {
            sourcePdf = await PDFDocument.load(arrayBuffers[i]);
        } catch (loadErr) {
            throw createLoadError(names[i], loadErr.message);
        }

        const pageIndices = sourcePdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);
        for (const page of copiedPages) {
            mergedPdf.addPage(page);
        }
    }

    if (onSaving) onSaving();

    const bytes = await mergedPdf.save();
    return { bytes, pageCount: mergedPdf.getPageCount() };
}
