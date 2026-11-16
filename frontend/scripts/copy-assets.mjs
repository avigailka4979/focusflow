// Copies the runtime files the browser needs into public/ so they are served
// by our own nginx (no CDN at runtime): MediaPipe WASM, ONNX Runtime WASM, and
// the attention model. The MediaPipe face model (face_landmarker.task) is
// downloaded by the Dockerfile into public/mediapipe/.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const nm = join(root, 'node_modules');

mkdirSync(join(pub, 'ort'), { recursive: true });
mkdirSync(join(pub, 'mediapipe', 'wasm'), { recursive: true });
mkdirSync(join(pub, 'models'), { recursive: true });

for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  cpSync(join(nm, 'onnxruntime-web', 'dist', f), join(pub, 'ort', f));
}
cpSync(join(nm, '@mediapipe', 'tasks-vision', 'wasm'), join(pub, 'mediapipe', 'wasm'), { recursive: true });

// Model: frontend/models (inside the Docker build context) or ../models (repo root)
const candidates = [join(root, 'models', 'v3.onnx'), join(root, '..', 'models', 'v3.onnx')];
const model = candidates.find(existsSync);
if (!model) {
  console.error('v3.onnx not found in', candidates);
  process.exit(1);
}
cpSync(model, join(pub, 'models', 'v3.onnx'));
console.log('assets copied');
