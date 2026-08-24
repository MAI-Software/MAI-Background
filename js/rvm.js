/* ============================================================
   RVM — Robust Video Matting engine (onnxruntime-web).
   Recurrent, temporally-stable person matting. 100% in-browser:
   WebGPU when available, WASM single-thread fallback.
   Replaces MediaPipe Selfie Segmentation (binary mask → real alpha).
   Model: rvm_mobilenetv3_fp32.onnx (PeterL1n/RobustVideoMatting).
   ============================================================ */

// 1.23.0: WebGPU EP supports RVM's AveragePool(ceil_mode) — earlier builds throw.
const ORT_VER  = '1.23.0';
const ORT_DIST = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
const MODEL_URL = 'models/rvm_mobilenetv3_fp32.onnx';

// Cap the longest processed side (the refiner runs here → edge sharpness).
const PROC_CAP = 960;

// RVM segments on the internally-downsampled input. Its recommended ratios all
// land the downsampled longer side around ~270 px (1080p×0.25, 720p×0.375 ≈ 270),
// so keep the encoder there regardless of source size. A ratio far above this
// was the original "person erased" bug (blind encoder); far below misses too.
// Clamp to RVM's sane range [0.15, 0.5].
const TARGET_DOWNSAMPLE = 272;
function ratioForLongestSide(longest) {
  return Math.max(0.15, Math.min(0.5, TARGET_DOWNSAMPLE / longest));
}

function zeroState() {
  return new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1]);
}

async function fetchModel(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model fetch ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return await res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(Math.round((loaded / total) * 100));
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf.buffer;
}

export const RVM = {
  session: null,
  provider: 'wasm',
  rec: null,            // recurrent states [r1i..r4i], fed back each frame
  ratio: null,          // downsample_ratio tensor [1]
  procW: 0,
  procH: 0,
  src: null,            // reused Float32Array [1,3,H,W]
  out: null,            // reused ImageData (person cutout, RGBA)
  work: null,           // offscreen canvas (read source + write cutout)
  workCtx: null,
  busy: false,

  async init(onProgress) {
    ort.env.wasm.wasmPaths = ORT_DIST;
    ort.env.wasm.numThreads = 1;            // no COOP/COEP → single thread
    const buf = await fetchModel(MODEL_URL, onProgress);
    const providers = [];
    if (navigator.gpu) providers.push('webgpu');
    providers.push('wasm');
    this.session = await ort.InferenceSession.create(buf, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    });
    this.provider = navigator.gpu ? 'webgpu' : 'wasm';
    this.resetState();
  },

  // Clear temporal memory. Call on new clip and on every seek (continuity break).
  resetState() {
    if (this.rec) this.rec.forEach((t) => t.dispose && t.dispose());
    this.rec = [zeroState(), zeroState(), zeroState(), zeroState()];
  },

  // Derive processing resolution + downsample ratio from the source dimensions.
  setSize(w, h) {
    const long = Math.max(w, h);
    const scale = long > PROC_CAP ? PROC_CAP / long : 1;
    let pw = Math.round(w * scale), ph = Math.round(h * scale);
    pw -= pw % 2; ph -= ph % 2;
    this.procW = pw; this.procH = ph;

    const r = ratioForLongestSide(Math.max(pw, ph));
    this.ratio = new ort.Tensor('float32', new Float32Array([r]), [1]);

    this.src = new Float32Array(3 * pw * ph);
    if (!this.work) {
      this.work = document.createElement('canvas');
      this.workCtx = this.work.getContext('2d', { willReadFrequently: true });
    }
    this.work.width = pw; this.work.height = ph;
    this.out = this.workCtx.createImageData(pw, ph);
  },

  // Process one frame → canvas (person with alpha) at proc res, or null.
  async process(video) {
    if (!this.session || this.busy) return this.work;
    this.busy = true;
    try {
      const w = this.procW, h = this.procH, n = w * h;
      this.workCtx.drawImage(video, 0, 0, w, h);
      const rgba = this.workCtx.getImageData(0, 0, w, h).data;

      // HWC uint8 RGBA → CHW float32 RGB (0..1)
      const src = this.src;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        src[i]         = rgba[j]     / 255;
        src[i + n]     = rgba[j + 1] / 255;
        src[i + 2 * n] = rgba[j + 2] / 255;
      }
      const srcT = new ort.Tensor('float32', src, [1, 3, h, w]);

      const res = await this.session.run({
        src: srcT,
        r1i: this.rec[0], r2i: this.rec[1], r3i: this.rec[2], r4i: this.rec[3],
        downsample_ratio: this.ratio,
      });

      // Feed recurrent states forward; dispose the previous ones.
      const old = this.rec;
      this.rec = [res.r1o, res.r2o, res.r3o, res.r4o];
      old.forEach((t) => t.dispose && t.dispose());

      const fgr = res.fgr.data;   // [1,3,h,w] color-decontaminated foreground
      const pha = res.pha.data;   // [1,1,h,w] alpha
      const out = this.out.data;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        out[j]     = fgr[i]         * 255;
        out[j + 1] = fgr[i + n]     * 255;
        out[j + 2] = fgr[i + 2 * n] * 255;
        out[j + 3] = pha[i]         * 255;
      }
      this.workCtx.putImageData(this.out, 0, 0);

      srcT.dispose && srcT.dispose();
      res.fgr.dispose && res.fgr.dispose();
      res.pha.dispose && res.pha.dispose();
      return this.work;
    } finally {
      this.busy = false;
    }
  },
};
