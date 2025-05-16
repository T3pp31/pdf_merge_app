import os
import random
from flask import Flask, render_template, request, send_file
from flask_wtf.csrf import CSRFProtect, generate_csrf
from PyPDF2 import PdfMerger

# make csrf key
csrf_key = ''.join(random.choices('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=32))

# initialize Flask app and CSRF protect instance for CSRF protection
app = Flask(__name__)
app.config['SECRET_KEY'] = csrf_key
csrf = CSRFProtect(app)
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def index():
    # 公式の generate_csrf を使ってトークンを生成・セッションに保存し、テンプレートに渡す
    return render_template("index.html", csrf_token=generate_csrf())


@app.route("/merge", methods=["POST"])
def merge_pdfs():
    files = request.files.getlist("pdfs")

    # CSRFProtect が自動で検証するため、手動検証のコードを削除

    if not files:
        return "少なくとも1つのPDFをアップロードしてください", 400

    merger = PdfMerger()
    output_file = os.path.join(UPLOAD_FOLDER, "merged.pdf")

    try:
        for file in files:
            merger.append(file)
        merger.write(output_file)
        merger.close()
        return send_file(output_file, as_attachment=True, download_name="merged.pdf")
    except Exception as e:
        return f"PDFマージ中にエラーが発生しました: {str(e)}", 500
    finally:
        if os.path.exists(output_file):
            os.remove(output_file)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
