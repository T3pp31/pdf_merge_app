# AWS Lambda 上で PDF マージ API を提供するモジュール
import base64
import binascii
import io
import json
import os
import tempfile
from email.parser import BytesParser
from email.policy import default
from typing import Dict, List, Tuple

from PyPDF2 import PdfMerger

# CORS 設定（api/chat/lambda_function.py に合わせる）
DEFAULT_CORS_HEADERS: Dict[str, str] = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
