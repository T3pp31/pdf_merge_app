import os

from flask import Flask, render_template, request, send_file
from PyPDF2 import PdfMerger

app = Flask(__name__)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/merge", methods=["POST"])
def merge_pdfs():
    files = []
    for key in ["pdf1", "pdf2", "pdf3"]:  # フォームのファイルフィールドの名前
        file = request.files.get(key)
        if file and file.filename:  # 有効なファイルが選択された場合のみ追加
            files.append(file)

    if len(files) < 2:  # 2つ以上のファイルが必要
        return "少なくとも2つのPDFをアップロードしてください", 400

    merger = PdfMerger()
    output_file = os.path.join(UPLOAD_FOLDER, "merged.pdf")

    try:
        for file in files:
            merger.append(file)
        merger.write(output_file)
        merger.close()
        return send_file(output_file, as_attachment=True)
    except Exception as e:
        return f"PDFマージ中にエラーが発生しました: {str(e)}", 500
    finally:
        if os.path.exists(output_file):
            os.remove(output_file)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
