// ===== Utility =====
const noteToFreq = (n) => {
  const midiMap = { C4:60,'C#4':61,D4:62,'D#4':63,E4:64,F4:65,'F#4':66,G4:67,'G#4':68,A4:69,'A#4':70,B4:71,C5:72 };
  const m = midiMap[n] ?? 60;
  return 440 * Math.pow(2, (m - 69) / 12);
};
const KEY_TO_NOTE = { a:'C4', w:'C#4', s:'D4', e:'D#4', d:'E4', f:'F4', t:'F#4', g:'G4', y:'G#4', h:'A4', u:'A#4', j:'B4', k:'C5' };

// ===== Audio Graph =====
let ctx, masterGain, analyser, filter, lfo, lfoGain, delayNode, feedbackGain, delayMixGain, globalVoiceBus;
const activeVoices = new Set();  // pointer/mouse notes
const keyVoices = new Map();     // key -> voice
let started = false;

const state = {
  wave: 'square',
  env: { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.4 },
  filter: { type: 'lowpass', cutoff: 1200, q: 0.7 },
  lfo: { rate: 4, depth: 500 },
  delay: { time: 0.25, feedback: 0.35, mix: 0.3 }
};

async function ensureContextRunning() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(e) { console.warn('resume blocked', e); } }
  return ctx.state === 'running';
}

async function initAudio() {
  if (started) return;
  await ensureContextRunning();

  masterGain = ctx.createGain(); masterGain.gain.value = 0.8;

  filter = ctx.createBiquadFilter();
  filter.type = state.filter.type;
  filter.frequency.value = state.filter.cutoff;
  filter.Q.value = state.filter.q;

  delayNode = ctx.createDelay(1.5);
  feedbackGain = ctx.createGain();
  delayMixGain = ctx.createGain();
  delayNode.delayTime.value = state.delay.time;
  feedbackGain.gain.value  = state.delay.feedback;
  delayMixGain.gain.value  = state.delay.mix;
  delayNode.connect(feedbackGain); feedbackGain.connect(delayNode);

  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;

  lfo = ctx.createOscillator(); lfoGain = ctx.createGain();
  lfo.frequency.value = state.lfo.rate; lfoGain.gain.value = state.lfo.depth;
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency);

  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = delayMixGain;

  globalVoiceBus = ctx.createGain();
  globalVoiceBus.connect(filter);
  filter.connect(dry);
  filter.connect(delayNode);
  delayNode.connect(wet);

  const sum = ctx.createGain();
  dry.connect(sum); wet.connect(sum);
  sum.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  lfo.start();
  started = true;
  applyParams();
  console.log('[Audio] graph initialized.');
}

function startNote(freq) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = state.wave; osc.frequency.setValueAtTime(freq, now);
  const vca = ctx.createGain(); vca.gain.setValueAtTime(0, now);
  const { attack, decay, sustain } = state.env;
  vca.gain.linearRampToValueAtTime(1, now + attack);
  vca.gain.linearRampToValueAtTime(sustain, now + attack + decay);
  osc.connect(vca); vca.connect(globalVoiceBus); osc.start(now);
  const voice = { osc, vca };
  activeVoices.add(voice); return voice;
}
function releaseVoice(v) {
  if (!v) return; const now = ctx.currentTime; const { release } = state.env;
  try {
    v.vca.gain.cancelScheduledValues(now);
    v.vca.gain.setValueAtTime(v.vca.gain.value, now);
    v.vca.gain.linearRampToValueAtTime(0, now + release);
    v.osc.stop(now + release + 0.05);
  } catch {}
  activeVoices.delete(v);
}
function stopAllNotes() {
  if (!started) return;
  for (const v of [...activeVoices]) releaseVoice(v);
  for (const [k,v] of keyVoices.entries()) { releaseVoice(v); keyVoices.delete(k); }
}

// ===== UI =====
const $ = (id) => document.getElementById(id);
const waveSelect = $('waveSelect');
const attack = $('attack'), decay = $('decay'), sustain = $('sustain'), release = $('release');
const cutoff = $('cutoff'), q = $('q'), filterType = $('filterType');
const lfoRate = $('lfoRate'), lfoDepth = $('lfoDepth');
const delayTime = $('delayTime'), delayFeedback = $('delayFeedback'), delayMix = $('delayMix');
const imageInput = $('imageInput'), imageReactive = $('imageReactive');

$('startBtn').addEventListener('click', async () => { await initAudio(); });
$('stopAllBtn').addEventListener('click', () => started && stopAllNotes());
waveSelect.addEventListener('change', () => state.wave = waveSelect.value);
[attack,decay,sustain,release].forEach(el => el.addEventListener('input', () => {
  state.env.attack  = parseFloat(attack.value);
  state.env.decay   = parseFloat(decay.value);
  state.env.sustain = parseFloat(sustain.value);
  state.env.release = parseFloat(release.value);
}));
filterType.addEventListener('change', () => { if (started) { state.filter.type = filterType.value; filter.type = state.filter.type; } });
cutoff.addEventListener('input', () => { if (started) { state.filter.cutoff = +cutoff.value; filter.frequency.setTargetAtTime(state.filter.cutoff, ctx.currentTime, 0.01); } });
q.addEventListener('input', () => { if (started) { state.filter.q = +q.value; filter.Q.setTargetAtTime(state.filter.q, ctx.currentTime, 0.01); } });
lfoRate.addEventListener('input', () => { if (started) { state.lfo.rate = +lfoRate.value; lfo.frequency.setTargetAtTime(state.lfo.rate, ctx.currentTime, 0.01); } });
lfoDepth.addEventListener('input', () => { if (started) { state.lfo.depth = +lfoDepth.value; lfoGain.gain.setTargetAtTime(state.lfo.depth, ctx.currentTime, 0.02); } });
delayTime.addEventListener('input', () => { if (started) { state.delay.time = +delayTime.value; delayNode.delayTime.setTargetAtTime(state.delay.time, ctx.currentTime, 0.02); } });
delayFeedback.addEventListener('input', () => { if (started) { state.delay.feedback = +delayFeedback.value; feedbackGain.gain.setTargetAtTime(state.delay.feedback, ctx.currentTime, 0.02); } });
delayMix.addEventListener('input', () => { if (started) { state.delay.mix = +delayMix.value; delayMixGain.gain.setTargetAtTime(state.delay.mix, ctx.currentTime, 0.02); } });

document.querySelectorAll('.noteBtn').forEach(btn => {
  const down = async (e) => { e.preventDefault(); await initAudio(); startNote(noteToFreq(btn.dataset.note)); };
  const up = () => started && stopAllNotes();
  btn.addEventListener('pointerdown', down, { passive:false });
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
  btn.addEventListener('click', async (e) => { e.preventDefault(); await initAudio(); const v = startNote(noteToFreq(btn.dataset.note)); setTimeout(()=>releaseVoice(v), 180); });
});

window.addEventListener('keydown', async (e) => {
  const key = e.key.toLowerCase(); if (!(key in KEY_TO_NOTE) || keyVoices.has(key)) return;
  e.preventDefault(); await initAudio(); const v = startNote(noteToFreq(KEY_TO_NOTE[key])); keyVoices.set(key, v);
});
window.addEventListener('keyup', (e) => { const key = e.key.toLowerCase(); const v = keyVoices.get(key); if (!v) return; releaseVoice(v); keyVoices.delete(key); });

function applyParams() {
  if (!started) return;
  filter.type = state.filter.type;
  filter.frequency.value = parseFloat(cutoff.value);
  filter.Q.value = parseFloat(q.value);
  lfo.frequency.value = parseFloat(lfoRate.value);
  lfoGain.gain.value  = parseFloat(lfoDepth.value);
  delayNode.delayTime.value = parseFloat(delayTime.value);
  feedbackGain.gain.value  = parseFloat(delayFeedback.value);
  delayMixGain.gain.value  = parseFloat(delayMix.value);
}

// ===== Display Canvases =====
const cSeq  = document.getElementById('seq');   const gSeq  = cSeq.getContext('2d');
const cImg  = document.getElementById('img');   const gImg  = cImg.getContext('2d');
const cWave = document.getElementById('wave');  const gWave = cWave.getContext('2d');
const cBars = document.getElementById('bars');  const gBars = cBars.getContext('2d');

// Resize all canvases to their CSS size to avoid scroll and keep crispness
function resizeCanvasToDisplaySize(canvas) {
  const { clientWidth:w, clientHeight:h } = canvas;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}
function resizeAll() {
  [cSeq, cImg, cWave, cBars].forEach(resizeCanvasToDisplaySize);
}
window.addEventListener('resize', resizeAll);
new ResizeObserver(resizeAll).observe(document.querySelector('.display'));
resizeAll();

// ===== Image-reactive (top-right, no stretch) =====
let reactiveImg = null, imgReady = false, offscreen = null, offctx = null;
imageInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = () => { reactiveImg = img; imgReady = true; URL.revokeObjectURL(url); };
  img.src = url;
});
function fitContain(w, h, iw, ih) {
  const s = Math.min(w/iw, h/ih, 1); const dw = Math.max(1, Math.floor(iw*s)); const dh = Math.max(1, Math.floor(ih*s));
  const dx = Math.floor((w - dw)/2), dy = Math.floor((h - dh)/2); return {dw, dh, dx, dy};
}
function ensureOffscreen(w, h) {
  if (!reactiveImg) return;
  const { dw, dh } = fitContain(w, h, reactiveImg.width, reactiveImg.height);
  if (!offscreen || offscreen.width !== dw || offscreen.height !== dh) {
    offscreen = document.createElement('canvas'); offscreen.width = dw; offscreen.height = dh;
    offctx = offscreen.getContext('2d'); offctx.imageSmoothingEnabled = true;
  }
  offctx.clearRect(0,0,offscreen.width,offscreen.height);
  offctx.drawImage(reactiveImg, 0, 0, offscreen.width, offscreen.height);
}

// ===== Analyser data buffers =====
let wave = new Uint8Array(1024);
let bins = new Uint8Array(1024);

// ===== Drawing loops =====
function drawSequencerGrid() {
  resizeCanvasToDisplaySize(cSeq);
  gSeq.clearRect(0,0,cSeq.width,cSeq.height);
  gSeq.fillStyle = '#0a0a0a'; gSeq.fillRect(0,0,cSeq.width,cSeq.height);

  // Piano-roll style grid (placeholder for now)
  const cols = 16, rows = 12;
  const cw = cSeq.width / cols, rh = cSeq.height / rows;

  gSeq.strokeStyle = '#222'; gSeq.lineWidth = 1; gSeq.globalAlpha = 0.9;
  gSeq.beginPath();
  for (let i=0;i<=cols;i++){ gSeq.moveTo(i*cw,0); gSeq.lineTo(i*cw,cSeq.height); }
  for (let j=0;j<=rows;j++){ gSeq.moveTo(0,j*rh); gSeq.lineTo(cSeq.width,j*rh); }
  gSeq.stroke();

  // Beat markers (every 4th column)
  gSeq.strokeStyle = '#444'; gSeq.lineWidth = 2;
  gSeq.beginPath();
  for (let i=0;i<=cols;i+=4){ gSeq.moveTo(i*cw,0); gSeq.lineTo(i*cw,cSeq.height); }
  gSeq.stroke();

  // TODO: when we add a real sequencer, draw active notes here
}

function drawImageReactive() {
  resizeCanvasToDisplaySize(cImg);
  gImg.clearRect(0,0,cImg.width,cImg.height);
  // background
  gImg.fillStyle = '#0a0a0a'; gImg.fillRect(0,0,cImg.width,cImg.height);
  // grid
  gImg.globalAlpha = 0.35; gImg.strokeStyle = '#222'; gImg.beginPath();
  for (let x=0;x<=cImg.width;x+=50){ gImg.moveTo(x,0); gImg.lineTo(x,cImg.height); }
  for (let y=0;y<=cImg.height;y+=50){ gImg.moveTo(0,y); gImg.lineTo(cImg.width,y); }
  gImg.stroke(); gImg.globalAlpha = 1;

  if (!analyser || !imgReady || !imageReactive.checked) return;

  analyser.getByteTimeDomainData(wave);
  ensureOffscreen(cImg.width, cImg.height);
  if (!offscreen) return;

  const { dx, dy } = fitContain(cImg.width, cImg.height, reactiveImg.width, reactiveImg.height);
  const maxDx = Math.max(8, Math.min(40, Math.floor(cImg.width * 0.03)));
  const sliceH = 4;

  for (let sy=0; sy<offscreen.height; sy+=sliceH) {
    const t = Math.floor((sy/offscreen.height) * (wave.length - 1));
    const v = (wave[t] - 128) / 128;
    const shift = v * maxDx;
    gImg.drawImage(offscreen,
      0, sy, offscreen.width, sliceH,
      dx + shift, dy + sy, offscreen.width, sliceH
    );
  }
}

function drawWaveform() {
  resizeCanvasToDisplaySize(cWave);
  gWave.clearRect(0,0,cWave.width,cWave.height);
  gWave.fillStyle = '#0a0a0a'; gWave.fillRect(0,0,cWave.width,cWave.height);

  // grid
  gWave.globalAlpha = 0.35; gWave.strokeStyle = '#222'; gWave.beginPath();
  for (let x=0;x<=cWave.width;x+=50){ gWave.moveTo(x,0); gWave.lineTo(x,cWave.height); }
  for (let y=0;y<=cWave.height;y+=50){ gWave.moveTo(0,y); gWave.lineTo(cWave.width,y); }
  gWave.stroke(); gWave.globalAlpha = 1;

  if (!analyser) return;
  analyser.getByteTimeDomainData(wave);

  gWave.lineWidth = 2; gWave.strokeStyle = '#9be58c';
  gWave.beginPath();
  for (let i=0;i<wave.length;i++){
    const x = (i/(wave.length-1))*cWave.width;
    const v = (wave[i]-128)/128;
    const y = (cWave.height/2) + v*(cWave.height*0.45);
    i===0 ? gWave.moveTo(x,y) : gWave.lineTo(x,y);
  }
  gWave.stroke();
}

function drawSpectrum() {
  resizeCanvasToDisplaySize(cBars);
  gBars.clearRect(0,0,cBars.width,cBars.height);
  gBars.fillStyle = '#0a0a0a'; gBars.fillRect(0,0,cBars.width,cBars.height);

  // grid
  gBars.globalAlpha = 0.35; gBars.strokeStyle = '#222'; gBars.beginPath();
  for (let x=0;x<=cBars.width;x+=50){ gBars.moveTo(x,0); gBars.lineTo(x,cBars.height); }
  for (let y=0;y<=cBars.height;y+=50){ gBars.moveTo(0,y); gBars.lineTo(cBars.width,y); }
  gBars.stroke(); gBars.globalAlpha = 1;

  if (!analyser) return;
  analyser.getByteFrequencyData(bins);

  const barCount = 128, step = Math.max(1, Math.floor(bins.length / barCount));
  const barW = cBars.width / barCount;
  for (let i=0;i<barCount;i++){
    const v = bins[i*step] / 255;
    const bh = v * (cBars.height - 6);
    const x = i*barW;
    const y = cBars.height - bh;
    gBars.fillStyle = '#8ab4ff';
    gBars.fillRect(x, y, barW - 1, bh);
  }
}

function draw() {
  requestAnimationFrame(draw);
  drawSequencerGrid();
  drawImageReactive();
  drawWaveform();
  drawSpectrum();
}
draw();
