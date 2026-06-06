const STORAGE_KEY = 'pdf-merge-locale';

const MESSAGES = {
    ja: {
        'meta.title': 'PDF結合',
        'meta.description': '複数のPDFファイルをブラウザ内で1つに結合。サーバーへのアップロード不要。',
        'og.title': 'PDF結合',
        'og.description': '複数のPDFファイルをブラウザ内で1つに結合。サーバーへのアップロード不要。',
        'hero.title': 'PDF結合',
        'hero.subtitle': '複数のPDFファイルを1つに結合',
        'privacy.badge': 'ブラウザ内で処理・PDFはサーバーに送信されません',
        'privacy.aria': 'プライバシー情報',
        'dropzone.title': 'PDFファイルをここにドラッグ＆ドロップ',
        'dropzone.hint': 'PDFのみ · 最大20件 · ブラウザ内で処理',
        'dropzone.aria': 'PDFファイルのドロップゾーン',
        'empty.title': 'ファイルがまだありません',
        'empty.hint': '「ファイルを選択」から追加するか、上のエリアにドロップしてください',
        'button.choose': 'ファイルを選択',
        'button.clear': 'リストをクリア',
        'button.merge': 'PDFを結合',
        'button.merge.processing': 'マージ処理中...',
        'button.moveUp': '上へ移動',
        'button.moveDown': '下へ移動',
        'file.remove': '{name} を削除',
        'reorder.handle': 'ドラッグして並び替え',
        'status.initial': 'ファイルを選択して「PDFを結合」をクリックしてください。',
        'status.filesSelected': '{count} 件のPDFを選択しました。',
        'status.fileRemoved': 'ファイルを削除しました。',
        'status.listCleared': 'ファイルリストをクリアしました。',
        'status.nonPdfExcluded': 'PDFファイル以外が含まれていたため除外しました。',
        'status.maxExceeded': '最大20件まで選択できます。超過分を除外しました。',
        'status.noFiles': 'マージするPDFを選択してください。',
        'status.loading': 'PDFを読み込んでいます...',
        'status.processing': '処理中: {current} / {total} ({name})',
        'status.saving': 'PDFを保存しています...',
        'status.complete': 'マージが完了しました（{pages} ページ）。ダウンロードリンクから取得できます。',
        'status.error.merge': 'PDFマージ中にエラーが発生しました: {message}',
        'status.error.load': '「{name}」の読み込みに失敗しました: {message}',
        'download.label': 'マージ結果をダウンロード',
        'download.meta': 'サイズ: {size}  |  ページ数: {pages}',
        'lang.ja': 'JA',
        'lang.en': 'EN',
        'lang.switch.ja': '日本語に切り替え',
        'lang.switch.en': 'Switch to English',
        'footer.github': 'GitHub で見る',
        'footer.note': 'すべての処理はブラウザ内で実行されます',
    },
    en: {
        'meta.title': 'PDF Merger',
        'meta.description': 'Merge multiple PDF files in your browser. No server upload required.',
        'og.title': 'PDF Merger',
        'og.description': 'Merge multiple PDF files in your browser. No server upload required.',
        'hero.title': 'PDF Merger',
        'hero.subtitle': 'Combine multiple PDF files into one',
        'privacy.badge': 'Processed in browser · PDFs are never sent to a server',
        'privacy.aria': 'Privacy information',
        'dropzone.title': 'Drag & drop PDF files here',
        'dropzone.hint': 'PDF only · Up to 20 files · Processed in browser',
        'dropzone.aria': 'PDF file drop zone',
        'empty.title': 'No files yet',
        'empty.hint': 'Use "Choose files" or drop PDFs in the area above',
        'button.choose': 'Choose files',
        'button.clear': 'Clear list',
        'button.merge': 'Merge PDFs',
        'button.merge.processing': 'Merging...',
        'button.moveUp': 'Move up',
        'button.moveDown': 'Move down',
        'file.remove': 'Remove {name}',
        'reorder.handle': 'Drag to reorder',
        'status.initial': 'Select files and click "Merge PDFs".',
        'status.filesSelected': '{count} PDF(s) selected.',
        'status.fileRemoved': 'File removed.',
        'status.listCleared': 'File list cleared.',
        'status.nonPdfExcluded': 'Non-PDF files were excluded.',
        'status.maxExceeded': 'You can select up to 20 files. Excess files were removed.',
        'status.noFiles': 'Please select PDFs to merge.',
        'status.loading': 'Loading PDFs...',
        'status.processing': 'Processing: {current} / {total} ({name})',
        'status.saving': 'Saving PDF...',
        'status.complete': 'Merge complete ({pages} pages). Download using the link below.',
        'status.error.merge': 'An error occurred while merging PDFs: {message}',
        'status.error.load': 'Failed to load "{name}": {message}',
        'download.label': 'Download merged PDF',
        'download.meta': 'Size: {size}  |  Pages: {pages}',
        'lang.ja': 'JA',
        'lang.en': 'EN',
        'lang.switch.ja': 'Switch to Japanese',
        'lang.switch.en': 'Switch to English',
        'footer.github': 'View on GitHub',
        'footer.note': 'All processing runs in your browser',
    },
};

let currentLocale = 'ja';
const localeListeners = new Set();

function detectInitialLocale() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ja' || stored === 'en') {
        return stored;
    }
    const navLang = navigator.language || navigator.userLanguage || 'en';
    return navLang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function getLocale() {
    return currentLocale;
}

export function t(key, vars = {}) {
    const template = MESSAGES[currentLocale][key] ?? MESSAGES.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => {
        return vars[name] !== undefined ? String(vars[name]) : `{${name}}`;
    });
}

function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
        const key = el.getAttribute('data-i18n-aria');
        el.setAttribute('aria-label', t(key));
    });

    document.title = t('meta.title');

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
        metaDesc.setAttribute('content', t('meta.description'));
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
        ogTitle.setAttribute('content', t('og.title'));
    }

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) {
        ogDesc.setAttribute('content', t('og.description'));
    }

    document.documentElement.lang = currentLocale;

    document.querySelectorAll('[data-locale]').forEach((btn) => {
        const isActive = btn.getAttribute('data-locale') === currentLocale;
        btn.setAttribute('aria-pressed', String(isActive));
    });
}

export function setLocale(locale) {
    if (locale !== 'ja' && locale !== 'en') {
        return;
    }
    currentLocale = locale;
    localStorage.setItem(STORAGE_KEY, locale);
    applyStaticTranslations();
    localeListeners.forEach((listener) => listener(currentLocale));
}

export function onLocaleChange(listener) {
    localeListeners.add(listener);
    return () => localeListeners.delete(listener);
}

export function initI18n() {
    currentLocale = detectInitialLocale();
    applyStaticTranslations();

    document.querySelectorAll('[data-locale]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setLocale(btn.getAttribute('data-locale'));
        });
    });
}
