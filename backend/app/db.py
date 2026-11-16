"""MongoDB access. One client per process; indexes are created at startup."""
import secrets
import time

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.database import Database

from . import config

_client = None
_db: Database | None = None


def set_db(db: Database) -> None:
    """Used by tests to inject a mock database."""
    global _db
    _db = db


def get_db() -> Database:
    global _client, _db
    if _db is None:
        _client = MongoClient(config.MONGODB_URI, serverSelectionTimeoutMS=5000, tz_aware=True)
        _db = _client[config.DB_NAME]
    return _db


def wait_for_db(retries: int = 30) -> None:
    db = get_db()
    for i in range(retries):
        try:
            db.command("ping")
            return
        except Exception:  # noqa: BLE001 - Mongo may still be starting
            time.sleep(min(2, 0.5 + i * 0.2))
    db.command("ping")


def init_indexes() -> None:
    db = get_db()
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.contents.create_index([("owner_id", ASCENDING), ("created_at", DESCENDING)])
    db.sessions.create_index([("owner_id", ASCENDING), ("started_at", DESCENDING)])
    db.readings.create_index([("session_id", ASCENDING), ("created_at", ASCENDING)])
    # Revoked tokens disappear by themselves once they would have expired anyway.
    db.revoked_tokens.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    db.revoked_tokens.create_index([("jti", ASCENDING)], unique=True)


def get_or_create_jwt_secret() -> str:
    """Use JWT_SECRET from the environment; otherwise generate one random 256-bit
    secret on first start and keep it in the DB so tokens survive restarts."""
    if len(config.JWT_SECRET) >= 32:
        return config.JWT_SECRET
    db = get_db()
    doc = db.app_settings.find_one({"_id": "jwt_secret"})
    if doc:
        return doc["value"]
    value = secrets.token_urlsafe(48)
    try:
        db.app_settings.insert_one({"_id": "jwt_secret", "value": value})
    except Exception:  # noqa: BLE001 - another worker won the race
        value = db.app_settings.find_one({"_id": "jwt_secret"})["value"]
    return value
