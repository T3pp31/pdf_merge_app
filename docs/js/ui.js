import { t, onLocaleChange, initI18n } from './i18n.js';
import { mergePdfs, formatFileSize, MAX_FILES } from './merge.js';

let selectedFiles = [];
let currentDownloadUrl = null;
let isMerging = false;
let lastStatus = { key: 'status.initial', vars: {}, type: null };
let dragSourceIndex = null;

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('pdfs');
const chooseButton = document.getElementById('chooseButton');
const clearButton = document.getElementById('clearButton');
const mergeButton = document.getElementById('mergeButton');
const fileList = document.getElementById('fileList');
const fileListEmpty = document.getElementById('fileListEmpty');
const statusMsg = document.getElementById('statusMessage');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const downloadSection = document.getElementById('downloadSection');
const downloadLink = document.getElementById('downloadLink');
const downloadMeta = document.getElementById('downloadMeta');

function updateStatus(key, vars = {}, type = null) {
    lastStatus = { key, vars, type };
    statusMsg.textContent = t(key, vars);
    statusMsg.className = 'status-message';
    if (type === 'error') statusMsg.classList.add('error');
    if (type === 'success') statusMsg.classList.add('success');
}

function setProgress(current, total) {
    const bar = progressContainer.querySelector('[role="progressbar"]');
    if (total <= 0) {
        progressContainer.hidden = true;
        progressFill.style.width = '0%';
        if (bar) bar.setAttribute('aria-valuenow', '0');
        return;
    }
    const percent = Math.round((current / total) * 100);
    progressContainer.hidden = false;
    progressFill.style.width = percent + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(percent));
}

function revokeDownloadUrl() {
    if (currentDownloadUrl) {
        URL.revokeObjectURL(currentDownloadUrl);
        currentDownloadUrl = null;
    }
}

function moveFile(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= selectedFiles.length) return;
    const [file] = selectedFiles.splice(fromIndex, 1);
    selectedFiles.splice(toIndex, 0, file);
    renderFileList();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
    updateStatus('status.fileRemoved');
}

function createIconButton(className, ariaKey, ariaVars, svgInner, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-button ' + className;
    btn.setAttribute('aria-label', t(ariaKey, ariaVars));
    btn.innerHTML = svgInner;
    btn.addEventListener('click', onClick);
    return btn;
}

function renderFileList() {
    fileList.innerHTML = '';

    const isEmpty = selectedFiles.length === 0;
    fileListEmpty.hidden = !isEmpty;
    mergeButton.disabled = isEmpty || isMerging;

    if (isEmpty) return;

    selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.draggable = true;
        item.dataset.index = String(index);

        const badge = document.createElement('span');
        badge.className = 'file-order-badge';
        badge.textContent = String(index + 1);
        badge.setAttribute('aria-hidden', 'true');

        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'drag-handle';
        handle.setAttribute('aria-label', t('reorder.handle'));
        handle.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
        handle.addEventListener('mousedown', (e) => e.stopPropagation());
        handle.addEventListener('click', (e) => e.preventDefault());

        const meta = document.createElement('div');
        meta.className = 'file-meta';

        const nameEl = document.createElement('span');
        nameEl.className = 'file-name';
        nameEl.textContent = file.name;
        nameEl.title = file.name;

        const sizeEl = document.createElement('span');
        sizeEl.className = 'file-size';
        sizeEl.textContent = formatFileSize(file.size);

        meta.appendChild(nameEl);
        meta.appendChild(sizeEl);

        const actions = document.createElement('div');
        actions.className = 'file-actions';

        const upBtn = createIconButton(
            '',
            'button.moveUp',
            {},
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
            () => moveFile(index, index - 1)
        );
        upBtn.disabled = index === 0;

        const downBtn = createIconButton(
            '',
            'button.moveDown',
            {},
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
            () => moveFile(index, index + 1)
        );
        downBtn.disabled = index === selectedFiles.length - 1;

        const removeBtn = createIconButton(
            'remove',
            'file.remove',
            { name: file.name },
            '<span class="remove-button" aria-hidden="true">\u2715</span>',
            () => removeFile(index)
        );

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(removeBtn);

        item.appendChild(badge);
        item.appendChild(handle);
        item.appendChild(meta);
        item.appendChild(actions);

        item.addEventListener('dragstart', (e) => {
            dragSourceIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
        });

        item.addEventListener('dragend', () => {
            dragSourceIndex = null;
            item.classList.remove('dragging');
            fileList.querySelectorAll('.file-item').forEach((el) => el.classList.remove('drag-over'));
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            const fromIndex = dragSourceIndex;
            const toIndex = index;
            if (fromIndex !== null && fromIndex !== toIndex) {
                moveFile(fromIndex, toIndex);
            }
        });

        fileList.appendChild(item);
    });
}

function addFiles(fileListInput) {
    const incoming = Array.from(fileListInput).filter((f) => f.type === 'application/pdf');

    if (incoming.length !== fileListInput.length) {
        updateStatus('status.nonPdfExcluded', {}, 'error');
    }

    selectedFiles = selectedFiles.concat(incoming);

    if (selectedFiles.length > MAX_FILES) {
        updateStatus('status.maxExceeded', {}, 'error');
        selectedFiles = selectedFiles.slice(0, MAX_FILES);
    } else if (selectedFiles.length > 0 && incoming.length === fileListInput.length) {
        updateStatus('status.filesSelected', { count: selectedFiles.length });
    }

    renderFileList();
}

function hideDownload() {
    revokeDownloadUrl();
    downloadSection.classList.remove('is-visible');
}

async function handleMerge() {
    if (selectedFiles.length === 0 || isMerging) {
        updateStatus('status.noFiles', {}, 'error');
        return;
    }

    isMerging = true;
    mergeButton.disabled = true;
    mergeButton.classList.add('is-loading');
    mergeButton.querySelector('.merge-label').textContent = t('button.merge.processing');
    hideDownload();
    setProgress(0, selectedFiles.length);

    const result = await mergePdfs(selectedFiles, {
        onProgress: setProgress,
        onStatus: updateStatus,
    });

    if (result) {
        currentDownloadUrl = URL.createObjectURL(result.blob);
        downloadLink.href = currentDownloadUrl;
        downloadLink.download = result.filename;
        downloadMeta.dataset.size = result.sizeLabel;
        downloadMeta.dataset.pages = String(result.pageCount);
        downloadMeta.textContent = t('download.meta', {
            size: result.sizeLabel,
            pages: result.pageCount,
        });
        downloadSection.classList.add('is-visible');
        updateStatus('status.complete', { pages: result.pageCount }, 'success');
    }

    setProgress(0, 0);
    isMerging = false;
    mergeButton.classList.remove('is-loading');
    mergeButton.querySelector('.merge-label').textContent = t('button.merge');
    mergeButton.disabled = selectedFiles.length === 0;
}

function bindEvents() {
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('dragover');
        }
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        addFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        addFiles(e.target.files);
        fileInput.value = '';
    });

    chooseButton.addEventListener('click', () => fileInput.click());

    clearButton.addEventListener('click', () => {
        selectedFiles = [];
        renderFileList();
        hideDownload();
        setProgress(0, 0);
        updateStatus('status.listCleared');
    });

    mergeButton.addEventListener('click', handleMerge);
}

function refreshDynamicContent() {
    mergeButton.querySelector('.merge-label').textContent = isMerging
        ? t('button.merge.processing')
        : t('button.merge');

    if (downloadSection.classList.contains('is-visible') && downloadMeta.textContent) {
        const metaMatch = downloadMeta.dataset;
        if (metaMatch.size && metaMatch.pages) {
            downloadMeta.textContent = t('download.meta', {
                size: metaMatch.size,
                pages: metaMatch.pages,
            });
        }
    }

    updateStatus(lastStatus.key, lastStatus.vars, lastStatus.type);
    renderFileList();
}

function init() {
    initI18n();
    bindEvents();
    renderFileList();
    updateStatus('status.initial');

    onLocaleChange(() => {
        refreshDynamicContent();
    });
}

init();
