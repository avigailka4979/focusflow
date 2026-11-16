"""FocusFlow API (FastAPI + MongoDB).

Every protected route depends on `current_user`, and every query on user data
filters by the owner id taken from the token, so one user can never read or
change another user's items (they get 404, as if the item does not exist)."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, db as dbmod
from .db import get_db
from .schemas import (ContentIn, LoginIn, PasswordChangeIn, ReadingIn, RegisterIn,
                      SessionIn, UserPatchIn, youtube_id_from_url)
from .security import (client_ip, create_access_token, current_user, hash_password,
                       login_limiter, password_problem, set_jwt_secret, verify_password)

MAX_READINGS_PER_SESSION = 20000


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not getattr(app.state, "skip_db_init", False):
        dbmod.wait_for_db()
        dbmod.init_indexes()
        set_jwt_secret(dbmod.get_or_create_jwt_secret())
    yield


app = FastAPI(title="FocusFlow API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------- errors: {"detail": "message"}

FIELD_NAMES = {
    "email": "אימייל", "password": "סיסמה", "display_name": "שם תצוגה", "title": "כותרת",
    "source": "קישור / טקסט", "type": "סוג תוכן", "content_id": "פריט תוכן",
    "position": "מיקום", "score": "ציון", "level": "רמת קשב",
    "current_password": "סיסמה נוכחית", "new_password": "סיסמה חדשה",
}


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "שגיאה"
    if exc.status_code == 404 and detail == "Not Found":
        detail = "לא נמצא"
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    err = exc.errors()[0] if exc.errors() else {}
    loc = [str(x) for x in err.get("loc", []) if x != "body"]
    field = FIELD_NAMES.get(loc[-1], loc[-1]) if loc else ""
    etype = err.get("type", "")
    msg = err.get("msg", "קלט לא תקין")
    if etype == "value_error":
        msg = msg.removeprefix("Value error, ")
        if field == "אימייל":
            msg = "כתובת אימייל לא תקינה"
    elif etype == "missing":
        msg = "שדה חובה"
    elif etype in ("string_too_long",):
        msg = "ארוך מדי"
    elif etype == "literal_error" and field == "סוג תוכן":
        msg = "סוג התוכן לא נתמך (youtube או text)"
    elif etype.startswith(("greater_than", "less_than")) or etype in ("float_parsing", "int_parsing"):
        msg = "ערך מחוץ לטווח או לא מספר"
    elif etype == "json_invalid":
        msg = "גוף הבקשה אינו JSON תקין"
    text = f"{field}: {msg}" if field else msg
    return JSONResponse({"detail": text}, status_code=422)


# ---------------------------------------------------------------- helpers

def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def oid(value: str, what: str = "הפריט") -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(404, f"{what} לא נמצא")
    return ObjectId(value)


def user_out(u: dict) -> dict:
    return {"id": str(u["_id"]), "email": u["email"], "display_name": u["display_name"],
            "created_at": iso(u["created_at"])}


def content_out(c: dict, full: bool = True) -> dict:
    out = {"id": str(c["_id"]), "type": c["type"], "title": c["title"],
           "created_at": iso(c["created_at"])}
    if c["type"] == "youtube":
        out["youtube_id"] = c.get("youtube_id")
        out["source"] = c["source"]
    else:
        out["source"] = c["source"] if full else c["source"][:200]
        out["length"] = len(c["source"])
    return out


def session_out(s: dict) -> dict:
    count = s.get("reading_count", 0)
    return {
        "id": str(s["_id"]), "content_id": str(s["content_id"]),
        "content_title": s.get("content_title"), "content_type": s.get("content_type"),
        "started_at": iso(s["started_at"]), "ended_at": iso(s.get("ended_at")),
        "reading_count": count,
        "average_score": round(s["score_sum"] / count, 4) if count else None,
    }


def owned_session(session_id: str, user: dict) -> dict:
    s = get_db().sessions.find_one({"_id": oid(session_id, "הסשן"), "owner_id": user["_id"]})
    if not s:
        raise HTTPException(404, "הסשן לא נמצא")
    return s


def close_session(s: dict) -> dict:
    if s.get("ended_at"):
        return s
    return get_db().sessions.find_one_and_update(
        {"_id": s["_id"], "ended_at": None}, {"$set": {"ended_at": now()}}, return_document=True,
    ) or get_db().sessions.find_one({"_id": s["_id"]})


# ---------------------------------------------------------------- health

@app.get("/health", tags=["health"])
@app.get("/api/health", include_in_schema=False)
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------- auth

@app.post("/api/auth/register", status_code=201, tags=["auth"])
def register(body: RegisterIn):
    email = body.email.lower()
    problem = password_problem(body.password, email)
    if problem:
        raise HTTPException(422, problem)
    doc = {"email": email, "password_hash": hash_password(body.password),
           "display_name": body.display_name, "created_at": now(), "token_version": 0}
    try:
        res = get_db().users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "האימייל הזה כבר רשום. אפשר להתחבר במקום להירשם")
    doc["_id"] = res.inserted_id
    return user_out(doc)


@app.post("/api/auth/login", tags=["auth"])
def login(body: LoginIn, request: Request):
    email = body.email.strip().lower()
    keys = [f"email:{email}", f"ip:{client_ip(request)}"]
    wait = login_limiter.retry_after(keys)
    if wait:
        raise HTTPException(429, f"יותר מדי ניסיונות התחברות. נסו שוב בעוד {max(1, wait // 60)} דקות",
                            headers={"Retry-After": str(wait)})
    user = get_db().users.find_one({"email": email})
    if not verify_password(body.password, user["password_hash"] if user else None):
        login_limiter.fail(keys)
        raise HTTPException(401, "אימייל או סיסמה שגויים")
    login_limiter.reset([f"email:{email}"])
    token, ttl = create_access_token(user)
    return {"access_token": token, "token_type": "bearer", "expires_in": ttl}


@app.post("/api/auth/logout", status_code=204, tags=["auth"])
def logout(user: dict = Depends(current_user)):
    tok = user["_token"]
    try:
        get_db().revoked_tokens.insert_one(
            {"jti": tok["jti"], "expires_at": datetime.fromtimestamp(tok["exp"], timezone.utc)})
    except DuplicateKeyError:
        pass
    return Response(status_code=204)


# ---------------------------------------------------------------- users

@app.get("/api/users/me", tags=["users"])
def me(user: dict = Depends(current_user)):
    return user_out(user)


@app.patch("/api/users/me", tags=["users"])
def update_me(body: UserPatchIn, user: dict = Depends(current_user)):
    get_db().users.update_one({"_id": user["_id"]}, {"$set": {"display_name": body.display_name}})
    user["display_name"] = body.display_name
    return user_out(user)


@app.post("/api/users/me/password", status_code=204, tags=["users"])
def change_password(body: PasswordChangeIn, user: dict = Depends(current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(400, "הסיסמה הנוכחית שגויה")
    problem = password_problem(body.new_password, user["email"])
    if problem:
        raise HTTPException(422, problem)
    if body.new_password == body.current_password:
        raise HTTPException(422, "הסיסמה החדשה זהה לנוכחית")
    # Bumping token_version invalidates every token issued before the change.
    get_db().users.update_one({"_id": user["_id"]}, {
        "$set": {"password_hash": hash_password(body.new_password)}, "$inc": {"token_version": 1}})
    return Response(status_code=204)


@app.delete("/api/users/me", status_code=204, tags=["users"])
def delete_me(user: dict = Depends(current_user)):
    db = get_db()
    uid = user["_id"]
    db.readings.delete_many({"owner_id": uid})
    db.sessions.delete_many({"owner_id": uid})
    db.contents.delete_many({"owner_id": uid})
    db.users.delete_one({"_id": uid})
    return Response(status_code=204)


# ---------------------------------------------------------------- content

@app.post("/api/content", status_code=201, tags=["content"])
def add_content(body: ContentIn, user: dict = Depends(current_user)):
    doc = {"owner_id": user["_id"], "type": body.type, "title": body.title, "created_at": now()}
    if body.type == "youtube":
        vid = youtube_id_from_url(body.source)
        if not vid:
            raise HTTPException(422, "קישור YouTube לא תקין. דוגמה: https://www.youtube.com/watch?v=XXXXXXXXXXX")
        doc["youtube_id"] = vid
        doc["source"] = f"https://www.youtube.com/watch?v={vid}"
    else:
        if len(body.source) < 20:
            raise HTTPException(422, "הטקסט קצר מדי (לפחות 20 תווים)")
        doc["source"] = body.source
    res = get_db().contents.insert_one(doc)
    doc["_id"] = res.inserted_id
    return content_out(doc)


@app.get("/api/content", tags=["content"])
def list_content(user: dict = Depends(current_user)):
    items = get_db().contents.find({"owner_id": user["_id"]}).sort("created_at", -1)
    return [content_out(c, full=False) for c in items]


@app.get("/api/content/{content_id}", tags=["content"])
def get_content(content_id: str, user: dict = Depends(current_user)):
    c = get_db().contents.find_one({"_id": oid(content_id), "owner_id": user["_id"]})
    if not c:
        raise HTTPException(404, "הפריט לא נמצא")
    return content_out(c)


@app.delete("/api/content/{content_id}", status_code=204, tags=["content"])
def delete_content(content_id: str, user: dict = Depends(current_user)):
    res = get_db().contents.delete_one({"_id": oid(content_id), "owner_id": user["_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "הפריט לא נמצא")
    # Past sessions stay in the history (they keep a copy of the title).
    return Response(status_code=204)


# ---------------------------------------------------------------- sessions

@app.post("/api/sessions", status_code=201, tags=["sessions"])
def start_session(body: SessionIn, user: dict = Depends(current_user)):
    db = get_db()
    c = db.contents.find_one({"_id": oid(body.content_id), "owner_id": user["_id"]})
    if not c:
        raise HTTPException(404, "הפריט לא נמצא")
    # A user watches one thing at a time: close any session left open (e.g. closed tab).
    db.sessions.update_many({"owner_id": user["_id"], "ended_at": None}, {"$set": {"ended_at": now()}})
    doc = {"owner_id": user["_id"], "content_id": c["_id"], "content_title": c["title"],
           "content_type": c["type"], "started_at": now(), "ended_at": None,
           "reading_count": 0, "score_sum": 0.0}
    doc["_id"] = db.sessions.insert_one(doc).inserted_id
    return session_out(doc)


@app.post("/api/sessions/{session_id}/readings", status_code=201, tags=["sessions"])
def add_reading(session_id: str, body: ReadingIn, user: dict = Depends(current_user)):
    db = get_db()
    s = owned_session(session_id, user)
    if s.get("ended_at"):
        raise HTTPException(409, "הסשן כבר הסתיים")
    if s.get("reading_count", 0) >= MAX_READINGS_PER_SESSION:
        raise HTTPException(409, "הסשן הגיע למספר המדידות המרבי")
    created = now()
    reading = {"session_id": s["_id"], "owner_id": user["_id"], "position": body.position,
               "score": body.score, "level": body.level, "created_at": created}
    db.readings.insert_one(reading)
    db.sessions.update_one({"_id": s["_id"]}, {"$inc": {"reading_count": 1, "score_sum": body.score}})
    return {"position": body.position, "score": body.score, "level": body.level, "created_at": iso(created)}


@app.post("/api/sessions/{session_id}/end", tags=["sessions"])
def end_session(session_id: str, user: dict = Depends(current_user)):
    s = close_session(owned_session(session_id, user))
    out = session_out(s)
    return {k: out[k] for k in ("id", "started_at", "ended_at", "reading_count", "average_score")} | {
        "content_id": out["content_id"], "content_title": out["content_title"]}


@app.get("/api/sessions", tags=["sessions"])
def list_sessions(user: dict = Depends(current_user)):
    items = get_db().sessions.find({"owner_id": user["_id"]}).sort("started_at", -1)
    return [session_out(s) for s in items]


@app.get("/api/sessions/{session_id}", tags=["sessions"])
def get_session(session_id: str, user: dict = Depends(current_user)):
    s = owned_session(session_id, user)
    readings = get_db().readings.find({"session_id": s["_id"], "owner_id": user["_id"]}).sort("created_at", 1)
    out = session_out(s)
    out["readings"] = [{"position": r["position"], "score": r["score"], "level": r.get("level"),
                        "created_at": iso(r["created_at"])} for r in readings]
    return out
