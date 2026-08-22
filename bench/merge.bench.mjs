// Benchmark: compares the original sequential merge path against the new
// parallel-I/O + shared-core path.
//
// Two things are measured:
//   1. Wall-clock merge time (old sequential I/O vs new parallel I/O), where the
//      per-file read is simulated with a fixed latency to model file.arrayBuffer().
//   2. A breakdown of the CPU hot path (parse / copy / save) for a realistic batch,
//      so we can see which stage dominates (todo 6).
//
// Run:  node bench/merge.bench.mjs
import { PDFDocument } from 'pdf-lib';
import { mergePdfBytes } from '../docs/js/merge-core.js';

// --- input generation -------------------------------------------------------

// Builds `count` PDFs each with `pagesPerFile` pages, and returns their byte arrays.
// The content varies per file so copyPages has real work to do.
async function makeSourceBytes(count, pagesPerFile) {
    const sources = [];
    for (let f = 0; f < count; f++) {
        const doc = await PDFDocument.create();
        for (let p = 0; p < pagesPerFile; p++) {
            const page = doc.addPage([595.28, 841.89]); // A4
            page.drawText(`file ${f} page ${p} of ${pagesPerFile}`, { x: 40, y: 700, size: 11 });
            page.drawText(
                'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod ' +
                'tempor incididunt ut labore et dolore magna aliqua.',
                { x: 40, y: 670, size: 10 },
            );
        }
        sources.push(await doc.save());
    }
    return sources;
}

// Simulates a File whose arrayBuffer() resolves after `delayMs`.
function makeFakeFile(bytes, name, delayMs) {
    return {
        name,
        size: bytes.length,
        arrayBuffer: () => new Promise((resolve) => setTimeout(() => resolve(bytes), delayMs)),
    };
}

// --- reference implementation (original behavior) ---------------------------

// Mirrors the pre-optimization mergePdfs body: sequential read, then sequential
// load/copyPages/addPage, then save.
async function legacyMerge(files) {
    const merged = await PDFDocument.create();
    for (const file of files) {
        const arrayBuffer = await file.arrayBuffer(); // sequential I/O
        const sourcePdf = await PDFDocument.load(arrayBuffer);
        const pageIndices = sourcePdf.getPageIndices();
        const copiedPages = await merged.copyPages(sourcePdf, pageIndices);
        copiedPages.forEach((page) => merged.addPage(page));
    }
    return merged.save();
}

// --- timing helpers ---------------------------------------------------------

function nowMs() {
    return Number(process.hrtime.bigint() / 1000000n);
}

async function timeIt(fn, label) {
    const start = nowMs();
    const result = await fn();
    const elapsed = nowMs() - start;
    return { label, elapsed, result };
}

// --- benchmark runs ---------------------------------------------------------

async function run() {
    const COUNT = 20; // MAX_FILES
    const PAGES_PER_FILE = 4;
    const IO_DELAY_MS = 40; // simulated per-file read latency

    const sources = await makeSourceBytes(COUNT, PAGES_PER_FILE);
    const files = sources.map((bytes, i) => makeFakeFile(bytes, `file_${i}.pdf`, IO_DELAY_MS));

    // Warmup so module init / JIT don't skew the first measured run.
    await legacyMerge(files);
    await mergePdfBytes(sources, files.map((f) => f.name), PDFDocument);

    const WARMUP = 1;
    const ITER = 5;

    // 1) End-to-end wall-clock: old sequential I/O vs new parallel I/O + core.
    const oldRuns = [];
    for (let i = 0; i <= ITER; i++) {
        if (i < WARMUP) {
            await legacyMerge(files);
        } else {
            oldRuns.push(await timeIt(() => legacyMerge(files), 'old'));
        }
    }

    const newRuns = [];
    for (let i = 0; i <= ITER; i++) {
        if (i < WARMUP) {
            await mergePdfBytes(sources, files.map((f) => f.name), PDFDocument);
        } else {
            newRuns.push(
                await timeIt(async () => {
                    const buffers = await Promise.all(files.map((f) => f.arrayBuffer())); // parallel I/O
                    return mergePdfBytes(buffers, files.map((f) => f.name), PDFDocument);
                }, 'new'),
            );
        }
    }

    const avg = (arr) => arr.reduce((s, r) => s + r.elapsed, 0) / arr.length;
    const oldAvg = avg(oldRuns);
    const newAvg = avg(newRuns);
    const speedup = oldAvg / newAvg;

    console.log('='.repeat(60));
    console.log(`Benchmark: ${COUNT} files x ${PAGES_PER_FILE} pages, simulated read ${IO_DELAY_MS}ms/file`);
    console.log('='.repeat(60));
    console.log(`  old (sequential I/O + core)  avg: ${oldAvg.toFixed(1)} ms  ${oldRuns.map((r) => r.elapsed.toFixed(0)).join(', ')}`);
    console.log(`  new (parallel I/O + core)     avg: ${newAvg.toFixed(1)} ms  ${newRuns.map((r) => r.elapsed.toFixed(0)).join(', ')}`);
    console.log(`  speedup: ${speedup.toFixed(2)}x   reduction: ${((1 - newAvg / oldAvg) * 100).toFixed(1)}%`);
    console.log('');

    // 2) CPU hot-path breakdown (no I/O delay): parse vs copy vs save.
    const startParse = nowMs();
    const loaded = [];
    for (const b of sources) loaded.push(await PDFDocument.load(b));
    const parseMs = nowMs() - startParse;

    const target = await PDFDocument.create();
    const startCopy = nowMs();
    for (const src of loaded) {
        const idx = src.getPageIndices();
        const copied = await target.copyPages(src, idx);
        copied.forEach((p) => target.addPage(p));
    }
    const copyMs = nowMs() - startCopy;

    const startSave = nowMs();
    const saved = await target.save();
    const saveMs = nowMs() - startSave;

    const total = parseMs + copyMs + saveMs;
    console.log('='.repeat(60));
    console.log('CPU hot-path breakdown (1 batch, no I/O delay):');
    console.log('='.repeat(60));
    console.log(`  parse (load x${COUNT})     ${parseMs.toFixed(1)} ms  (${((parseMs / total) * 100).toFixed(1)}%)`);
    console.log(`  copy  (copyPages + add)    ${copyMs.toFixed(1)} ms  (${((copyMs / total) * 100).toFixed(1)}%)`);
    console.log(`  save  (serialize)          ${saveMs.toFixed(1)} ms  (${((saveMs / total) * 100).toFixed(1)}%)`);
    console.log(`  total CPU                  ${total.toFixed(1)} ms`);
    console.log(`  output size                ${saved.length} bytes`);
    console.log('');

    const dominant = [
        ['parse', parseMs],
        ['copy', copyMs],
        ['save', saveMs],
    ].sort((a, b) => b[1] - a[1])[0][0];
    console.log(`Dominant stage: ${dominant}`);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
