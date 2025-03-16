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
    files = request.files.getlist("pdfs")

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
