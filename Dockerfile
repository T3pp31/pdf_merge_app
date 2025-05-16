# ベースイメージ
FROM python:3.12

# 作業ディレクトリを設定
WORKDIR /app

# 必要なファイルをコピー
COPY app/ /app

# 必要な Python パッケージをインストール
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションを起動
CMD ["python", "app.py", "--reload"]
