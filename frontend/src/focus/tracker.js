// Attention tracking that runs entirely in the browser:
//   camera -> MediaPipe FaceLandmarker (478 landmarks, 10 fps)
//          -> sliding window of 100 frames (~10 s)
//          -> attention model v4_2.onnx (onnxruntime-web, WASM)
//          -> score 0..1 (+ 5-level class)
// Only the score leaves the browser. Video frames and landmarks are never sent.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web/wasm';

export const FPS = 10;
export const WINDOW = 100;          // frames per model input
const POINTS = 478;
const FRAME_LEN = POINTS * 3;
export const SCORE_EVERY_MS = 2000; // a new score every 2 s once the window is full
const NO_FACE_RESET_MS = 2000;      // window is cleared after 2 s without a face

const MODEL_URL = '/models/v4_2.onnx';
const MP_WASM = '/mediapipe/wasm';
const MP_MODEL_LOCAL = '/mediapipe/face_landmarker.task';
const MP_MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Only the .wasm binary is fetched; its JS glue is already inside the bundle.
ort.env.wasm.wasmPaths = { wasm: '/ort/ort-wasm-simd-threaded.wasm' };
ort.env.wasm.numThreads = 1;   // no cross-origin isolation needed

let modelsPromise = null;

/** Load the attention model (ONNX, runs in WASM in this tab). */
export function loadAttentionModel() {
  return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
}

/** MediaPipe WASM files, served from our own origin. */
export function loadVisionFileset() {
  return FilesetResolver.forVisionTasks(MP_WASM);
}

async function pickFaceModel() {
  try {
    const r = await fetch(MP_MODEL_LOCAL, { method: 'HEAD' });
    if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) return MP_MODEL_LOCAL;
  } catch { /* fall through */ }
  return MP_MODEL_CDN;
}

/** Load MediaPipe + the ONNX model once and reuse them across sessions. */
export function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const [vision, faceModel] = await Promise.all([loadVisionFileset(), pickFaceModel()]);
      const createLandmarker = (delegate) => FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: faceModel, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      // CPU delegate: ~10-20 ms per frame and works the same in every browser
      // (the GPU delegate fails on machines without WebGL2).
      const landmarker = await createLandmarker('CPU');
      const session = await loadAttentionModel();
      return { landmarker, session };
    })().catch((err) => {
      modelsPromise = null; // allow a retry
      throw err;
    });
  }
  return modelsPromise;
}

/** Run the attention model on a window of frames. Exported for testing. */
export async function scoreWindow(session, frames /* Float32Array(WINDOW*FRAME_LEN) */) {
  const input = new ort.Tensor('float32', frames, [1, WINDOW, POINTS, 3]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const raw = outputs[session.outputNames[0]].data[0];
  const score = Math.min(1, Math.max(0, Number(raw)));
  let level = null;
  const logitsName = session.outputNames.find((n) => n.includes('class'));
  if (logitsName) {
    const logits = Array.from(outputs[logitsName].data);
    level = logits.indexOf(Math.max(...logits));
  }
  return { score, level };
}

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `מצלמה ${i + 1}` }));
}

export class FocusTracker {
  /**
   * @param {HTMLVideoElement} video  element that shows the camera preview
   * @param {{onStatus?:Function, onScore?:Function, onProgress?:Function}} handlers
   */
  constructor(video, handlers = {}) {
    this.video = video;
    this.h = handlers;
    this.frames = [];             // ring of Float32Array(FRAME_LEN)
    this.stream = null;
    this.timer = null;
    this.lastScoreAt = 0;
    this.lastFaceAt = 0;
    this.lastVideoTime = -1;
    this.busy = false;
    this.stopped = false;
    this.faceVisible = null;
  }

  status(name, extra) { this.h.onStatus?.(name, extra); }

  async start(deviceId) {
    this.stopped = false;
    this.status('loading');
    await this.openCamera(deviceId);
    let models;
    try {
      models = await loadModels();
    } catch (err) {
      const e = new Error(`לא הצלחנו לטעון את מודל זיהוי הפנים או מודל הקשב (${err?.message || err}). בדקו את החיבור ונסו שוב.`);
      e.name = 'ModelLoadError';
      throw e;
    }
    const { landmarker, session } = models;
    if (this.stopped) return;
    this.landmarker = landmarker;
    this.session = session;
    this.status('collecting');
    this.h.onProgress?.(0);
    this.timer = setInterval(() => this.tick(), 1000 / FPS);
  }

  async openCamera(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('הדפדפן לא תומך בגישה למצלמה (נדרש HTTPS או localhost).');
    }
    this.closeCamera();
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
  }

  async switchCamera(deviceId) {
    this.frames = [];
    this.h.onProgress?.(0);
    await this.openCamera(deviceId);
  }

  closeCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    this.closeCamera();
    this.frames = [];
  }

  setFace(visible) {
    if (visible !== this.faceVisible) {
      this.faceVisible = visible;
      this.status(visible ? (this.frames.length >= WINDOW ? 'tracking' : 'collecting') : 'no_face');
    }
  }

  tick() {
    const v = this.video;
    if (!this.landmarker || !v || v.readyState < 2 || v.videoWidth === 0) return;
    const now = performance.now();
    if (v.currentTime === this.lastVideoTime) return; // same frame as last time
    this.lastVideoTime = v.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(v, now);
    } catch {
      return;
    }
    const face = result?.faceLandmarks?.[0];
    if (!face || face.length < POINTS) {
      this.setFace(false);
      if (this.lastFaceAt && now - this.lastFaceAt > NO_FACE_RESET_MS && this.frames.length) {
        this.frames = [];
        this.h.onProgress?.(0);
      }
      return;
    }
    this.lastFaceAt = now;

    const f = new Float32Array(FRAME_LEN);
    for (let i = 0; i < POINTS; i++) {
      f[i * 3] = face[i].x;
      f[i * 3 + 1] = face[i].y;
      f[i * 3 + 2] = face[i].z;
    }
    this.frames.push(f);
    if (this.frames.length > WINDOW) this.frames.shift();
    this.setFace(true);

    if (this.frames.length < WINDOW) {
      this.h.onProgress?.(this.frames.length / WINDOW);
      return;
    }
    this.h.onProgress?.(1);
    if (!this.busy && now - this.lastScoreAt >= SCORE_EVERY_MS) {
      this.lastScoreAt = now;
      this.runModel();
    }
  }

  async runModel() {
    this.busy = true;
    try {
      const input = new Float32Array(WINDOW * FRAME_LEN);
      this.frames.forEach((f, i) => input.set(f, i * FRAME_LEN));
      const out = await scoreWindow(this.session, input);
      if (!this.stopped) {
        this.status('tracking');
        this.h.onScore?.(out);
      }
    } catch (err) {
      this.status('model_error', err?.message);
    } finally {
      this.busy = false;
    }
  }
}
