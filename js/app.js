/* ============================================================
   MAI-Background — App logic
   Real-time person background removal with MediaPipe Selfie
   Segmentation. All processing is local (in-browser).
   ============================================================ */

/* ---------- DOM ---------- */
const $ = (sel) => document.querySelector(sel);

const home         = $('#home');
const dropzone     = $('#dropzone');
const fileInput    = $('#fileInput');
const camInput     = $('#camInput');
const recBtn       = $('#recBtn');
const upBtn        = $('#upBtn');
const workspace    = $('#workspace');
const actionbar    = $('#actionbar');
const infoBtn      = $('#infoBtn');
const infoSheet    = $('#infoSheet');
const stage        = $('#stage');
const canvas       = $('#outputCanvas');
const video        = $('#sourceVideo');
const stageStatus  = $('#stageStatus');
const stageStatusText = $('#stageStatusText');

const playPauseBtn = $('#playPauseBtn');
const iconPlay     = playPauseBtn.querySelector('.icon-play');
const iconPause    = playPauseBtn.querySelector('.icon-pause');
const seekBar      = $('#seekBar');
const timeLabel    = $('#timeLabel');
const muteBtn      = $('#muteBtn');

const bgOptions    = document.querySelectorAll('.bg-opt');
const ctrlColor    = $('#ctrlColor');
const ctrlImage    = $('#ctrlImage');
const ctrlVideo    = $('#ctrlVideo');
const bgColor      = $('#bgColor');
const presets      = document.querySelectorAll('.preset');
const bgImageInput = $('#bgImageInput');
const bgVideoInput = $('#bgVideoInput');
const edgeRange    = $('#edgeRange');
const resSelect    = $('#resSelect');
const qualitySelect = $('#qualitySelect');
const srcInfo      = $('#srcInfo');

const exportBtn    = $('#exportBtn');
const exportBtnLabel = $('#exportBtnLabel');
const exportNote   = $('#exportNote');
const exportProgress = $('#exportProgress');
const exportBar    = $('#exportBar');
const newVideoBtn  = $('#newVideoBtn');

const ctx = canvas.getContext('2d');

/* ---------- State ---------- */
const state = {
  bgMode: 'blur',          // blur | transparent | color | image | video
  color: '#10B981',
  edge: 3,                 // mask edge blur (px)
  bgImage: null,           // HTMLImageElement
  bgVideo: null,           // HTMLVideoElement
  modelReady: false,
  recording: false,
  rafId: null,
  nativeW: 0,              // source video native dimensions
  nativeH: 0,
};

let segmenter = null;
let objectUrls = [];

/* ============================================================
   1. MediaPipe init
   ============================================================ */
function initSegmenter() {
  if (typeof SelfieSegmentation === 'undefined') {
    setStatus('No se pudo cargar el modelo de IA. Revisa tu conexión.', false);
    return;
  }
  segmenter = new SelfieSegmentation({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
  });
  segmenter.setOptions({ modelSelection: 1 }); // 1 = general (256x256), better quality
  segmenter.onResults(onResults);
}

/* ============================================================
   2. Frame compositing
   ============================================================ */
function onResults(results) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Soften the mask edges
  if (state.edge > 0) ctx.filter = `blur(${state.edge}px)`;
  ctx.drawImage(results.segmentationMask, 0, 0, w, h);
  ctx.filter = 'none';

  // Keep only the person (pixels where mask is opaque)
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(results.image, 0, 0, w, h);

  // Paint the chosen background behind the person
  ctx.globalCompositeOperation = 'destination-over';
  paintBackground(ctx, results.image, w, h);

  ctx.restore(); // resets filter + globalCompositeOperation
}

function paintBackground(c, sourceFrame, w, h) {
  switch (state.bgMode) {
    case 'transparent':
      // leave it transparent — nothing to paint
      break;
    case 'color':
      c.fillStyle = state.color;
      c.fillRect(0, 0, w, h);
      break;
    case 'blur':
      c.filter = 'blur(14px)';
      drawCover(c, sourceFrame, w, h, 1.06);
      c.filter = 'none';
      break;
    case 'image':
      if (state.bgImage && state.bgImage.complete) {
        drawCover(c, state.bgImage, w, h);
      } else {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
      }
      break;
    case 'video':
      if (state.bgVideo && state.bgVideo.readyState >= 2) {
        drawCover(c, state.bgVideo, w, h);
      } else {
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, h);
      }
      break;
  }
}

/* cover-fit draw (like object-fit: cover) */
function drawCover(c, src, w, h, zoom = 1) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return;
  const scale = Math.max(w / sw, h / sh) * zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  c.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/* ============================================================
   3. Render loop
   ============================================================ */
async function renderLoop() {
  if (segmenter && state.modelReady && !video.paused && !video.ended && video.readyState >= 2) {
    try {
      await segmenter.send({ image: video });
    } catch (e) {
      // transient frame errors are non-fatal
    }
  }
  state.rafId = requestAnimationFrame(renderLoop);
}

/* ============================================================
   4. Loading a video
   ============================================================ */
function loadVideoFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    alert('Por favor elige un archivo de video válido.');
    return;
  }
  revokeUrls();
  const url = URL.createObjectURL(file);
  objectUrls.push(url);
  video.src = url;
  video.muted = false;
  video.currentTime = 0;

  home.hidden = true;
  workspace.hidden = false;
  actionbar.hidden = false;
  setStatus('Cargando modelo de IA…', true);

  video.addEventListener('loadedmetadata', onVideoReady, { once: true });
}

async function onVideoReady() {
  state.nativeW = video.videoWidth || 1280;
  state.nativeH = video.videoHeight || 720;
  srcInfo.textContent = `Vídeo original: ${state.nativeW}×${state.nativeH}`;
  // display box keeps the native aspect ratio; canvas internal size = export res
  stage.style.aspectRatio = `${state.nativeW} / ${state.nativeH}`;
  populateResolutions(state.nativeH);
  applyResolution();

  if (!segmenter) initSegmenter();

  // Warm up the model on the first frame
  try {
    state.modelReady = true;
    await segmenter.send({ image: video });
    setStatus('', false);
  } catch (e) {
    setStatus('Error al iniciar el modelo. Recarga la página.', false);
    return;
  }

  if (!state.rafId) renderLoop();
  updateTime();
}

function setStatus(text, show) {
  stageStatusText.textContent = text;
  stageStatus.hidden = !show;
}

/* ---------- Resolution / quality ---------- */
// Offer only standard heights below the source (never upscale → never invents quality)
function populateResolutions(nativeH) {
  resSelect.querySelectorAll('option[data-dyn]').forEach((o) => o.remove());
  [2160, 1440, 1080, 720, 480].filter((h) => h < nativeH).forEach((h) => {
    const o = document.createElement('option');
    o.value = String(h);
    o.textContent = `${h}p`;
    o.dataset.dyn = '1';
    resSelect.appendChild(o);
  });
  resSelect.value = 'original';
}

// Canvas internal resolution = chosen export resolution (capped at native).
function applyResolution() {
  let w = state.nativeW, h = state.nativeH;
  if (resSelect.value !== 'original') {
    h = Math.min(Number(resSelect.value), state.nativeH);
    w = Math.round((state.nativeW / state.nativeH) * h);
  }
  // even dimensions keep VP8/VP9 encoders happy
  canvas.width = w - (w % 2);
  canvas.height = h - (h % 2);
}

resSelect.addEventListener('change', () => {
  applyResolution();
  // repaint a frame so the change is visible even while paused
  if (segmenter && state.modelReady && video.readyState >= 2) {
    segmenter.send({ image: video }).catch(() => {});
  }
});

/* ============================================================
   5. Transport controls
   ============================================================ */
playPauseBtn.addEventListener('click', () => {
  if (video.paused) video.play(); else video.pause();
});
video.addEventListener('play', () => { iconPlay.hidden = true; iconPause.hidden = false; playPauseBtn.setAttribute('aria-label', 'Pausar'); });
video.addEventListener('pause', () => { iconPlay.hidden = false; iconPause.hidden = true; playPauseBtn.setAttribute('aria-label', 'Reproducir'); });
video.addEventListener('ended', () => { iconPlay.hidden = false; iconPause.hidden = true; });

video.addEventListener('timeupdate', updateTime);
function updateTime() {
  const cur = video.currentTime || 0;
  const dur = video.duration || 0;
  if (dur) seekBar.value = (cur / dur) * 100;
  timeLabel.textContent = `${fmt(cur)} / ${fmt(dur)}`;
}
seekBar.addEventListener('input', () => {
  if (video.duration) video.currentTime = (seekBar.value / 100) * video.duration;
});
function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}
muteBtn.addEventListener('click', () => {
  video.muted = !video.muted;
  muteBtn.style.opacity = video.muted ? 0.5 : 1;
});

/* ============================================================
   6. Background controls
   ============================================================ */
bgOptions.forEach((btn) => {
  btn.addEventListener('click', () => {
    bgOptions.forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-checked', 'false'); });
    btn.classList.add('is-active');
    btn.setAttribute('aria-checked', 'true');

    state.bgMode = btn.dataset.bg;
    stage.dataset.bg = state.bgMode;

    ctrlColor.hidden = state.bgMode !== 'color';
    ctrlImage.hidden = state.bgMode !== 'image';
    ctrlVideo.hidden = state.bgMode !== 'video';

    if (state.bgMode === 'video' && state.bgVideo) state.bgVideo.play().catch(() => {});
  });
});

bgColor.addEventListener('input', (e) => { state.color = e.target.value; });
presets.forEach((p) => p.addEventListener('click', () => {
  state.color = p.dataset.color;
  bgColor.value = p.dataset.color;
}));

bgImageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  objectUrls.push(url);
  const img = new Image();
  img.onload = () => { state.bgImage = img; };
  img.src = url;
});

bgVideoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  objectUrls.push(url);
  const v = document.createElement('video');
  v.src = url;
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.play().catch(() => {});
  state.bgVideo = v;
});

edgeRange.addEventListener('input', (e) => { state.edge = Number(e.target.value); });

/* ============================================================
   7. Export (MediaRecorder)
   ============================================================ */
function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

exportBtn.addEventListener('click', async () => {
  if (state.recording) return;
  if (!window.MediaRecorder) { alert('Tu navegador no soporta la grabación de video.'); return; }

  const mime = pickMime();
  if (!mime) { alert('No hay un formato de grabación compatible.'); return; }

  // Build a stream: composited canvas video + original audio
  const fps = 30;
  const stream = canvas.captureStream(fps);
  try {
    const src = video.captureStream ? video.captureStream() : video.mozCaptureStream();
    src.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch (e) { /* no audio track — export video only */ }

  const bitrate = Number(qualitySelect.value) || 8_000_000;
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    downloadBlob(blob);
    finishExport();
  };

  // Restart playback from the beginning and record to the end
  state.recording = true;
  exportBtn.disabled = true;
  exportBtnLabel.textContent = 'Grabando…';
  exportProgress.hidden = false;
  exportNote.textContent = 'No cierres esta pestaña. Grabando de inicio a fin…';

  video.pause();
  video.currentTime = 0;
  await once(video, 'seeked');
  // restart the background video so it's in sync from frame 0
  if (state.bgMode === 'video' && state.bgVideo) {
    try { state.bgVideo.currentTime = 0; await state.bgVideo.play(); } catch (e) {}
  }
  recorder.start();
  await video.play();

  const onTick = () => {
    if (video.duration) exportBar.style.width = `${(video.currentTime / video.duration) * 100}%`;
  };
  video.addEventListener('timeupdate', onTick);

  video.addEventListener('ended', () => {
    video.removeEventListener('timeupdate', onTick);
    if (recorder.state !== 'inactive') recorder.stop();
  }, { once: true });
});

function finishExport() {
  state.recording = false;
  exportBtn.disabled = false;
  exportBtnLabel.textContent = 'Grabar y exportar';
  exportNote.textContent = 'Reproduce el resultado de inicio a fin para grabarlo (WebM).';
  exportBar.style.width = '0%';
  exportProgress.hidden = true;
}

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `mai-background-${stamp}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function once(el, ev) {
  return new Promise((res) => el.addEventListener(ev, res, { once: true }));
}

/* ============================================================
   8. Upload wiring
   ============================================================ */
recBtn.addEventListener('click', () => camInput.click());
upBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => loadVideoFile(e.target.files[0]));
camInput.addEventListener('change', (e) => loadVideoFile(e.target.files[0]));

// Info sheet
function openSheet() { infoSheet.hidden = false; }
function closeSheet() { infoSheet.hidden = true; }
infoBtn.addEventListener('click', openSheet);
infoSheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !infoSheet.hidden) closeSheet(); });

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); }));
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('is-dragover'); }));
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) loadVideoFile(file);
});

newVideoBtn.addEventListener('click', () => {
  video.pause();
  workspace.hidden = true;
  actionbar.hidden = true;
  home.hidden = false;
  fileInput.value = '';
  camInput.value = '';
});

function revokeUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

/* ============================================================
   9. Service worker (PWA)
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
