// Differential / behavior-preservation tests.
//
// These confirm that the refactored merge path (parallel I/O + shared core +
// Worker bridge) preserves the observable behavior of the original mergePdfs:
//   - identical output bytes for a given set of inputs (normal + boundary)
//   - identical status/progress callback ordering and content
//   - identical terminal status on the corrupted-file path (status.error.load
//     with the right name/message, and no extra status.error.merge)
//
// The browser Web Worker cannot run under Node, so mergePdfs is exercised with a
// Worker stub that replays the exact protocol the real worker implements
// (progress / saving / done / error) using the same shared core. This validates
// the main-thread bridge without a DOM.
//
// Run:  node --test bench/
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { mergePdfBytes } from '../docs/js/merge-core.js';
import { mergePdfs, formatFileSize, MAX_FILES } from '../docs/js/merge.js';

// --- fixtures ---------------------------------------------------------------

async function makePdfBytes(seed, pages = 1) {
    const doc = await PDFDocument.create();
    for (let p = 0; p < pages; p++) {
        const page = doc.addPage([595.28, 841.89]);
        page.drawText(`${seed} page ${p}`, { x: 40, y: 700, size: 11 });
    }
    return doc.save();
}

function makeFile(bytes, name) {
    return {
        name,
        size: bytes.length,
        arrayBuffer: async () => bytes,
    };
}

// --- reference (original) implementation ------------------------------------

// Replicates the pre-optimization mergePdfs core loop so we can compare bytes.
async function legacyMergeBytes(bytesList) {
    const merged = await PDFDocument.create();
    for (const b of bytesList) {
        const src = await PDFDocument.load(b);
        const idx = src.getPageIndices();
        const copied = await merged.copyPages(src, idx);
        copied.forEach((p) => merged.addPage(p));
    }
    return merged.save();
}

// --- Worker stub that replays the real worker protocol ----------------------

// Sets globalThis.Worker to a class that, on postMessage, runs the shared core
// and emits the same message stream the browser worker would.
function installWorkerStub() {
    globalThis.Worker = class Worker {
        postMessage(msg) {
            const { arrayBuffers, names } = msg;
            // Defer so onmessage is registered before messages fire.
            queueMicrotask(async () => {
                try {
                    const { bytes, pageCount } = await mergePdfBytes(arrayBuffers, names, PDFDocument, {
                        onFile: (current, total, name) => {
                            this.onmessage({ data: { type: 'progress', current, total, name } });
                        },
                        onSaving: () => {
                            this.onmessage({ data: { type: 'saving' } });
                        },
                    });
                    this.onmessage({ data: { type: 'done', bytes, pageCount } });
                } catch (err) {
                    if (err && err.kind === 'load') {
                        this.onmessage({ data: { type: 'error', kind: 'load', name: err.name, message: err.message } });
                    } else {
                        this.onmessage({ data: { type: 'error', kind: 'merge', message: err ? err.message : 'Unknown error' } });
                    }
                }
            });
        }
        terminate() {}
    };
}

function uninstallWorkerStub() {
    delete globalThis.Worker;
}

// Records onStatus/onProgress call sequences for assertion.
function recorders() {
    const statuses = [];
    const progresses = [];
    return {
        statuses,
        progresses,
        callbacks: {
            onProgress: (current, total) => progresses.push([current, total]),
            onStatus: (key, vars = {}, type = null) => statuses.push({ key, vars, type }),
        },
    };
}

// --- tests ------------------------------------------------------------------

test('output bytes are identical: 3-file merge (normal)', async () => {
    const [a, b, c] = await Promise.all([makePdfBytes('A', 2), makePdfBytes('B', 3), makePdfBytes('C', 1)]);
    const expected = await legacyMergeBytes([a, b, c]);

    const result = await mergePdfBytes([a, b, c], ['a.pdf', 'b.pdf', 'c.pdf'], PDFDocument);
    assert.deepEqual(Buffer.from(result.bytes), Buffer.from(expected));
    assert.equal(result.pageCount, 6);
});

test('output bytes are identical: single file (boundary)', async () => {
    const a = await makePdfBytes('solo', 4);
    const expected = await legacyMergeBytes([a]);

    const result = await mergePdfBytes([a], ['solo.pdf'], PDFDocument);
    assert.deepEqual(Buffer.from(result.bytes), Buffer.from(expected));
    assert.equal(result.pageCount, 4);
});

test('output bytes are identical: minimal file merged with others (boundary)', async () => {
    // pdf-lib's create() yields a 1-page PDF; treat it as the minimal source.
    const minimal = await PDFDocument.create().then((d) => d.save());
    const a = await makePdfBytes('after', 2);
    const expected = await legacyMergeBytes([minimal, a]);

    const result = await mergePdfBytes([minimal, a], ['minimal.pdf', 'after.pdf'], PDFDocument);
    assert.deepEqual(Buffer.from(result.bytes), Buffer.from(expected));
    assert.equal(result.pageCount, 3); // 1 (minimal) + 2 (after)
});

test('output bytes are identical: 20 files (boundary MAX_FILES)', async () => {
    assert.equal(MAX_FILES, 20);
    const sources = [];
    for (let i = 0; i < MAX_FILES; i++) {
        sources.push(await makePdfBytes(`f${i}`, 1));
    }
    const expected = await legacyMergeBytes(sources);

    const names = sources.map((_, i) => `f${i}.pdf`);
    const result = await mergePdfBytes(sources, names, PDFDocument);
    assert.deepEqual(Buffer.from(result.bytes), Buffer.from(expected));
    assert.equal(result.pageCount, 20);
});

test('status/progress order preserved on a normal merge', async () => {
    installWorkerStub();
    try {
        const [a, b, c] = await Promise.all([makePdfBytes('A'), makePdfBytes('B'), makePdfBytes('C')]);
        const files = [makeFile(a, 'a.pdf'), makeFile(b, 'b.pdf'), makeFile(c, 'c.pdf')];
        const rec = recorders();

        const result = await mergePdfs(files, rec.callbacks);

        assert.ok(result, 'merge should succeed');
        assert.equal(result.pageCount, 3);

        const keys = rec.statuses.map((s) => s.key);
        assert.deepEqual(keys, [
            'status.loading',
            'status.processing',
            'status.processing',
            'status.processing',
            'status.saving',
        ]);

        assert.deepEqual(rec.progresses, [
            [1, 3],
            [2, 3],
            [3, 3],
            [3, 3],
        ]);

        // processing entries carry the correct name and index
        assert.equal(rec.statuses[1].vars.name, 'a.pdf');
        assert.equal(rec.statuses[1].vars.current, 1);
        assert.equal(rec.statuses[2].vars.name, 'b.pdf');
        assert.equal(rec.statuses[3].vars.name, 'c.pdf');
    } finally {
        uninstallWorkerStub();
    }
});

test('corrupted file mid-list emits status.error.load with name and no extra merge error (abnormal)', async () => {
    installWorkerStub();
    try {
        const a = await makePdfBytes('A');
        const bad = new TextEncoder().encode('this is not a pdf');
        const files = [makeFile(a, 'good.pdf'), makeFile(bad, 'bad.pdf')];
        const rec = recorders();

        const result = await mergePdfs(files, rec.callbacks);

        assert.equal(result, null);
        const keys = rec.statuses.map((s) => s.key);
        assert.deepEqual(keys, [
            'status.loading',
            'status.processing',
            'status.processing',
            'status.error.load',
        ]);

        const loadErr = rec.statuses.find((s) => s.key === 'status.error.load');
        assert.equal(loadErr.vars.name, 'bad.pdf');
        assert.equal(loadErr.type, 'error');
        assert.ok(typeof loadErr.vars.message === 'string' && loadErr.vars.message.length > 0);

        // the corrupted file's load error message must match a direct load attempt
        let directMessage;
        try {
            await PDFDocument.load(bad);
        } catch (e) {
            directMessage = e.message;
        }
        assert.equal(loadErr.vars.message, directMessage);
    } finally {
        uninstallWorkerStub();
    }
});

test('empty file list emits status.noFiles and returns null (boundary)', async () => {
    installWorkerStub();
    try {
        const rec = recorders();
        const result = await mergePdfs([], rec.callbacks);
        assert.equal(result, null);
        assert.deepEqual(rec.statuses.map((s) => s.key), ['status.noFiles']);
        assert.equal(rec.statuses[0].type, 'error');
        assert.deepEqual(rec.progresses, []);
    } finally {
        uninstallWorkerStub();
    }
});

test('result object shape and size label are preserved', async () => {
    installWorkerStub();
    try {
        const a = await makePdfBytes('A', 2);
        const files = [makeFile(a, 'a.pdf')];
        const rec = recorders();
        const result = await mergePdfs(files, rec.callbacks);

        assert.ok(result);
        assert.equal(typeof result.filename, 'string');
        assert.match(result.filename, /^merged_\d{14}\.pdf$/);
        assert.ok(result.blob instanceof Blob);
        assert.equal(result.blob.type, 'application/pdf');
        assert.equal(typeof result.sizeLabel, 'string');
        assert.equal(result.sizeLabel, formatFileSize(result.blob.size));
    } finally {
        uninstallWorkerStub();
    }
});

test('formatFileSize is unchanged (regression)', () => {
    assert.equal(formatFileSize(512), '0.5 KB');
    assert.equal(formatFileSize(1024), '1.0 KB');
    assert.equal(formatFileSize(1048576), '1.0 MB');
    assert.equal(formatFileSize(2 * 1024 * 1024 + 524288), '2.5 MB');
});

test('progress current/total never exceed the file count', async () => {
    installWorkerStub();
    try {
        const sources = [];
        for (let i = 0; i < 5; i++) sources.push(await makePdfBytes(`f${i}`));
        const files = sources.map((b, i) => makeFile(b, `f${i}.pdf`));
        const rec = recorders();
        await mergePdfs(files, rec.callbacks);
        for (const [current, total] of rec.progresses) {
            assert.ok(current >= 1 && current <= 5, `current out of range: ${current}`);
            assert.equal(total, 5);
        }
    } finally {
        uninstallWorkerStub();
    }
});
