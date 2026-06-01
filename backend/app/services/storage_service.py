from pathlib import Path
from re import sub

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings


class StorageError(RuntimeError):
    pass


def safe_filename(filename: str) -> str:
    name = Path(filename).name.strip() or "document"
    name = sub(r"[^A-Za-z0-9._-]+", "-", name)
    return name.strip(".-") or "document"


def make_document_storage_key(user_id: str, document_id: str, filename: str) -> str:
    return f"users/{user_id}/documents/{document_id}/{safe_filename(filename)}"


def r2_client():
    settings = get_settings()
    missing = [
        name
        for name, value in {
            "CLOUDFLARE_R2_ENDPOINT_URL": settings.cloudflare_r2_endpoint_url,
            "CLOUDFLARE_R2_ACCESS_KEY_ID": settings.cloudflare_r2_access_key_id,
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY": settings.cloudflare_r2_secret_access_key,
        }.items()
        if not value
    ]
    if missing:
        raise StorageError(f"Missing R2 configuration: {', '.join(missing)}")

    return boto3.client(
        "s3",
        endpoint_url=settings.cloudflare_r2_endpoint_url,
        aws_access_key_id=settings.cloudflare_r2_access_key_id,
        aws_secret_access_key=settings.cloudflare_r2_secret_access_key,
        region_name="auto",
    )


def upload_document_file(
    *,
    file_bytes: bytes,
    user_id: str,
    document_id: str,
    filename: str,
    content_type: str,
) -> str:
    settings = get_settings()
    if not settings.cloudflare_r2_bucket_name:
        raise StorageError("Missing R2 configuration: CLOUDFLARE_R2_BUCKET_NAME")

    storage_key = make_document_storage_key(user_id, document_id, filename)
    try:
        r2_client().put_object(
            Bucket=settings.cloudflare_r2_bucket_name,
            Key=storage_key,
            Body=file_bytes,
            ContentType=content_type,
        )
    except (BotoCoreError, ClientError) as exc:
        raise StorageError(f"R2 upload failed: {exc}") from exc

    return storage_key
