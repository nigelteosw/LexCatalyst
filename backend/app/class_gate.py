"""Reject workspace traffic before a user has an approved class."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.database import SessionLocal
from app.dependencies import authenticate_user_token
from app.services.mentorship_class_service import ClassAccessError, require_class_context


def _onboarding_or_public(path: str) -> bool:
    return (
        path in {"/health", "/config", "/auth/google", "/me", "/openapi.json", "/docs", "/redoc"}
        or path.startswith("/classes/")
        or path == "/classes"
        or path.startswith("/settings/")
    )


def install_class_gate(app: FastAPI) -> None:
    @app.middleware("http")
    async def require_approved_class(request: Request, call_next):
        if request.method == "OPTIONS" or _onboarding_or_public(request.url.path):
            return await call_next(request)
        authorization = request.headers.get("authorization", "")
        if not authorization.lower().startswith("bearer "):
            return JSONResponse({"detail": "Authentication required"}, status_code=401)
        token = authorization[7:].strip()
        with SessionLocal() as db:
            try:
                user = authenticate_user_token(db, token)
                require_class_context(db, user)
            except ClassAccessError as exc:
                return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)
            except Exception as exc:
                from fastapi import HTTPException
                if isinstance(exc, HTTPException):
                    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
                raise
        return await call_next(request)
