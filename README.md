# FocusFlow

A learning site that measures attention through the webcam while you watch a YouTube video or read a text.
Face landmarks (MediaPipe) and the attention model (`v3.onnx`, onnxruntime-web; landmarks re-normalised to a face crop) run **in the browser**; only scores are sent to the server.

| Part | Tech | Port |
|---|---|---|
| frontend | React 19 + Vite, served by nginx (proxies `/api` → backend) | 3000 |
| backend | FastAPI + pymongo, bcrypt, JWT | 8000 (`/health`, `/docs`) |
| database | MongoDB 7 (volume `mongo-data`) | internal |

## Run (graders)

```bash
cp .env.example .env    # optional: set JWT_SECRET
docker compose up
```
Open http://localhost:3000

## Publish the images (once)

1. Push this repo to GitHub (branch `main`).
2. The workflow `.github/workflows/docker-publish.yml` runs the backend tests, then builds `linux/amd64` images and pushes
   `ghcr.io/<owner>/focusflow-backend:latest` and `ghcr.io/<owner>/focusflow-frontend:latest`.
3. GitHub → profile → **Packages** → each package → **Package settings** → **Change visibility → Public**.
4. Check from a logged-out machine: `docker pull ghcr.io/<owner>/focusflow-frontend:latest`.

If the GitHub owner is not `avigailka4979`, update the two `image:` lines in `docker-compose.yml`.

## Develop locally

```bash
# backend (needs a MongoDB at MONGODB_URI)
cd backend && pip install -r requirements.txt && MONGODB_URI=mongodb://localhost:27017 uvicorn app.main:app --reload
# tests (in-memory mongomock)
pip install pytest mongomock httpx && python -m pytest -q
# frontend (proxies /api to localhost:8000)
cd frontend && npm install && npm run dev
```
In dev, the MediaPipe face model is loaded from Google's CDN; the Docker image bundles it.

Build images from source instead of pulling:
`docker compose -f docker-compose.yml -f docker-compose.build.yml up --build`
