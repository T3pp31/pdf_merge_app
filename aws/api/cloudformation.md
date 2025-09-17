# CloudFormationの作成

## IAM

lambda_function.pyをみて，必要なポリシーを付与したロールを作成してください．

## Lambda

Lambda関数を作成してください．

- ランタイム: Python 3.13
- ハンドラ: lambda_function.lambda_handler
- ロール: 上で作成したロール
- レイヤー lambda-layer-python313.zip

## API Gateway

- RestAPIを利用する．
- Lambda関数を統合する．
- CORSを有効にする．
- デプロイする．
- ステージ名: prod
- ステージ変数: LAMBDA_FUNCTION_NAME: (上で作成したLambda関数名)
- エンドポイントは， /pdf_merge
- メソッドは， POST
- リクエストボディは，application/json
