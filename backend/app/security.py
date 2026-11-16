"""Password hashing, password rules, JWT tokens, login throttling and the
`current_user` dependency that every protected route uses."""
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config
from .db import get_db

# ---------------------------------------------------------------- passwords

COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890",
    "qwerty123", "qwertyuiop", "11111111", "00000000", "abcd1234", "abc12345",
    "iloveyou1", "admin123", "letmein1", "welcome1", "passw0rd", "focusflow1",
}


def password_problem(password: str, email: str = "") -> str | None:
    """Return a Hebrew error message if the password is too weak, else None."""
    if len(password) < 8:
        return "הסיסמה קצרה מדי: לפחות 8 תווים"
    if len(password.encode("utf-8")) > 72:
        return "הסיסמה ארוכה מדי (עד 72 בתים)"
    if not re.search(r"[A-Za-z\u0590-\u05FF]", password) or not re.search(r"\d", password):
        return "הסיסמה חייבת לכלול לפחות אות אחת וספרה אחת"
    if password.lower() in COMMON_PASSWORDS:
        return "הסיסמה נפוצה מדי, בחרו סיסמה אחרת"
    if email and password.lower() == email.lower():
        return "הסיסמה לא יכולה להיות זהה לאימייל"
    return None


def hash_password(password: str) -> str:
    # bcrypt generates a random 16-byte salt per hash and stores it inside the hash.
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=config.BCRYPT_ROUNDS)).decode()


# Used when the email does not exist, so a failed login takes the same time either way.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-0", bcrypt.gensalt(rounds=config.BCRYPT_ROUNDS))


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        pw = password.encode("utf-8")
        if len(pw) > 72:
            return False
        if not password_hash:
            bcrypt.checkpw(pw, _DUMMY_HASH)
            return False
        return bcrypt.checkpw(pw, password_hash.encode())
    except ValueError:
        return False


# ---------------------------------------------------------------- tokens

_jwt_secret: str | None = None


def set_jwt_secret(value: str) -> None:
    global _jwt_secret
    _jwt_secret = value


def _secret() -> str:
    if not _jwt_secret:
        raise RuntimeError("JWT secret not initialised")
    return _jwt_secret


def create_access_token(user: dict) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    ttl = config.TOKEN_TTL_MINUTES * 60
    payload = {
        "sub": str(user["_id"]),
        "tv": user.get("token_version", 0),   # bumped on password change -> old tokens die
        "jti": secrets.token_hex(16),          # lets logout revoke this exact token
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "iss": "focusflow",
    }
    return jwt.encode(payload, _secret(), algorithm=config.JWT_ALGORITHM), ttl


def decode_token(token: str) -> dict:
    return jwt.decode(
        token, _secret(), algorithms=[config.JWT_ALGORITHM],
        issuer="focusflow", options={"require": ["sub", "exp", "iat", "jti"]},
    )


_bearer = HTTPBearer(auto_error=False)


def _unauthorized(msg: str = "נדרשת התחברות") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, msg, headers={"WWW-Authenticate": "Bearer"})


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    """Identify the caller only from the signed token, never from the request body."""
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise _unauthorized()
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("פג תוקף ההתחברות, התחברו שוב")
    except jwt.PyJWTError:
        raise _unauthorized("טוקן לא תקין")
    if not ObjectId.is_valid(payload["sub"]):
        raise _unauthorized("טוקן לא תקין")
    db = get_db()
    if db.revoked_tokens.find_one({"jti": payload["jti"]}):
        raise _unauthorized("החיבור נותק, התחברו שוב")
    user = db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user or user.get("token_version", 0) != payload.get("tv", 0):
        raise _unauthorized("החיבור אינו בתוקף, התחברו שוב")
    user["_token"] = payload
    return user


# ---------------------------------------------------------------- login throttling

class LoginLimiter:
    """In-memory sliding window: after N failed logins for the same email or the
    same IP within the window, further attempts get 429 until the window passes."""

    def __init__(self) -> None:
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> list[float]:
        items = [t for t in self._fails.get(key, []) if now - t < config.LOGIN_WINDOW_SECONDS]
        self._fails[key] = items
        return items

    def retry_after(self, keys: list[str]) -> int:
        now = time.time()
        with self._lock:
            worst = 0
            for k in keys:
                items = self._recent(k, now)
                if len(items) >= config.MAX_FAILED_LOGINS:
                    worst = max(worst, int(config.LOGIN_WINDOW_SECONDS - (now - items[0])) + 1)
            return worst

    def fail(self, keys: list[str]) -> None:
        now = time.time()
        with self._lock:
            for k in keys:
                self._recent(k, now).append(now)

    def reset(self, keys: list[str]) -> None:
        with self._lock:
            for k in keys:
                self._fails.pop(k, None)


login_limiter = LoginLimiter()


def client_ip(request: Request) -> str:
    # Requests arrive through the client's nginx, which sets X-Real-IP. A spoofed
    # header only dodges the per-IP limit; the per-email limit still applies.
    real = request.headers.get("x-real-ip", "").strip()
    if real and len(real) <= 45:
        return real
    return request.client.host if request.client else "unknown"
