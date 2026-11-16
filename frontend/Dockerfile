# ---- build the React app ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# MediaPipe face model, served locally so the site needs no CDN at runtime
ADD https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task public/mediapipe/face_landmarker.task
RUN npm run build \
 && test -s dist/models/v3.onnx \
 && test -s dist/mediapipe/face_landmarker.task \
 && chmod -R a+rX dist

# ---- serve with nginx ----
FROM nginx:1.27-alpine
ENV BACKEND_URL=http://backend:8000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
