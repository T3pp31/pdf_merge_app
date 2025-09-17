from __future__ import annotations

import secrets
from io import BytesIO
from pathlib import Path
from flask import Flask, Response, render_template, request, send_file
from flask_wtf.csrf import CSRFProtect, generate_csrf
from PyPDF2 import PdfMerger
from werkzeug.datastructures import FileStorage

# -------------------------------------------------------------------
# Flask アプリ全体で共有する定数
# -------------------------------------------------------------------
SECRET_KEY_LENGTH = 32  # CSRF 保護で使う安全なキーの長さ
MERGED_FILENAME = "merged.pdf"
UPLOAD_DIR = Path("uploads")


def _generate_secret_key(length: int = SECRET_KEY_LENGTH) -> str:
    """CSRF 保護用のシークレットキーを生成する。"""
    return secrets.token_urlsafe(length)


def _ensure_upload_dir(directory: Path = UPLOAD_DIR) -> None:
    """PDF 一時ファイル用のディレクトリを用意する。"""
    directory.mkdir(parents=True, exist_ok=True)


# Flask アプリケーションと CSRF 保護の初期化
app = Flask(__name__)
app.config["SECRET_KEY"] = _generate_secret_key()
csrf = CSRFProtect(app)
_ensure_upload_dir()


@app.route("/")
def index() -> str:
    # トップページのフォームに CSRF トークンを埋め込んで返す
    return render_template("index.html", csrf_token=generate_csrf())


@app.route("/merge", methods=["POST"])
def merge_pdfs() -> Response:
    # HTML フォームからアップロードされた PDF 一覧を取得
    files: list[FileStorage] = request.files.getlist("pdfs")

    if not files:
        return "少なくとも1つのPDFをアップロードしてください", 400

    merger = PdfMerger()
    output_path = UPLOAD_DIR / MERGED_FILENAME

    try:
        for uploaded_file in files:
            # 順番通りに PDF をマージしていく
            merger.append(uploaded_file)

        merger.write(output_path)
        pdf_bytes = output_path.read_bytes()
        buffer = BytesIO(pdf_bytes)
        buffer.seek(0)  # 念のためポインタを先頭へ戻す

        return send_file(
            buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=MERGED_FILENAME,
        )
    except Exception as exc:  # noqa: BLE001
        # 例外内容をそのまま返してユーザーに知らせる
        return f"PDFマージ中にエラーが発生しました: {exc}", 500
    finally:
        merger.close()
        if output_path.exists():
            output_path.unlink()


if __name__ == "__main__":
    # 開発用サーバーを立ち上げる（本番では WSGI 経由で起動）
    app.run(host="0.0.0.0", port=5000)
