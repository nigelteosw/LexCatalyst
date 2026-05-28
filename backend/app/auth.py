from datetime import datetime, timedelta, timezone
from typing import Any

from google.auth.transport import requests
from google.oauth2 import id_token
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User


def verify_google_token(token: str) -> dict[str, Any]:
    """
    Verifies a Google ID token.
    Returns the decoded token (claims) if valid, otherwise raises an exception.
    """
    settings = get_settings()
    if not settings.google_client_id:
        # In a real app, this should be a critical error or handled gracefully
        raise ValueError("GOOGLE_CLIENT_ID is not configured")

    try:
        # Verify the token with Google
        idinfo = id_token.verify_oauth2_token(
            token, requests.Request(), settings.google_client_id
        )

        # ID token is valid. Get the user's Google Account ID from the decoded token.
        return idinfo
    except Exception as e:
        raise ValueError(f"Invalid Google token: {e}")


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """
    Creates a JWT access token.
    """
    settings = get_settings()
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return encoded_jwt


def get_or_create_user(db: Session, google_info: dict[str, Any]) -> User:
    """
    Gets an existing user by google_id or creates a new one.
    """
    google_id = google_info["sub"]
    email = google_info["email"]
    name = google_info.get("name")

    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        user = User(
            google_id=google_id,
            email=email,
            full_name=name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    return user
