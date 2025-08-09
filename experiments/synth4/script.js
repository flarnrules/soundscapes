// ===== Color themes per octave shift =====
const THEMES = [
  { bg:'#121212', panel:'#1b1b1b', line:'#2a2a2a', canvas:'#0e0e0e', grid:'#222', accent:'#8ab4ff', accent2:'#9be58c' }, // 0
  { bg:'#0f141a', panel:'#15202b', line:'#253341', canvas:'#0b1116', grid:'#1c2a35', accent:'#64b5f6', accent2:'#81c784' }, // +1
  { bg:'#161217', panel:'#221b25', line:'#3a2e43', canvas:'#120f14', grid:'#2a2230', accent:'#ba68c8', accent2:'#ffb74d' }, // +2
  { bg:'#12160f', panel:'#1b2215', line:'#2a3a21', canvas:'#0e120b', grid:'#1f2a18', accent:'#a5d6a7', accent2:'#ffcc80' }, // -1
  { bg:'#1a1310', panel:'#281b16', line:'#3e2a22', canvas:'#140f0c', grid:'#2b201b', accent:'#ffab91', accent2:'#ffd54f' }, // -2
];
function applyTheme(idx){
  const t = THEMES[(idx+2)%THEMES.length];
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg); r.setProperty('--panel', t.panel); r.setProperty('--line', t.line);
  r.setProperty('--canvas', t.canvas); r.setProperty('--grid', t.grid);
  r.setProperty('--accent', t.accent); r.setProperty('--accent2', t.accent2);
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
let ctx, masterGain, analyser, filter, lfo, lfoGain, delayNode, feedbackGain, delayMixGain;
let leadBus, bassBus, drumBus, mixBus; // new per-section busses
const activeVoices = new Set();
const keyVoices = new Map();
const sustainedVoices = new Map();
let sustainPedal = false;
let started = false;

// synth state
const state = {
  wave: 'square',
  env: { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.4 },
  filter: { type: 'lowpass', cutoff: 1200, q: 0.7 },
  lfo: { rate: 4, depth: 500 },
  delay: { time: 0.25, feedback: 0.35, mix: 0.3 },
  volume: { lead: 0.9, bass: 0.9, drum: 0.9 }
};

async function ensureContextRunning() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(e) { console.warn('resume blocked', e); } }
  return ctx.state === 'running';
}

async function initAudio() {
  if (started) return;
  await ensureContextRunning();

  masterGain = ctx.createGain(); masterGain.gain.value = 0.85;

  // Per-section busses
  leadBus = ctx.createGain(); leadBus.gain.value = state.volume.lead;
  bassBus = ctx.createGain(); bassBus.gain.value = state.volume.bass;
  drumBus = ctx.createGain(); drumBus.gain.value = state.volume.drum;

  // Mix bus (sum sections)
  mixBus = ctx.createGain();

  // Filter
  filter = ctx.createBiquadFilter();
  filter.type = state.filter.type;
  filter.frequency.value = state.filter.cutoff;
  filter.Q.value = state.filter.q;

  // Delay with feedback
  delayNode = ctx.createDelay(1.5);
  feedbackGain = ctx.createGain();
  delayMixGain = ctx.createGain();
  delayNode.delayTime.value = state.delay.time;
  feedbackGain.gain.value  = state.delay.feedback;
  delayMixGain.gain.value  = state.delay.mix;
  delayNode.connect(feedbackGain); feedbackGain.connect(delayNode);

  // Analyser
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;

  // LFO → filter cutoff
  lfo = ctx.createOscillator(); lfoGain = ctx.createGain();
  lfo.frequency.value = state.lfo.rate; lfoGain.gain.value = state.lfo.depth;
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency);

  // Routing:
  // lead/bass/drum → mixBus → filter → (dry + delay) → master → analyser → destination
  leadBus.connect(mixBus);
  bassBus.connect(mixBus);
  drumBus.connect(mixBus);

  const dry = ctx.createGain(); dry.gain.value = 1;
  mixBus.connect(filter);
  filter.connect(dry);
  filter.connect(delayNode);
  delayNode.connect(delayMixGain);

  const sum = ctx.createGain();
  dry.connect(sum); delayMixGain.connect(sum);
  sum.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  lfo.start();
  started = true;
  applyParams();
}

// Voice helpers
function startVoiceAt(freq, when, velocity=1.0, bus=leadBus) {
  const osc = ctx.createOscillator(); osc.type = state.wave; osc.frequency.setValueAtTime(freq, when);
  const vca = ctx.createGain(); vca.gain.setValueAtTime(0, when);
  const { attack, decay, sustain } = state.env;
  const peak = Math.max(0.0001, Math.min(1, velocity));
  vca.gain.linearRampToValueAtTime(peak, when + attack);
  vca.gain.linearRampToValueAtTime(peak * sustain, when + attack + decay);
  osc.connect(vca); vca.connect(bus); osc.start(when);
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

// Live-play uses Lead bus
function startNote(freq) {
  const v = startVoiceAt(freq, ctx.currentTime, 1.0, leadBus);
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
function scheduleMelodic(freq, startTime, gateSec, velocity=1.0, bus=leadBus) {
  const v = startVoiceAt(freq, startTime, velocity, bus);
  const off = startTime + gateSec;
  v.vca.gain.setValueAtTime(v.vca.gain.value, off);
  v.vca.gain.linearRampToValueAtTime(0, off + state.env.release);
  v.osc.stop(off + state.env.release + 0.05);
}

// Drums (route to drumBus)
let noiseBuf = null;
function getNoiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const sr = ctx.sampleRate, len = sr * 2;
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i=0;i<len;i++) data[i] = Math.random()*2 - 1;
  noiseBuf = buf; return buf;
}
function scheduleKick(time, vel=0.9) {
  const osc = ctx.createOscillator(); osc.type = 'sine';
  const gain = ctx.createGain(); gain.gain.setValueAtTime(Math.max(0.0001, vel), time);
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  osc.connect(gain); gain.connect(drumBus);
  osc.start(time); osc.stop(time + 0.22);
}
function scheduleSnare(time, vel=0.6) {
  const src = ctx.createBufferSource(); src.buffer = getNoiseBuffer();
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=700;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(Math.max(0.0001, vel), time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
  src.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(drumBus);
  src.start(time); src.stop(time + 0.2);
}
function scheduleHat(time, open=false, vel=0.4) {
  const src = ctx.createBufferSource(); src.buffer = getNoiseBuffer();
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=6000;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(Math.max(0.0001, vel), time);
  const dur = open ? 0.25 : 0.06;
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.connect(hp); hp.connect(gain); gain.connect(drumBus);
  src.start(time); src.stop(time + dur + 0.05);
}

// ===== UI refs =====
const $ = (id) => document.getElementById(id);
const attack = $('attack'), decay = $('decay'), sustain = $('sustain'), release = $('release');
const cutoff = $('cutoff'), q = $('q'), filterType = $('filterType');
const lfoRate = $('lfoRate'), lfoDepth = $('lfoDepth');
const delayTime = $('delayTime'), delayFeedback = $('delayFeedback'), delayMix = $('delayMix');
const imageInput = $('imageInput'), imageReactive = $('imageReactive');
const transportBtn = $('transportBtn'), bpmInput = $('bpm'), swingInput = $('swing'), clearSeqBtn = $('clearSeq');
const leadVol = $('leadVol'), bassVol = $('bassVol'), drumVol = $('drumVol');
const octaveDisp = $('octaveDisp');

$('startBtn').addEventListener('click', async () => { await initAudio(); });
$('stopAllBtn').addEventListener('click', () => started && stopAllNotes());

// Waveform radios
document.querySelectorAll('input[name="wave"]').forEach(r =>
  r.addEventListener('change', () => { state.wave = r.value; })
);

// ADSR etc.
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

// Section volumes
[leadVol, bassVol, drumVol].forEach(el => el.addEventListener('input', () => {
  if (!started) return;
  state.volume.lead = +leadVol.value;  leadBus.gain.setTargetAtTime(state.volume.lead, ctx.currentTime, 0.02);
  state.volume.bass = +bassVol.value;  bassBus.gain.setTargetAtTime(state.volume.bass, ctx.currentTime, 0.02);
  state.volume.drum = +drumVol.value;  drumBus.gain.setTargetAtTime(state.volume.drum, ctx.currentTime, 0.02);
}));

// ===== Keyboard: sustain + octave + notes + theme =====
let octaveOffset = 0; // semitones (affects lead+bass)
function updateOctaveUI(){
  octaveDisp.textContent = (octaveOffset/12)|0;
  applyTheme((octaveOffset/12)|0 + 2);
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

// ===== Canvases & resizing =====
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
new ResizeObserver(resizeAll).observe(document.querySelector('.topRow'));
new ResizeObserver(resizeAll).observe(document.querySelector('.stack'));
resizeAll();

// ===== Image-reactive (top-right): robust contain scaling =====
let reactiveImg = null, imgReady = false, offscreen = null, offctx = null;
imageInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const url = URL.createObjectURL(file); const img = new Image();
  img.onload = () => { reactiveImg = img; imgReady = true; offscreen = null; offctx = null; URL.revokeObjectURL(url); };
  img.src = url;
});
// Compute contain fit once from the image's natural size
function fitContain(w, h, iw, ih) {
  const s = Math.min(w/iw, h/ih, 1);
  const dw = Math.max(1, Math.floor(iw*s));
  const dh = Math.max(1, Math.floor(ih*s));
  const dx = Math.floor((w - dw)/2), dy = Math.floor((h - dh)/2);
  return {dw, dh, dx, dy};
}
function ensureOffscreen(dw, dh) {
  if (!offscreen || offscreen.width !== dw || offscreen.height !== dh) {
    offscreen = document.createElement('canvas'); offscreen.width = dw; offscreen.height = dh;
    offctx = offscreen.getContext('2d'); offctx.imageSmoothingEnabled = true;
  }
  offctx.clearRect(0,0,dw,dh);
  offctx.drawImage(reactiveImg, 0, 0, dw, dh);
}

// ===== Analyser data =====
let wave = new Uint8Array(1024);
let bins = new Uint8Array(1024);

// ===== Sequencer config (same as before, with per-row velocity knobs) =====
const STEPS_LEAD = 16, STEPS_BASS = 32, STEPS_DRUM = 16;
const ROWS_LEAD = 8, ROWS_BASS = 8, ROWS_DRUM = 4;
const TOTAL_ROWS = ROWS_LEAD + ROWS_BASS + ROWS_DRUM;
const LEAD_BASE = [72,71,69,67,66,64,62,60];
const BASS_BASE = LEAD_BASE;
const DRUM_NAMES = ['Kick','Snare','Hat C','Hat O'];

let patLead = Array.from({length: ROWS_LEAD}, () => Array(STEPS_LEAD).fill(false));
let patBass = Array.from({length: ROWS_BASS}, () => Array(STEPS_BASS).fill(false));
let patDrum = Array.from({length: ROWS_DRUM}, () => Array(STEPS_DRUM).fill(false));
let velLead = new Array(ROWS_LEAD).fill(0.85);
let velBass = new Array(ROWS_BASS).fill(0.85);
let velDrum = new Array(ROWS_DRUM).fill(0.85);

let isPlaying = false;
let nextNoteTime = 0;
let tick32 = 0;
const scheduleAheadTime = 0.1;
const lookaheadMs = 25;

function secondsPer32nd() {
  const bpm = Math.max(40, Math.min(240, +bpmInput.value || 120));
  const sp32 = 60.0 / bpm / 8.0;
  const swingPct = Math.max(0, Math.min(65, +swingInput.value || 0)) / 100;
  return { sp32, swingPct };
}

let schedulerTimer = null;
function schedulerTick() {
  if (!started || !isPlaying) return;
  const { sp32, swingPct } = secondsPer32nd();

  while (nextNoteTime < ctx.currentTime + scheduleAheadTime) {
    const t = nextNoteTime;

    // Lead (16th)
    if (tick32 % 2 === 0) {
      const stepLead = (tick32 / 2) % STEPS_LEAD;
      for (let r=0; r<ROWS_LEAD; r++) {
        if (patLead[r][stepLead]) {
          const midi = LEAD_BASE[r] + (octaveOffset);
          scheduleMelodic(midiToFreq(midi), t, sp32 * 2 * 0.9, velLead[r], leadBus);
        }
      }
      // Drums
      const stepDrum = stepLead;
      for (let r=0; r<ROWS_DRUM; r++) {
        if (patDrum[r][stepDrum]) {
          if (r===0) scheduleKick(t, velDrum[r]);
          else if (r===1) scheduleSnare(t, velDrum[r]);
          else if (r===2) scheduleHat(t, false, velDrum[r]);
          else if (r===3) scheduleHat(t, true, velDrum[r]);
        }
      }
    }
    // Bass (32nd)
    const stepBass = tick32 % STEPS_BASS;
    for (let r=0; r<ROWS_BASS; r++) {
      if (patBass[r][stepBass]) {
        const midi = (BASS_BASE[r] - 24) + (octaveOffset);
        scheduleMelodic(midiToFreq(midi), t, sp32 * 0.9, velBass[r], bassBus);
      }
    }

    // Swing: delay odd 32nds
    const isOdd32 = (tick32 % 2) === 1;
    const stepDur = sp32 * (isOdd32 ? (1 + swingPct) : (1 - swingPct));
    nextNoteTime += stepDur;
    tick32 = (tick32 + 1) % STEPS_BASS;
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

// ===== Sequencer interactions (with velocity knobs) =====
const GUTTER_W = 64;
let draggingKnob = null;

cSeq.addEventListener('pointerdown', (e) => {
  const pos = seqHitTest(e);
  if (!pos) return;
  if (pos.kind === 'knob') {
    draggingKnob = { section: pos.section, rowIndex: pos.row };
    updateRowVelocityFromY(pos.section, pos.row, pos.localY, pos.rowH);
  } else if (pos.kind === 'cell') {
    const P = getPatternBySection(pos.section);
    P[pos.row][pos.col] = !P[pos.row][pos.col];
  }
});
cSeq.addEventListener('pointermove', (e) => {
  if (!draggingKnob) return;
  const pos = seqHitTest(e);
  if (!pos || pos.kind !== 'knob' || pos.row !== draggingKnob.rowIndex || pos.section !== draggingKnob.section) return;
  updateRowVelocityFromY(pos.section, pos.row, pos.localY, pos.rowH);
});
cSeq.addEventListener('pointerup', () => draggingKnob = null);
cSeq.addEventListener('pointerleave', () => draggingKnob = null);

function getPatternBySection(section){
  if (section==='lead') return patLead;
  if (section==='bass') return patBass;
  return patDrum;
}
function getVelocityArray(section){
  if (section==='lead') return velLead;
  if (section==='bass') return velBass;
  return velDrum;
}

function seqHitTest(e){
  const rect = cSeq.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;

  const w = cSeq.width, h = cSeq.height;
  const leadH = Math.floor(h * (ROWS_LEAD / TOTAL_ROWS));
  const bassH = Math.floor(h * (ROWS_BASS / TOTAL_ROWS));
  const drumH = h - leadH - bassH;

  if (y < leadH) {
    return rowColOrKnob('lead', x, y, w, leadH, ROWS_LEAD, STEPS_LEAD);
  } else if (y < leadH + bassH) {
    return rowColOrKnob('bass', x, y - leadH, w, bassH, ROWS_BASS, STEPS_BASS);
  } else {
    return rowColOrKnob('drum', x, y - leadH - bassH, w, drumH, ROWS_DRUM, STEPS_DRUM);
  }
}
function rowColOrKnob(section, x, y, w, h, rows, cols){
  const rowH = h / rows;
  const row = Math.floor(y / rowH);
  if (x <= GUTTER_W) {
    const localY = y - row*rowH;
    return { kind:'knob', section, row, localY, rowH };
  }
  const cw = (w - GUTTER_W) / cols;
  const col = Math.floor((x - GUTTER_W) / cw);
  return { kind:'cell', section, row, col };
}
function updateRowVelocityFromY(section, row, localY, rowH){
  const arr = getVelocityArray(section);
  const t = 1 - Math.min(1, Math.max(0, localY / rowH)); // top=1, bottom=0
  const v = 0.1 + 0.9*t;
  arr[row] = v;
}

// ===== Drawing =====
function drawSequencer() {
  resizeCanvasToDisplaySize(cSeq);
  const w = cSeq.width, h = cSeq.height;
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8ab4ff';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9be58c';
  const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gSeq.clearRect(0,0,w,h); gSeq.fillStyle = canvasBg; gSeq.fillRect(0,0,w,h);

  const leadH = Math.floor(h * (ROWS_LEAD / TOTAL_ROWS));
  const bassH = Math.floor(h * (ROWS_BASS / TOTAL_ROWS));
  const drumH = h - leadH - bassH;

  drawBlock('lead', 0,             leadH, ROWS_LEAD, STEPS_LEAD, patLead, velLead, accent2);
  drawBlock('bass', leadH,         bassH, ROWS_BASS, STEPS_BASS, patBass, velBass, accent);
  drawBlock('drum', leadH+bassH,   drumH, ROWS_DRUM, STEPS_DRUM, patDrum, velDrum, '#ffcf77');

  function drawBlock(type, top, height, rows, cols, pattern, velocities, activeFill) {
    const rh = height / rows;
    const cw = (w - GUTTER_W) / cols;

    // gutter
    gSeq.fillStyle = '#151515';
    gSeq.fillRect(0, top, GUTTER_W, height);

    // knobs
    for (let r=0; r<rows; r++){
      const y0 = top + r*rh, yc = y0 + rh/2, xc = GUTTER_W/2;
      const radius = Math.min(20, rh*0.35);
      gSeq.fillStyle = '#222'; gSeq.beginPath(); gSeq.arc(xc, yc, radius, 0, Math.PI*2); gSeq.fill();
      gSeq.strokeStyle = '#444'; gSeq.lineWidth = 2; gSeq.stroke();
      const v = velocities[r];
      gSeq.strokeStyle = activeFill; gSeq.lineWidth = 3;
      const start = -Math.PI*0.75, end = start + v * Math.PI*1.5;
      gSeq.beginPath(); gSeq.arc(xc, yc, radius-2, start, end); gSeq.stroke();
      const ang = end; const ix = xc + (radius-4)*Math.cos(ang), iy = yc + (radius-4)*Math.sin(ang);
      gSeq.strokeStyle = '#fff'; gSeq.lineWidth = 2; gSeq.beginPath(); gSeq.moveTo(xc, yc); gSeq.lineTo(ix, iy); gSeq.stroke();
    }

    // labels
    gSeq.fillStyle = 'rgba(255,255,255,0.6)'; gSeq.font = '12px system-ui'; gSeq.textBaseline = 'middle';
    for (let r=0; r<rows; r++){
      let label = type==='drum' ? ['Kick','Snare','Hat C','Hat O'][r]
                                : midiToNote((type==='lead' ? LEAD_BASE[r] : BASS_BASE[r]-24) + octaveOffset);
      gSeq.fillText(label, 6, top + r*rh + rh/2);
    }

    // active cells
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        if (pattern[r][c]) {
          const x = GUTTER_W + c*cw, y = top + r*rh;
          gSeq.fillStyle = activeFill; gSeq.fillRect(x+1, y+1, cw-2, rh-2);
        }
      }
    }

    // playhead
    if (isPlaying) {
      const step = (type==='bass') ? Math.floor(tick32%cols) : Math.floor((tick32/2)%cols);
      const x = GUTTER_W + step*cw;
      gSeq.fillStyle = 'rgba(255,255,255,0.07)'; gSeq.fillRect(x, top, cw, height);
    }

    // grid
    gSeq.globalAlpha = 0.9; gSeq.strokeStyle = grid; gSeq.lineWidth = 1; gSeq.beginPath();
    for (let i=0;i<=cols;i++){ const x = GUTTER_W + i*cw; gSeq.moveTo(x, top); gSeq.lineTo(x, top+height); }
    for (let j=0;j<=rows;j++){ gSeq.moveTo(GUTTER_W, top+j*rh); gSeq.lineTo(w, top+j*rh); }
    gSeq.stroke();
    gSeq.globalAlpha = 1;

    // bar markers
    gSeq.strokeStyle = 'rgba(255,255,255,0.15)'; gSeq.lineWidth = 2; gSeq.beginPath();
    const stepMark = (cols===32)?8:4;
    for (let i=0;i<=cols;i+=stepMark){ const x = GUTTER_W + i*cw; gSeq.moveTo(x, top); gSeq.lineTo(x, top+height); }
    gSeq.stroke();

    // title
    gSeq.fillStyle = 'rgba(255,255,255,0.45)'; gSeq.font = 'bold 12px system-ui';
    gSeq.fillText(type.toUpperCase(), GUTTER_W + 8, top + 12);
  }
}

function drawImageReactive() {
  resizeCanvasToDisplaySize(cImg);
  const w = cImg.width, h = cImg.height;
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas');

  gImg.clearRect(0,0,w,h); gImg.fillStyle = canvasBg; gImg.fillRect(0,0,w,h);
  gImg.globalAlpha = 0.35; gImg.strokeStyle = grid; gImg.beginPath();
  for (let x=0;x<=w;x+=50){ gImg.moveTo(x,0); gImg.lineTo(x,h); }
  for (let y=0;y<=h;y+=50){ gImg.moveTo(0,y); gImg.lineTo(w,y); }
  gImg.stroke(); gImg.globalAlpha = 1;

  if (!analyser || !imgReady || !imageReactive.checked) return;

  analyser.getByteTimeDomainData(wave);

  // Fit from natural image size
  const {dw, dh, dx, dy} = fitContain(w, h, reactiveImg.width, reactiveImg.height);
  ensureOffscreen(dw, dh);

  const maxDx = Math.max(8, Math.min(40, Math.floor(w * 0.03)));
  const sliceH = 4;

  for (let sy=0; sy<dh; sy+=sliceH) {
    const t = Math.floor((sy/dh) * (wave.length - 1));
    const v = (wave[t] - 128) / 128;
    const shift = v * maxDx;
    gImg.drawImage(offscreen,
      0, sy, dw, sliceH,
      dx + shift, dy + sy, dw, sliceH
    );
  }
}

function drawWaveform() {
  resizeCanvasToDisplaySize(cWave);
  const w = cWave.width, h = cWave.height;
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#9be58c';
  const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gWave.clearRect(0,0,w,h); gWave.fillStyle = canvasBg; gWave.fillRect(0,0,w,h);

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
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#222';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8ab4ff';
  const canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gBars.clearRect(0,0,w,h); gBars.fillStyle = canvasBg; gBars.fillRect(0,0,w,h);

  gBars.globalAlpha = 0.35; gBars.strokeStyle = grid; gBars.beginPath();
  for (let x=0;x<=w;x+=50){ gBars.moveTo(x,0); gBars.lineTo(x,h); }
  for (let y=0;y<=h;y+=50){ gBars.moveTo(0,y); gBars.lineTo(w,y); }
  gBars.stroke(); gBars.globalAlpha = 1;

  if (!analyser) return;
  analyser.getByteFrequencyData(bins);

  const barCount = 128, step = Math.max(1, Math.floor(bins.length / barCount));
  const barW = Math.max(1, w / barCount);
  for (let i=0;i<barCount;i++){
    const v = bins[i*step] / 255;
    const bh = v * (h - 6);
    const x = Math.floor(i*barW);
    const y = h - bh;
    gBars.fillStyle = accent;
    gBars.fillRect(x, y, Math.max(1, barW - 1), bh);
  }
}

function draw() {
  requestAnimationFrame(draw);
  drawImageReactive();
  drawWaveform();
  drawSpectrum();
  drawSequencer();
}
draw();
