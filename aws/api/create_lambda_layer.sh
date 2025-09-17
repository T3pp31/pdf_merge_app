#!/bin/bash

# Lambda Layer作成スクリプト (Python 3.13対応)
# AWS Lambda Python 3.13コンテナを使用
# lambda_function.pyで使用されるライブラリに対応

echo "Python 3.13用Lambda Layer作成開始..."

# 作業ディレクトリを作成
mkdir -p lambda-layer/python

# 依存関係ファイルを決定
REQUIREMENTS_FILE=""
if [ -f "requirements-layer.txt" ]; then
    REQUIREMENTS_FILE="requirements-layer.txt"
elif [ -f "requirements.txt" ]; then
    REQUIREMENTS_FILE="requirements.txt"
else
    echo "requirements-layer.txt または requirements.txt が見つかりませんでした"
    exit 1
fi

echo "${REQUIREMENTS_FILE}を使用して依存関係をインストール中..."
# requirements ファイルを用いてインストール
project_root=$(pwd)
docker run --rm -v "${project_root}":/opt/app -v "${project_root}/lambda-layer/python":/opt/python --entrypoint "" \
    public.ecr.aws/lambda/python:3.13 \
    /bin/bash -c "pip install -r /opt/app/${REQUIREMENTS_FILE} -t /opt/python \
    --upgrade && echo 'インストール完了: ' && ls -la /opt/python | head -10"

# Lambda Layer用にzipファイルを作成
echo "Lambda Layerをzipファイルに圧縮中..."
cd lambda-layer
zip -r ../lambda-layer-python313.zip python/
cd ..

echo "作成完了: lambda-layer-python313.zip"
echo "Layer ARN: このzipファイルをAWSコンソールまたはCLIでアップロードしてください"

# 作業ディレクトリをクリーンアップ
rm -rf lambda-layer

echo "Lambda Layer作成完了!"