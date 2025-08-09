// ===== Color themes per octave shift =====
const THEMES = [
  { bg:'#121212', panel:'#1b1b1b', line:'#2a2a2a', canvas:'#0e0e0e', grid:'#222', accent:'#8ab4ff', accent2:'#9be58c' }, // 0
  { bg:'#0f141a', panel:'#15202b', line:'#253341', canvas:'#0b1116', grid:'#1c2a35', accent:'#64b5f6', accent2:'#81c784' }, // +1
  { bg:'#161217', panel:'#221b25', line:'#3a2e43', canvas:'#120f14', grid:'#2a2230', accent:'#ba68c8', accent2:'#ffb74d' }, // +2
  { bg:'#12160f', panel:'#1b2215', line:'#2a3a21', canvas:'#0e120b', grid:'#1f2a18', accent:'#a5d6a7', accent2:'#ffcc80' }, // -1
  { bg:'#1a1310', panel:'#281b16', line:'#3e2a22', canvas:'#140f0c', grid:'#2b201b', accent:'#ffab91', accent2:'#ffd54f' }, // -2
];
function applyTheme(idx){
  const t = THEMES[(idx+2)%THEMES.length]; // map -2..+2 into 0..4
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg); r.setProperty('--panel', t.panel); r.setProperty('--line', t.line);
  r.setProperty('--canvas', t.canvas); r.setProperty('--grid', t.grid); r.setProperty('--accent', t.accent); r.setProperty('--accent2', t.accent2);
}

// ===== Utils =====
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const noteNameToMidi = (n) => {
  const map = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
  const m = n.match(/^([A-G]#?|[A-G]b)(\d)$/); if(!m) return 60;
  const semis = map[m[1]]; const oct = +m[2];
  return 12*(oct+1)+semis;
};
const midiToNote = (m) => {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[m % 12] + (Math.floor(m/12)-1);
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
}

// Voice helpers
function startVoiceAt(freq, when) {
  const osc = ctx.createOscillator(); osc.type = state.wave; osc.frequency.setValueAtTime(freq, when);
  const vca = ctx.createGain(); vca.gain.setValueAtTime(0, when);
  const { attack, decay, sustain } = state.env;
  vca.gain.linearRampToValueAtTime(1, when + attack);
  vca.gain.linearRampToValueAtTime(sustain, when + attack + decay);
  osc.connect(vca); vca.connect(globalVoiceBus); osc.start(when);
  return { osc, vca };
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
}

// Live-play
function startNote(freq) {
  const v = startVoiceAt(freq, ctx.currentTime);
  activeVoices.add(v);
  return v;
}
function stopAllNotes() {
  if (!started) return;
  for (const v of [...activeVoices]) { releaseVoice(v); activeVoices.delete(v); }
  for (const [k,v] of keyVoices.entries()) { if (!sustainPedal) { releaseVoice(v); keyVoices.delete(k); } }
  if (!sustainPedal) sustainedVoices.clear();
}

// Scheduled melodic note
function scheduleMelodic(freq, startTime, gateSec) {
  const v = startVoiceAt(freq, startTime);
  // release after gate
  const off = startTime + gateSec;
  v.vca.gain.setValueAtTime(v.vca.gain.value, off);
  v.vca.gain.linearRampToValueAtTime(0, off + state.env.release);
  v.osc.stop(off + state.env.release + 0.05);
}

// Drum synthesis
let noiseBuf = null;
function getNoiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const sr = ctx.sampleRate, len = sr * 2;
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i=0;i<len;i++) data[i] = Math.random()*2 - 1;
  noiseBuf = buf; return buf;
}
function scheduleKick(time, vol=0.9) {
  const osc = ctx.createOscillator(); osc.type = 'sine';
  const gain = ctx.createGain(); gain.gain.setValueAtTime(vol, time);
  // pitch envelope
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
  // amp decay
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  osc.connect(gain); gain.connect(globalVoiceBus);
  osc.start(time); osc.stop(time + 0.22);
}
function scheduleSnare(time, vol=0.6) {
  const src = ctx.createBufferSource(); src.buffer = getNoiseBuffer();
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=700;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
  src.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(globalVoiceBus);
  src.start(time); src.stop(time + 0.2);
}
function scheduleHat(time, open=false, vol=0.4) {
  const src = ctx.createBufferSource(); src.buffer = getNoiseBuffer();
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=6000;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(vol, time);
  const dur = open ? 0.25 : 0.06;
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.connect(hp); hp.connect(gain); gain.connect(globalVoiceBus);
  src.start(time); src.stop(time + dur + 0.05);
}

// ===== UI refs =====
const $ = (id) => document.getElementById(id);
const waveSelect = $('waveSelect');
const attack = $('attack'), decay = $('decay'), sustain = $('sustain'), release = $('release');
const cutoff = $('cutoff'), q = $('q'), filterType = $('filterType');
const lfoRate = $('lfoRate'), lfoDepth = $('lfoDepth');
const delayTime = $('delayTime'), delayFeedback = $('delayFeedback'), delayMix = $('delayMix');
const imageInput = $('imageInput'), imageReactive = $('imageReactive');
const transportBtn = $('transportBtn'), bpmInput = $('bpm'), swingInput = $('swing'), clearSeqBtn = $('clearSeq');
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

// ===== Keyboard: sustain + octave + notes + theme =====
let octaveOffset = 0; // semitones, affects lead and bass tracks
function updateOctaveUI(){
  $('octaveDisp').textContent = (octaveOffset/12)|0;
  applyTheme((octaveOffset/12)|0 + 2); // map -2..+2 nicely
}
applyTheme(2);

window.addEventListener('keydown', async (e) => {
  const key = e.key.toLowerCase();
  if (key === ' ') { if (!sustainPedal) sustainPedal = true; e.preventDefault(); return; }
  if (key === 'z') { octaveOffset = Math.max(-24, octaveOffset - 12); updateOctaveUI(); e.preventDefault(); return; }
  if (key === 'x') { octaveOffset = Math.min( 24, octaveOffset + 12); updateOctaveUI(); e.preventDefault(); return; }

  if (!(key in KEY_TO_NOTE)) return;
  if (keyVoices.has(key)) return;
  e.preventDefault();
  await initAudio();
  const baseMidi = noteNameToMidi(KEY_TO_NOTE[key]);
  const freq = midiToFreq(baseMidi + octaveOffset);
  const v = startNote(freq);
  keyVoices.set(key, v);
});
window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key === ' ') {
    sustainPedal = false;
    for (const [k,v] of sustainedVoices.entries()) { releaseVoice(v); sustainedVoices.delete(k); keyVoices.delete(k); }
    e.preventDefault(); return;
  }
  const v = keyVoices.get(key);
  if (!v) return;
  if (sustainPedal) sustainedVoices.set(key, v);
  else { releaseVoice(v); keyVoices.delete(key); }
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

// ===== Sequencer config =====
const STEPS_LEAD = 16;
const STEPS_BASS = 32; // more slots
const STEPS_DRUM = 16;

const ROWS_LEAD = 8;
const ROWS_BASS = 8;
const ROWS_DRUM = 4;

const TOTAL_ROWS = ROWS_LEAD + ROWS_BASS + ROWS_DRUM;

// Row → midi for lead (top 8 rows, higher to lower)
const LEAD_BASE = [72, 71, 69, 67, 66, 64, 62, 60]; // C5..C4
// Bass mirrors lead but will be played -24 semitones
const BASS_BASE = LEAD_BASE;

// Drums row names
const DRUM_NAMES = ['Kick', 'Snare', 'Hat C', 'Hat O'];

// Patterns
let patLead = Array.from({length: ROWS_LEAD}, () => Array(STEPS_LEAD).fill(false));
let patBass = Array.from({length: ROWS_BASS}, () => Array(STEPS_BASS).fill(false));
let patDrum = Array.from({length: ROWS_DRUM}, () => Array(STEPS_DRUM).fill(false));

// Transport / scheduler
let isPlaying = false;
let nextNoteTime = 0; // AudioContext time
let tick32 = 0;       // 32nd-note tick counter for visual playheads
const scheduleAheadTime = 0.1; // seconds
const lookaheadMs = 25; // scheduler check interval

function secondsPer32nd() {
  const bpm = Math.max(40, Math.min(240, +bpmInput.value || 120));
  // quarter = 60/bpm, 16th = quarter/4, 32nd = quarter/8
  const sp32 = 60.0 / bpm / 8.0;
  const swingPct = Math.max(0, Math.min(65, +swingInput.value || 0)) / 100;
  // apply swing to every *odd* 32nd (i.e., off-beats of 16ths)
  // return a function we’ll use at schedule-time
  return { sp32, swingPct };
}

let schedulerTimer = null;
function schedulerTick() {
  if (!started || !isPlaying) return;
  const { sp32, swingPct } = secondsPer32nd();

  while (nextNoteTime < ctx.currentTime + scheduleAheadTime) {
    const t = nextNoteTime;

    // Lead (fires every 2 ticks → 16th grid)
    if (tick32 % 2 === 0) {
      const stepLead = (tick32 / 2) % STEPS_LEAD;
      for (let r=0; r<ROWS_LEAD; r++) {
        if (patLead[r][stepLead]) {
          const midi = LEAD_BASE[r] + (octaveOffset);
          scheduleMelodic(midiToFreq(midi), t, sp32 * 2 * 0.9);
        }
      }
      // Drums at 16th
      const stepDrum = stepLead;
      for (let r=0; r<ROWS_DRUM; r++) {
        if (patDrum[r][stepDrum]) {
          if (r===0) scheduleKick(t);
          else if (r===1) scheduleSnare(t);
          else if (r===2) scheduleHat(t, false);
          else if (r===3) scheduleHat(t, true);
        }
      }
    }
    // Bass (fires every 1 tick → 32nd grid)
    const stepBass = tick32 % STEPS_BASS;
    for (let r=0; r<ROWS_BASS; r++) {
      if (patBass[r][stepBass]) {
        const midi = (BASS_BASE[r] - 24) + (octaveOffset); // two octaves down + global octave
        scheduleMelodic(midiToFreq(midi), t, sp32 * 0.9);
      }
    }

    // Advance time with swing: delay odd 32nds
    const isOdd32 = (tick32 % 2) === 1;
    const stepDur = sp32 * (isOdd32 ? (1 + swingPct) : (1 - swingPct));
    nextNoteTime += stepDur;
    tick32 = (tick32 + 1) % (STEPS_BASS); // wrap at 32
  }
}

function startTransport() {
  if (!started) return;
  if (isPlaying) return;
  isPlaying = true;
  tick32 = 0;
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
clearSeqBtn.addEventListener('click', () => {
  patLead = Array.from({length: ROWS_LEAD}, () => Array(STEPS_LEAD).fill(false));
  patBass = Array.from({length: ROWS_BASS}, () => Array(STEPS_BASS).fill(false));
  patDrum = Array.from({length: ROWS_DRUM}, () => Array(STEPS_DRUM).fill(false));
});

// Click to toggle cells on the unified sequencer canvas
cSeq.addEventListener('pointerdown', (e) => {
  const rect = cSeq.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;

  const w = cSeq.width, h = cSeq.height;
  const leadHeight = Math.floor(h * (ROWS_LEAD / TOTAL_ROWS));
  const bassHeight = Math.floor(h * (ROWS_BASS / TOTAL_ROWS));
  const drumHeight = h - leadHeight - bassHeight;

  // Determine section
  if (y < leadHeight) {
    // Lead: 16 columns
    const row = Math.floor(y / (leadHeight / ROWS_LEAD));
    const col = Math.floor(x / (w / STEPS_LEAD));
    if (row>=0 && row<ROWS_LEAD && col>=0 && col<STEPS_LEAD) patLead[row][col] = !patLead[row][col];
  } else if (y < leadHeight + bassHeight) {
    // Bass: 32 columns
    const y2 = y - leadHeight;
    const row = Math.floor(y2 / (bassHeight / ROWS_BASS));
    const col = Math.floor(x / (w / STEPS_BASS));
    if (row>=0 && row<ROWS_BASS && col>=0 && col<STEPS_BASS) patBass[row][col] = !patBass[row][col];
  } else {
    // Drums: 16 columns, 4 rows
    const y3 = y - leadHeight - bassHeight;
    const row = Math.floor(y3 / (drumHeight / ROWS_DRUM));
    const col = Math.floor(x / (w / STEPS_DRUM));
    if (row>=0 && row<ROWS_DRUM && col>=0 && col<STEPS_DRUM) patDrum[row][col] = !patDrum[row][col];
  }
});

// ===== Drawing =====
function drawSequencer() {
  resizeCanvasToDisplaySize(cSeq);
  const w = cSeq.width, h = cSeq.height;
  gSeq.clearRect(0,0,w,h);
  gSeq.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas'); gSeq.fillRect(0,0,w,h);

  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8ab4ff';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9be58c';

  // Section heights
  const leadH = Math.floor(h * (ROWS_LEAD / TOTAL_ROWS));
  const bassH = Math.floor(h * (ROWS_BASS / TOTAL_ROWS));
  const drumH = h - leadH - bassH;

  // Helper to draw a block
  function drawBlock(rows, cols, top, height, pattern, type) {
    const rh = height / rows, cw = w / cols;

    // Active cells
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        if (pattern[r][c]) {
          gSeq.fillStyle = type==='bass' ? accent : (type==='drum' ? '#ffcf77' : accent2);
          gSeq.fillRect(c*cw+1, top + r*rh+1, cw-2, rh-2);
        }
      }
    }

    // Playhead
    if (isPlaying) {
      let colX = 0, colW = cw;
      if (type==='lead' || type==='drum') {
        const step = Math.floor((tick32/2)%cols);
        colX = step*cw;
      } else if (type==='bass') {
        const step = Math.floor(tick32%cols);
        colX = step*cw;
      }
      gSeq.fillStyle = 'rgba(255,255,255,0.08)';
      gSeq.fillRect(colX, top, colW, height);
    }

    // Grid lines
    gSeq.globalAlpha = 0.9; gSeq.strokeStyle = grid; gSeq.lineWidth = 1; gSeq.beginPath();
    for (let i=0;i<=cols;i++){ gSeq.moveTo(i*cw, top); gSeq.lineTo(i*cw, top+height); }
    for (let j=0;j<=rows;j++){ gSeq.moveTo(0, top+j*rh); gSeq.lineTo(w, top+j*rh); }
    gSeq.stroke();

    // Bar markers (every 4 in 16th grid; for 32, every 8)
    gSeq.strokeStyle = 'rgba(255,255,255,0.15)'; gSeq.lineWidth = 2; gSeq.beginPath();
    const stepMark = (cols===32)?8:4;
    for (let i=0;i<=cols;i+=stepMark){ gSeq.moveTo(i*cw, top); gSeq.lineTo(i*cw, top+height); }
    gSeq.stroke();

    // Labels (left side)
    gSeq.fillStyle = 'rgba(255,255,255,0.5)'; gSeq.font = '12px system-ui'; gSeq.textBaseline = 'middle';
    for (let r=0;r<rows;r++){
      let label = '';
      if (type==='lead') { label = midiToNote(LEAD_BASE[r] + octaveOffset); }
      else if (type==='bass') { label = midiToNote(BASS_BASE[r] - 24 + octaveOffset); }
      else if (type==='drum') { label = DRUM_NAMES[r]; }
      gSeq.fillText(label, 6, top + r*rh + rh/2);
    }

    // Section title
    gSeq.fillStyle = 'rgba(255,255,255,0.4)'; gSeq.font = 'bold 12px system-ui';
    gSeq.fillText(type.toUpperCase(), 6, top + 12);
  }

  drawBlock(ROWS_LEAD, STEPS_LEAD, 0,             leadH, patLead, 'lead');
  drawBlock(ROWS_BASS, STEPS_BASS, leadH,         bassH, patBass, 'bass');
  drawBlock(ROWS_DRUM, STEPS_DRUM, leadH+bassH,   drumH, patDrum, 'drum');
}

function drawImageReactive() {
  resizeCanvasToDisplaySize(cImg);
  const w = cImg.width, h = cImg.height;
  gImg.clearRect(0,0,w,h);
  gImg.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas'); gImg.fillRect(0,0,w,h);

  // grid
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  gImg.globalAlpha = 0.35; gImg.strokeStyle = grid; gImg.beginPath();
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
  gWave.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas'); gWave.fillRect(0,0,w,h);
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9be58c';
  gWave.globalAlpha = 0.35; gWave.strokeStyle = grid; gWave.beginPath();
  for (let x=0;x<=w;x+=50){ gWave.moveTo(x,0); gWave.lineTo(x,h); }
  for (let y=0;y<=h;y+=50){ gWave.moveTo(0,y); gWave.lineTo(w,y); }
  gWave.stroke(); gWave.globalAlpha = 1;

  if (!analyser) return;
  analyser.getByteTimeDomainData(wave);

  gWave.lineWidth = 2; gWave.strokeStyle = accent2;
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
  gBars.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas'); gBars.fillRect(0,0,w,h);
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8ab4ff';
  gBars.globalAlpha = 0.35; gBars.strokeStyle = grid; gBars.beginPath();
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
    gBars.fillStyle = accent;
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
