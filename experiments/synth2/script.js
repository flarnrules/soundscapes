// ===== Utils =====
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const noteNameToMidi = (n) => {
  const map = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
  const m = n.match(/^([A-G]#?|[A-G]b)(\d)$/); if(!m) return 60;
  const semis = map[m[1]]; const oct = +m[2];
  return 12*(oct+1)+semis;
};
const KEY_TO_NOTE = { a:'C4', w:'C#4', s:'D4', e:'D#4', d:'E4', f:'F4', t:'F#4', g:'G4', y:'G#4', h:'A4', u:'A#4', j:'B4', k:'C5' };

// ===== Audio Graph =====
let ctx, masterGain, analyser, filter, lfo, lfoGain, delayNode, feedbackGain, delayMixGain, globalVoiceBus;
const activeVoices = new Set();          // pointer/mouse voices
const keyVoices = new Map();             // key -> voice
const sustainedVoices = new Map();       // key -> voice (held by pedal)
let sustainPedal = false;
let started = false;

// synth state
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

// Live-play voice
function startNote(now, freq) {
  const osc = ctx.createOscillator(); osc.type = state.wave; osc.frequency.setValueAtTime(freq, now);
  const vca = ctx.createGain(); vca.gain.setValueAtTime(0, now);
  const { attack, decay, sustain } = state.env;
  vca.gain.linearRampToValueAtTime(1, now + attack);
  vca.gain.linearRampToValueAtTime(sustain, now + attack + decay);
  osc.connect(vca); vca.connect(globalVoiceBus); osc.start(now);
  const voice = { osc, vca };
  activeVoices.add(voice);
  return voice;
}
function releaseVoice(v, when = ctx.currentTime) {
  if (!v) return;
  const { release } = state.env;
  try {
    v.vca.gain.cancelScheduledValues(when);
    v.vca.gain.setValueAtTime(v.vca.gain.value, when);
    v.vca.gain.linearRampToValueAtTime(0, when + release);
    v.osc.stop(when + release + 0.05);
  } catch {}
  activeVoices.delete(v);
}

// Scheduled sequencer note (start at time, fixed gate)
function scheduleNote(freq, startTime, gateSec) {
  const osc = ctx.createOscillator(); osc.type = state.wave; osc.frequency.setValueAtTime(freq, startTime);
  const vca = ctx.createGain(); vca.gain.setValueAtTime(0, startTime);

  const atk = state.env.attack, dec = state.env.decay, sus = state.env.sustain, rel = state.env.release;
  // ADSR with gate
  vca.gain.linearRampToValueAtTime(1, startTime + atk);
  vca.gain.linearRampToValueAtTime(sus, startTime + atk + dec);
  const noteOff = startTime + gateSec;
  vca.gain.setValueAtTime(vca.gain.value, noteOff);
  vca.gain.linearRampToValueAtTime(0, noteOff + rel);

  osc.connect(vca); vca.connect(globalVoiceBus);
  osc.start(startTime); osc.stop(noteOff + rel + 0.05);
}

// Stop everything
function stopAllNotes() {
  if (!started) return;
  for (const v of [...activeVoices]) releaseVoice(v);
  for (const [k,v] of keyVoices.entries()) { if (!sustainPedal) releaseVoice(v); }
  if (!sustainPedal) keyVoices.clear();
  // sustained voices will be released when pedal goes up
}

// ===== UI refs =====
const $ = (id) => document.getElementById(id);
const waveSelect = $('waveSelect');
const attack = $('attack'), decay = $('decay'), sustain = $('sustain'), release = $('release');
const cutoff = $('cutoff'), q = $('q'), filterType = $('filterType');
const lfoRate = $('lfoRate'), lfoDepth = $('lfoDepth');
const delayTime = $('delayTime'), delayFeedback = $('delayFeedback'), delayMix = $('delayMix');
const imageInput = $('imageInput'), imageReactive = $('imageReactive');
const transportBtn = $('transportBtn'), bpmInput = $('bpm'), clearSeqBtn = $('clearSeq');
const octaveDisp = $('octaveDisp');

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

// Mouse note buttons (if you kept them elsewhere)
document.querySelectorAll('.noteBtn')?.forEach(btn => {
  const down = async (e) => { e.preventDefault(); await initAudio(); startNote(ctx.currentTime, midiToFreq(noteNameToMidi(btn.dataset.note))); };
  const up = () => started && stopAllNotes();
  btn.addEventListener('pointerdown', down, { passive:false });
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
});

// ===== Keyboard: sustain + octave + notes =====
let octaveOffset = 0; // in semitones
function updateOctaveDisp(){ octaveDisp.textContent = (octaveOffset/12)|0; }
updateOctaveDisp();

window.addEventListener('keydown', async (e) => {
  const key = e.key.toLowerCase();
  if (key === ' ') { // sustain pedal
    if (!sustainPedal) sustainPedal = true;
    e.preventDefault(); return;
  }
  if (key === 'z') { octaveOffset = Math.max(-24, octaveOffset - 12); updateOctaveDisp(); e.preventDefault(); return; }
  if (key === 'x') { octaveOffset = Math.min( 24, octaveOffset + 12); updateOctaveDisp(); e.preventDefault(); return; }

  if (!(key in KEY_TO_NOTE)) return;
  if (keyVoices.has(key)) return; // already sounding
  e.preventDefault();
  await initAudio();
  const baseMidi = noteNameToMidi(KEY_TO_NOTE[key]);
  const freq = midiToFreq(baseMidi + octaveOffset);
  const v = startNote(ctx.currentTime, freq);
  keyVoices.set(key, v);
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key === ' ') { // sustain pedal up: release any held
    sustainPedal = false;
    for (const [k,v] of sustainedVoices.entries()) { releaseVoice(v); sustainedVoices.delete(k); keyVoices.delete(k); }
    e.preventDefault(); return;
  }
  const v = keyVoices.get(key);
  if (!v) return;
  if (sustainPedal) {
    sustainedVoices.set(key, v); // defer release
  } else {
    releaseVoice(v);
    keyVoices.delete(key);
  }
});

// ===== Apply params after init =====
function applyParams() {
  if (!started) return;
  filter.type = state.filter.type;
  filter.frequency.value = state.filter.cutoff;
  filter.Q.value = state.filter.q;
  lfo.frequency.value = state.lfo.rate;
  lfoGain.gain.value  = state.lfo.depth;
  delayNode.delayTime.value = state.delay.time;
  feedbackGain.gain.value  = state.delay.feedback;
  delayMixGain.gain.value  = state.delay.mix;
}

// ===== Display Canvases =====
const cSeq  = document.getElementById('seq');   const gSeq  = cSeq.getContext('2d');
const cImg  = document.getElementById('img');   const gImg  = cImg.getContext('2d');
const cWave = document.getElementById('wave');  const gWave = cWave.getContext('2d');
const cBars = document.getElementById('bars');  const gBars = cBars.getContext('2d');

function resizeCanvasToDisplaySize(canvas) {
  const { clientWidth:w, clientHeight:h } = canvas;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}
function resizeAll() { [cSeq,cImg,cWave,cBars].forEach(resizeCanvasToDisplaySize); }
window.addEventListener('resize', resizeAll);
new ResizeObserver(resizeAll).observe(document.querySelector('.display'));
resizeAll();

// ===== Image-reactive (top-right) =====
let reactiveImg = null, imgReady = false, offscreen = null, offctx = null;
imageInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = () => { reactiveImg = img; imgReady = true; URL.revokeObjectURL(url); };
  img.src = url;
});
function fitContain(w, h, iw, ih) { const s = Math.min(w/iw, h/ih, 1); const dw = Math.max(1, Math.floor(iw*s)); const dh = Math.max(1, Math.floor(ih*s)); const dx = Math.floor((w-dw)/2), dy = Math.floor((h-dh)/2); return {dw,dh,dx,dy}; }
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

// ===== Analyser data =====
let wave = new Uint8Array(1024);
let bins = new Uint8Array(1024);

// ===== Sequencer data & scheduler =====
const STEPS = 16;
const ROWS = 8;
// High-to-low rows (top to bottom)
const ROW_TO_MIDI_BASE = [72, 71, 69, 67, 66, 64, 62, 60]; // C5, B4, A4, G4, F#4, E4, D4, C4
let pattern = Array.from({length: ROWS}, () => Array(STEPS).fill(false));
let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0; // in AudioContext time
const scheduleAheadTime = 0.1; // seconds
const lookaheadMs = 25; // scheduler check interval

function secondsPerStep() {
  const bpm = Math.max(40, Math.min(240, +bpmInput.value || 120));
  return 60.0 / bpm / 4.0; // 16th note
}

let schedulerTimer = null;
function schedulerTick() {
  if (!started || !isPlaying) return;
  while (nextNoteTime < ctx.currentTime + scheduleAheadTime) {
    // schedule notes at currentStep
    const step = currentStep;
    const stepDur = secondsPerStep();
    for (let r=0; r<ROWS; r++) {
      if (pattern[r][step]) {
        const midi = ROW_TO_MIDI_BASE[r] + (octaveOffset); // apply octave shift to seq too
        const freq = midiToFreq(midi);
        scheduleNote(freq, nextNoteTime, stepDur * 0.9);
      }
    }
    // advance
    nextNoteTime += stepDur;
    currentStep = (currentStep + 1) % STEPS;
  }
  // visual update: request a redraw of seq
}

function startTransport() {
  if (!started) return;
  if (isPlaying) return;
  isPlaying = true;
  currentStep = 0;
  nextNoteTime = ctx.currentTime + 0.05;
  schedulerTimer = setInterval(schedulerTick, lookaheadMs);
  transportBtn.textContent = 'Stop';
}
function stopTransport() {
  isPlaying = false;
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  transportBtn.textContent = 'Play';
}
transportBtn.addEventListener('click', async () => { await initAudio(); isPlaying ? stopTransport() : startTransport(); });
bpmInput.addEventListener('change', () => { /* tempo changes apply next cycle automatically */ });
clearSeqBtn.addEventListener('click', () => { pattern = Array.from({length: ROWS}, () => Array(STEPS).fill(false)); });

// Click to toggle cells on seq canvas
cSeq.addEventListener('pointerdown', (e) => {
  const rect = cSeq.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const cw = cSeq.width / STEPS, rh = cSeq.height / ROWS;
  const c = Math.floor(x / cw), r = Math.floor(y / rh);
  if (c>=0 && c<STEPS && r>=0 && r<ROWS) pattern[r][c] = !pattern[r][c];
});

// ===== Drawing loops =====
function drawSequencer() {
  resizeCanvasToDisplaySize(cSeq);
  const w = cSeq.width, h = cSeq.height;
  gSeq.clearRect(0,0,w,h);
  // background
  gSeq.fillStyle = '#0a0a0a'; gSeq.fillRect(0,0,w,h);

  const cw = w / STEPS, rh = h / ROWS;

  // active cells
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<STEPS;c++){
      if (pattern[r][c]) {
        gSeq.fillStyle = '#2f6';
        gSeq.fillRect(c*cw+1, r*rh+1, cw-2, rh-2);
      }
    }
  }

  // playhead
  const ph = isPlaying ? ((currentStep % STEPS) * cw) : -9999;
  if (isPlaying) {
    gSeq.fillStyle = 'rgba(255,255,255,0.08)';
    gSeq.fillRect(ph, 0, cw, h);
  }

  // grid lines
  gSeq.globalAlpha = 0.9; gSeq.strokeStyle = '#222'; gSeq.lineWidth = 1;
  gSeq.beginPath();
  for (let i=0;i<=STEPS;i++){ gSeq.moveTo(i*cw,0); gSeq.lineTo(i*cw,h); }
  for (let j=0;j<=ROWS;j++){ gSeq.moveTo(0,j*rh); gSeq.lineTo(w,j*rh); }
  gSeq.stroke();
  // bar markers
  gSeq.strokeStyle = '#444'; gSeq.lineWidth = 2; gSeq.beginPath();
  for (let i=0;i<=STEPS;i+=4){ gSeq.moveTo(i*cw,0); gSeq.lineTo(i*cw,h); }
  gSeq.stroke();

  // left note labels (optional light hints)
  gSeq.fillStyle = 'rgba(255,255,255,0.25)';
  gSeq.font = '12px system-ui';
  gSeq.textBaseline = 'middle';
  for (let r=0;r<ROWS;r++){
    const midi = ROW_TO_MIDI_BASE[r] + (octaveOffset);
    gSeq.fillText(midiToNoteName(midi), 6, r*rh + rh/2);
  }
}
function midiToNoteName(m) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const name = names[m % 12]; const oct = Math.floor(m/12) - 1; return name + oct;
}

function drawImageReactive() {
  resizeCanvasToDisplaySize(cImg);
  const w = cImg.width, h = cImg.height;
  gImg.clearRect(0,0,w,h);
  gImg.fillStyle = '#0a0a0a'; gImg.fillRect(0,0,w,h);

  // grid
  gImg.globalAlpha = 0.35; gImg.strokeStyle = '#222'; gImg.beginPath();
  for (let x=0;x<=w;x+=50){ gImg.moveTo(x,0); gImg.lineTo(x,h); }
  for (let y=0;y<=h;y+=50){ gImg.moveTo(0,y); gImg.lineTo(w,y); }
  gImg.stroke(); gImg.globalAlpha = 1;

  if (!analyser || !imgReady || !imageReactive.checked) return;

  analyser.getByteTimeDomainData(wave);
  ensureOffscreen(w,h);
  if (!offscreen) return;
  const {dx,dy} = fitContain(w,h, offscreen.width, offscreen.height);
  const maxDx = Math.max(8, Math.min(40, Math.floor(w * 0.03)));
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
  const w = cWave.width, h = cWave.height;
  gWave.clearRect(0,0,w,h);
  gWave.fillStyle = '#0a0a0a'; gWave.fillRect(0,0,w,h);
  gWave.globalAlpha = 0.35; gWave.strokeStyle = '#222'; gWave.beginPath();
  for (let x=0;x<=w;x+=50){ gWave.moveTo(x,0); gWave.lineTo(x,h); }
  for (let y=0;y<=h;y+=50){ gWave.moveTo(0,y); gWave.lineTo(w,y); }
  gWave.stroke(); gWave.globalAlpha = 1;

  if (!analyser) return;
  analyser.getByteTimeDomainData(wave);

  gWave.lineWidth = 2; gWave.strokeStyle = '#9be58c';
  gWave.beginPath();
  for (let i=0;i<wave.length;i++){
    const x = (i/(wave.length-1))*w;
    const v = (wave[i]-128)/128;
    const y = (h/2) + v*(h*0.45);
    i===0 ? gWave.moveTo(x,y) : gWave.lineTo(x,y);
  }
  gWave.stroke();
}

function drawSpectrum() {
  resizeCanvasToDisplaySize(cBars);
  const w = cBars.width, h = cBars.height;
  gBars.clearRect(0,0,w,h);
  gBars.fillStyle = '#0a0a0a'; gBars.fillRect(0,0,w,h);
  gBars.globalAlpha = 0.35; gBars.strokeStyle = '#222'; gBars.beginPath();
  for (let x=0;x<=w;x+=50){ gBars.moveTo(x,0); gBars.lineTo(x,h); }
  for (let y=0;y<=h;y+=50){ gBars.moveTo(0,y); gBars.lineTo(w,y); }
  gBars.stroke(); gBars.globalAlpha = 1;

  if (!analyser) return;
  analyser.getByteFrequencyData(bins);

  const barCount = 128, step = Math.max(1, Math.floor(bins.length / barCount));
  const barW = w / barCount;
  for (let i=0;i<barCount;i++){
    const v = bins[i*step] / 255;
    const bh = v * (h - 6);
    const x = i*barW;
    const y = h - bh;
    gBars.fillStyle = '#8ab4ff';
    gBars.fillRect(x, y, barW - 1, bh);
  }
}

function draw() {
  requestAnimationFrame(draw);
  drawSequencer();
  drawImageReactive();
  drawWaveform();
  drawSpectrum();
}
draw();
