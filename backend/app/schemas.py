"""Request bodies and their validation."""
import re
from typing import Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
             "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"}


def clean_text(value: str) -> str:
    """Strip control characters (keeps newlines and tabs) and surrounding spaces."""
    return _CONTROL.sub("", value).strip()


def youtube_id_from_url(url: str) -> str | None:
    """Accept only real YouTube URLs and return the 11-character video id."""
    url = url.strip()
    if _YT_ID.match(url):
        return url
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        p = urlparse(url)
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in _YT_HOSTS:
        return None
    host = p.hostname.lower()
    parts = [x for x in p.path.split("/") if x]
    candidate = None
    if host.endswith("youtu.be"):
        candidate = parts[0] if parts else None
    elif parts and parts[0] == "watch":
        candidate = (parse_qs(p.query).get("v") or [None])[0]
    elif len(parts) >= 2 and parts[0] in ("embed", "shorts", "live", "v"):
        candidate = parts[1]
    return candidate if candidate and _YT_ID.match(candidate) else None


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_max_length=60000)


class RegisterIn(Strict):
    email: EmailStr = Field(max_length=254)
    password: str = Field(max_length=128)
    display_name: str = Field(max_length=50)

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = clean_text(v)
        if not v:
            raise ValueError("יש למלא שם תצוגה")
        return v


class LoginIn(Strict):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class UserPatchIn(Strict):
    display_name: str = Field(max_length=50)

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = clean_text(v)
        if not v:
            raise ValueError("יש למלא שם תצוגה")
        return v


class PasswordChangeIn(Strict):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class ContentIn(Strict):
    type: Literal["youtube", "text"]
    title: str = Field(max_length=200)
    source: str = Field(max_length=50000)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = clean_text(v)
        if not v:
            raise ValueError("יש למלא כותרת")
        return v

    @field_validator("source")
    @classmethod
    def _source(cls, v: str) -> str:
        v = clean_text(v)
        if not v:
            raise ValueError("יש למלא קישור או טקסט")
        return v


class SessionIn(Strict):
    content_id: str = Field(max_length=64)


class ReadingIn(Strict):
    # Seconds into the video, or 0..1 scroll position in a text.
    position: float = Field(ge=0, le=1_000_000)
    score: float = Field(ge=0, le=1)
    # Optional 5-level class from the v4_2 model: 0 not in frame .. 4 very attentive.
    level: int | None = Field(default=None, ge=0, le=4)
