"""API tests against an in-memory mongomock database.  Run:  pytest -q"""
import mongomock
import pytest
from fastapi.testclient import TestClient

from app import config, db as dbmod, main, security

config.BCRYPT_ROUNDS = 4


@pytest.fixture()
def client():
    mdb = mongomock.MongoClient(tz_aware=True)["test"]
    dbmod.set_db(mdb)
    dbmod.init_indexes()
    security.set_jwt_secret("x" * 40)
    security.login_limiter = security.LoginLimiter()
    main.login_limiter = security.login_limiter
    main.app.state.skip_db_init = True
    with TestClient(main.app) as c:
        yield c


def register(c, email="a@example.com", pw="secret123", name="Avi"):
    return c.post("/api/auth/register", json={"email": email, "password": pw, "display_name": name})


def login(c, email="a@example.com", pw="secret123"):
    r = c.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_register_login_flow(client):
    r = register(client)
    assert r.status_code == 201 and set(r.json()) == {"id", "email", "display_name", "created_at"}
    assert "password" not in r.text and "hash" not in r.text
    assert register(client, email="A@Example.com").status_code == 409
    assert register(client, email="b@example.com", pw="short1").status_code == 422
    assert register(client, email="b@example.com", pw="onlyletters").status_code == 422
    assert register(client, email="not-an-email").status_code == 422
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "nope12345"}).status_code == 401
    h = login(client)
    me = client.get("/api/users/me", headers=h).json()
    assert me["display_name"] == "Avi" and me["created_at"].endswith("Z")
    assert client.get("/api/users/me").status_code == 401
    assert client.get("/api/users/me", headers={"Authorization": "Bearer junk"}).status_code == 401
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/users/me", headers=h).status_code == 401


def test_error_shape(client):
    r = register(client, pw="x")
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_login_rate_limit(client):
    register(client)
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "bad12345"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "secret123"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_content_sessions_and_isolation(client):
    register(client)
    register(client, email="b@example.com", name="Bob")
    ha, hb = login(client), login(client, "b@example.com")

    bad = client.post("/api/content", headers=ha, json={"type": "youtube", "title": "x", "source": "https://evil.com/watch?v=dQw4w9WgXcQ"})
    assert bad.status_code == 422
    assert client.post("/api/content", headers=ha, json={"type": "pdf", "title": "x", "source": "y"}).status_code == 422
    yt = client.post("/api/content", headers=ha, json={"type": "youtube", "title": "Lesson", "source": "https://youtu.be/dQw4w9WgXcQ?t=3"})
    assert yt.status_code == 201 and yt.json()["youtube_id"] == "dQw4w9WgXcQ"
    txt = client.post("/api/content", headers=ha, json={"type": "text", "title": "<script>alert(1)</script>", "source": "word " * 30})
    assert txt.status_code == 201
    cid = yt.json()["id"]

    assert len(client.get("/api/content", headers=ha).json()) == 2
    assert client.get("/api/content", headers=hb).json() == []
    assert client.get(f"/api/content/{cid}", headers=hb).status_code == 404
    assert client.get("/api/content/notanid", headers=ha).status_code == 404
    assert client.delete(f"/api/content/{cid}", headers=hb).status_code == 404

    assert client.post("/api/sessions", headers=hb, json={"content_id": cid}).status_code == 404
    s = client.post("/api/sessions", headers=ha, json={"content_id": cid})
    assert s.status_code == 201
    sid = s.json()["id"]
    for pos, sc in [(10, 0.8), (12, 0.6)]:
        r = client.post(f"/api/sessions/{sid}/readings", headers=ha, json={"position": pos, "score": sc, "level": 3})
        assert r.status_code == 201 and set(r.json()) >= {"position", "score", "created_at"}
    assert client.post(f"/api/sessions/{sid}/readings", headers=ha, json={"position": 1, "score": 1.5}).status_code == 422
    assert client.post(f"/api/sessions/{sid}/readings", headers=hb, json={"position": 1, "score": 0.5}).status_code == 404
    assert client.get(f"/api/sessions/{sid}", headers=hb).status_code == 404

    end = client.post(f"/api/sessions/{sid}/end", headers=ha).json()
    assert end["reading_count"] == 2 and abs(end["average_score"] - 0.7) < 1e-9 and end["ended_at"]
    assert client.post(f"/api/sessions/{sid}/readings", headers=ha, json={"position": 1, "score": 0.5}).status_code == 409

    lst = client.get("/api/sessions", headers=ha).json()
    assert lst[0]["content_id"] == cid and lst[0]["content_title"] == "Lesson"
    detail = client.get(f"/api/sessions/{sid}", headers=ha).json()
    assert [r["score"] for r in detail["readings"]] == [0.8, 0.6]
    assert client.get("/api/sessions", headers=hb).json() == []

    assert client.delete(f"/api/content/{cid}", headers=ha).status_code == 204
    assert client.get(f"/api/content/{cid}", headers=ha).status_code == 404
    assert len(client.get("/api/sessions", headers=ha).json()) == 1


def test_profile_password_delete(client):
    register(client)
    h = login(client)
    assert client.patch("/api/users/me", headers=h, json={"display_name": "  New  "}).json()["display_name"] == "New"
    assert client.post("/api/users/me/password", headers=h, json={"current_password": "wrong123", "new_password": "another123"}).status_code == 400
    assert client.post("/api/users/me/password", headers=h, json={"current_password": "secret123", "new_password": "weak"}).status_code == 422
    assert client.post("/api/users/me/password", headers=h, json={"current_password": "secret123", "new_password": "another123"}).status_code == 204
    assert client.get("/api/users/me", headers=h).status_code == 401  # old token invalidated
    h2 = login(client, pw="another123")
    client.post("/api/content", headers=h2, json={"type": "text", "title": "t", "source": "x" * 30})
    assert client.delete("/api/users/me", headers=h2).status_code == 204
    assert client.get("/api/users/me", headers=h2).status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@example.com", "password": "another123"}).status_code == 401
    assert register(client).status_code == 201
