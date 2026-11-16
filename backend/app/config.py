"""Settings, read from environment variables (docker-compose passes them from .env)."""
import os

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://mongo:27017")
DB_NAME = os.getenv("DB_NAME", "focusflow")

# Optional. If missing or too short, a random secret is generated once and kept in the DB.
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
JWT_ALGORITHM = "HS256"
TOKEN_TTL_MINUTES = int(os.getenv("TOKEN_TTL_MINUTES", "120"))

# Comma-separated list. The client normally reaches the API through its own nginx
# proxy (same origin), so CORS is only needed for local development.
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",") if o.strip()]

# Login throttling
MAX_FAILED_LOGINS = int(os.getenv("MAX_FAILED_LOGINS", "5"))
LOGIN_WINDOW_SECONDS = int(os.getenv("LOGIN_WINDOW_SECONDS", "900"))

BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", "12"))
