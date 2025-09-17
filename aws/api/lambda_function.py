# AWS Lambda 上で PDF マージ API を提供するモジュール
import base64
import json
import binascii
import os
import tempfile
import time
from email.parser import BytesParser
from email.policy import default
from typing import Any, Dict, List, Optional, Tuple

import requests

from jose import jwk, jwt
from jose.exceptions import JWTError
from PyPDF2 import PdfMerger
import io


AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "a0ff080f-ce15-4520-ba64-fd5aa4b0141a")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "8629ce52-7bc1-43bc-bd1e-81526f06647b")
AZURE_ISSUER_URL = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/v2.0"
AZURE_JWKS_URL = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/discovery/v2.0/keys"
JWT_ALGORITHM = "RS256"
JWT_AUDIENCE = os.environ.get("JWT_AUDIENCE", AZURE_CLIENT_ID)
TOKEN_CACHE_TTL = int(os.environ.get("TOKEN_CACHE_TTL", "3600"))

# JWKS キャッシュ（Lambda のコンテナ再利用時に利用）
_jwks_cache: Dict[str, Any] = {}
_jwks_cache_time: float = 0.0

# CORS 設定（api/chat/lambda_function.py に合わせる）
DEFAULT_CORS_HEADERS: Dict[str, str] = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

def get_jwks() -> Dict[str, Any]:
    """Azure AD の JWKS を取得（キャッシュ対応）。"""
    global _jwks_cache, _jwks_cache_time

    current_time = time.time()
    if _jwks_cache and (current_time - _jwks_cache_time) < TOKEN_CACHE_TTL:
        return _jwks_cache

    try:
        response = requests.get(AZURE_JWKS_URL, timeout=10)
        response.raise_for_status()
        _jwks_cache = response.json()
        _jwks_cache_time = current_time
        return _jwks_cache
    except Exception as exc:  # noqa: BLE001
        print(f"JWKS取得エラー: {exc}")
        if _jwks_cache:
            return _jwks_cache
        raise


def validate_entra_token(token: str) -> Optional[Dict[str, Any]]:
    """
    EntraID（Azure AD）トークンの検証
    Args:
        token: JWTトークン
    Returns:
        dict: デコードされたクレーム（検証失敗時はNone）
    """
    try:
        # JWTヘッダーを取得してkidを抽出
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        print(f"JWT header: {unverified_header}")

        if not kid:
            print("JWT header missing 'kid'")
            return None

        # トークンの中身をデバッグ用に出力（検証なし）
        unverified_claims = jwt.get_unverified_claims(token)
        print(f"JWT unverified claims - iss: {unverified_claims.get('iss')}")
        print(f"JWT unverified claims - aud: {unverified_claims.get('aud')}")
        print(f"JWT unverified claims - typ: {unverified_claims.get('typ')}")
        print(f"Expected issuer: {AZURE_ISSUER_URL}")
        print(f"Expected audience: {JWT_AUDIENCE}")

        # JWKSから対応する公開鍵を取得
        jwks = get_jwks()

        # kidに対応する鍵を検索
        public_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                # アルゴリズムを明示的に追加
                key_with_alg = key.copy()
                if "alg" not in key_with_alg:
                    key_with_alg["alg"] = "RS256"  # Azure ADのデフォルト
                print(f"Constructing JWK with algorithm: {key_with_alg.get('alg')}")
                public_key = jwk.construct(key_with_alg)
                break

        if not public_key:
            print(f"Public key not found for kid: {kid}")
            print(f"Available kids in JWKS: {[key.get('kid') for key in jwks.get('keys', [])]}")
            return None

        # JWTを検証・デコード
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=AZURE_ISSUER_URL,
        )

        print(f"JWT decoded successfully. Claims: {payload}")
        return payload

    except JWTError as e:
        print(f"JWT検証エラー: {e}")
        print(f"JWT error type: {type(e)}")
        return None
    except Exception as e:  # noqa: BLE001
        print(f"トークン検証中にエラーが発生: {e}")
        print(f"Exception type: {type(e)}")
        return None


def authenticate_request(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Authorization ヘッダーの Bearer トークンを検証する。"""
    headers = event.get("headers", {}) or {}
    print(f"Headers received: {headers}")

    auth_header = None
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == "authorization":
            auth_header = value
            break

    if not auth_header:
        print("Authorization ヘッダーが見つかりません")
        return None

    print(f"Authorization header value: {auth_header}")
    if not isinstance(auth_header, str) or not auth_header.startswith("Bearer "):
        print("Bearer トークンではありません")
        return None

    token = auth_header[7:].strip()
    if not token:
        print("Bearer トークンが空です")
        return None

    claims = validate_entra_token(token)
    if not claims:
        print("トークン検証に失敗しました")
        return None

    return {
        "user_id": claims.get("oid"),
        "email": claims.get("preferred_username") or claims.get("email"),
        "name": claims.get("name"),
        "tenant_id": claims.get("tid"),
        "claims": claims,
    }


def parse_form_data(body_bytes: bytes, content_type: str) -> Tuple[Dict[str, List[str]], List[dict]]:
    """multipart/form-data の本文をパースし、フィールドとファイルに分離する。"""
    if not content_type or "multipart/form-data" not in content_type.lower():
        raise ValueError("multipart/form-data 形式のリクエストのみ受け付けます。")

    # email モジュールで扱えるようヘッダー部分を付与して解析
    header_prefix = f"Content-Type: {content_type}\r\n\r\n".encode("utf-8")
    message = BytesParser(policy=default).parsebytes(header_prefix + body_bytes)

    if not message.is_multipart():
        raise ValueError("multipart/form-data 形式のリクエストのみ受け付けます。")

    fields: Dict[str, List[str]] = {}
    files: List[dict] = []

    for part in message.iter_parts():
        disposition = part.get("Content-Disposition")
        if not disposition:
            continue

        field_name = part.get_param("name", header="Content-Disposition")
        if not field_name:
            continue

        filename = part.get_param("filename", header="Content-Disposition")
        payload = part.get_payload(decode=True) or b""

        if filename:
            # バイナリファイルは後の処理で結合できるよう保持
            files.append(
                {
                    "field_name": field_name,
                    "filename": filename,
                    "content": payload,
                    "content_type": part.get_content_type(),
                }
            )
        else:
            # テキストフィールドは文字コードを考慮してデコード
            charset = part.get_content_charset("utf-8")
            value = payload.decode(charset, errors="replace")
            fields.setdefault(field_name, []).append(value)

    return fields, files


def build_response(status_code: int, body: str, headers: Dict[str, str] | None = None, *, is_base64: bool = False):
    """API Gateway へ返却するレスポンス辞書を構築する。"""
    # 既定で CORS ヘッダーを付与し、必要に応じて上書き
    response_headers: Dict[str, str] = dict(DEFAULT_CORS_HEADERS)
    if headers:
        response_headers.update(headers)

    return {
        "statusCode": status_code,
        "headers": response_headers,
        "isBase64Encoded": is_base64,
        "body": body,
    }


def handle_merge(event: dict) -> dict:
    """PDF マージ用エンドポイントの処理。"""
    user_info = authenticate_request(event)
    if not user_info:
        return build_response(
            401,
            "認証に失敗しました。有効なEntraIDトークンが必要です。",
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    print("認証成功: ユーザー {email} ({user_id})".format(email=user_info.get("email"), user_id=user_info.get("user_id")))
    raw_headers = event.get("headers") or {}
    # すべて小文字キーにしてヘッダーを正規化
    headers = {k.lower(): v for k, v in raw_headers.items() if isinstance(v, str)}

    body = event.get("body")
    if body is None:
        return build_response(400, "リクエストボディが空です。", {"Content-Type": "text/plain; charset=utf-8"})

    content_type = headers.get("content-type", "").lower()

    files: List[dict] = []
    # サポート1: JSON 形式（frontend/pdfmerge.html に合わせる）
    if "application/json" in content_type:
        try:
            if event.get("isBase64Encoded"):
                decoded = base64.b64decode(body)
                payload = decoded.decode("utf-8")
            else:
                payload = body
            data = json.loads(payload)
        except Exception as exc:  # noqa: BLE001
            return build_response(400, f"JSONの解析に失敗しました: {exc}", {"Content-Type": "text/plain; charset=utf-8"})

        files_field = data.get("files") or []
        if not isinstance(files_field, list) or not files_field:
            return build_response(400, "files 配列が必要です。", {"Content-Type": "text/plain; charset=utf-8"})

        # files 配列からPDFだけ抽出
        for item in files_field:
            try:
                if (item.get("type") == "document") and (
                    (item.get("media_type") or "application/pdf").lower() == "application/pdf"
                ):
                    b = base64.b64decode(item.get("data", ""), validate=True)
                    files.append({
                        "field_name": "pdfs",
                        "filename": item.get("name") or "document.pdf",
                        "content": b,
                        "content_type": "application/pdf",
                    })
            except Exception:
                pass
    # サポート2: multipart/form-data
    else:
        try:
            if event.get("isBase64Encoded"):
                # API Gateway からは base64 化されて送られてくる場合がある
                body_bytes = base64.b64decode(body, validate=True)
            else:
                body_bytes = body.encode("utf-8")
        except (binascii.Error, ValueError):
            return build_response(
                400,
                "リクエストボディのデコードに失敗しました。",
                {"Content-Type": "text/plain; charset=utf-8"},
            )

        try:
            _, files = parse_form_data(body_bytes, headers.get("content-type", ""))
        except ValueError as exc:
            return build_response(400, str(exc), {"Content-Type": "text/plain; charset=utf-8"})

    pdf_parts = [item for item in files if item.get("field_name") == "pdfs" and item.get("filename")]
    if not pdf_parts:
        return build_response(
            400,
            "少なくとも1つのPDFをアップロードしてください。",
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    temp_paths: List[str] = []
    output_path: str | None = None
    merger = PdfMerger()
    response: dict

    try:
        for file_info in pdf_parts:
            # 直接メモリから読み込む（BytesIO）
            try:
                merger.append(io.BytesIO(file_info["content"]))
            except Exception:
                # うまくいかない環境向けに /tmp にフォールバック
                with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
                    temp_file.write(file_info["content"])
                    temp_paths.append(temp_file.name)
                    merger.append(temp_file.name)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as merged_file:
            merger.write(merged_file)
            output_path = merged_file.name

        with open(output_path, "rb") as merged_fp:
            merged_bytes = merged_fp.read()
        encoded_pdf = base64.b64encode(merged_bytes).decode("utf-8")

        response = build_response(
            200,
            json.dumps({
                "body": encoded_pdf,
                "isBase64Encoded": True,
                "content_type": "application/pdf",
                "filename": "merged.pdf",
            }),
            {
                "Content-Type": "application/json",
                "Content-Disposition": 'attachment; filename="merged.pdf"',
            },
            is_base64=False,
        )
    except Exception as exc:  # noqa: BLE001
        response = build_response(
            500,
            f"PDFマージ中にエラーが発生しました: {exc}",
            {"Content-Type": "text/plain; charset=utf-8"},
        )
    finally:
        merger.close()
        # 作成した一時ファイルは確実に削除
        for path in temp_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        if output_path:
            try:
                os.remove(output_path)
            except OSError:
                pass

    return response


def lambda_handler(event, context):  # noqa: ANN001, D401
    """API Gateway からのリクエストを振り分ける Lambda エントリポイント。"""
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    )
    path = event.get("rawPath") or event.get("path") or "/"
    path = "/" + path.lstrip("/")

    # CORS プリフライト（OPTIONS）
    if method == "OPTIONS":
        return build_response(
            200,
            "",
            {"Content-Type": "application/json"},
        )

    # ステージやベースパスを含むパスでも動作させる
    if method == "POST":
        # 末尾のパス要素で判定（/pdfmerge, /merge の両方を許容）
        tail = path.rsplit("/", 1)[-1]
        if tail in {"merge", "pdfmerge"} or path.endswith("/pdfmerge") or path.endswith("/merge"):
            return handle_merge(event)

    return build_response(
        404,
        "指定されたリソースは見つかりませんでした。",
        {"Content-Type": "text/plain; charset=utf-8"},
    )
