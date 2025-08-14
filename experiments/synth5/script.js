/* =========================
   Theory-aware Sequencer + Chords + MIDI export
   ========================= */

/* ---------- Theme per octave ---------- */
const THEMES = [
  { bg:'#121212', panel:'#1b1b1b', line:'#2a2a2a', canvas:'#0e0e0e', grid:'#222', accent:'#8ab4ff', accent2:'#9be58c' },
  { bg:'#0f141a', panel:'#15202b', line:'#253341', canvas:'#0b1116', grid:'#1c2a35', accent:'#64b5f6', accent2:'#81c784' },
  { bg:'#161217', panel:'#221b25', line:'#3a2e43', canvas:'#120f14', grid:'#2a2230', accent:'#ba68c8', accent2:'#ffb74d' },
  { bg:'#12160f', panel:'#1b2215', line:'#2a3a21', canvas:'#0e120b', grid:'#1f2a18', accent:'#a5d6a7', accent2:'#ffcc80' },
  { bg:'#1a1310', panel:'#281b16', line:'#3e2a22', canvas:'#140f0c', grid:'#2b201b', accent:'#ffab91', accent2:'#ffd54f' },
];
function applyTheme(idx){
  const t = THEMES[(idx+2)%THEMES.length];
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg); r.setProperty('--panel', t.panel); r.setProperty('--line', t.line);
  r.setProperty('--canvas', t.canvas); r.setProperty('--grid', t.grid);
  r.setProperty('--accent', t.accent); r.setProperty('--accent2', t.accent2);
}

/* ---------- Note utils ---------- */
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const nameToSemitone = (n) => NOTE_NAMES.indexOf(n);
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const midiToNote = (m) => NOTE_NAMES[m % 12] + (Math.floor(m/12)-1);
const noteNameToMidi = (n) => {
  const m = n.match(/^([A-G]#?)(-?\d)$/); if(!m) return 60;
  return 12*(+m[2]+1)+NOTE_NAMES.indexOf(m[1]);
};

/* ---------- Keyboard live play ---------- */
const KEY_TO_NOTE = { a:'C4', w:'C#4', s:'D4', e:'D#4', d:'E4', f:'F4', t:'F#4', g:'G4', y:'G#4', h:'A4', u:'A#4', j:'B4', k:'C5' };

/* ---------- Audio graph ---------- */
let ctx, analyser, filter, lfo, lfoGain, delayNode, feedbackGain, delayMixGain, masterGain;
let leadBus, bassBus, drumBus, mixBus;
const activeVoices = new Set(), keyVoices = new Map(), sustainedVoices = new Map();
let sustainPedal = false, started = false;

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
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(e) {} }
}
async function initAudio() {
  if (started) return;
  await ensureContextRunning();

  masterGain = ctx.createGain(); masterGain.gain.value = 0.85;

  leadBus = ctx.createGain(); leadBus.gain.value = state.volume.lead;
  bassBus = ctx.createGain(); bassBus.gain.value = state.volume.bass;
  drumBus = ctx.createGain(); drumBus.gain.value = state.volume.drum;

  mixBus = ctx.createGain();

  filter = ctx.createBiquadFilter();
  filter.type = state.filter.type; filter.frequency.value = state.filter.cutoff; filter.Q.value = state.filter.q;

  delayNode = ctx.createDelay(1.5);
  feedbackGain = ctx.createGain(); delayMixGain = ctx.createGain();
  delayNode.delayTime.value = state.delay.time; feedbackGain.gain.value = state.delay.feedback; delayMixGain.gain.value = state.delay.mix;
  delayNode.connect(feedbackGain); feedbackGain.connect(delayNode);

  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;

  lfo = ctx.createOscillator(); lfoGain = ctx.createGain();
  lfo.frequency.value = state.lfo.rate; lfoGain.gain.value = state.lfo.depth;
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency);

  // Routing
  leadBus.connect(mixBus); bassBus.connect(mixBus); drumBus.connect(mixBus);
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

  lfo.start(); started = true;
}

function startVoiceAt(freq, when, velocity=1.0, bus=leadBus){
  const osc = ctx.createOscillator(); osc.type = state.wave; osc.frequency.setValueAtTime(freq, when);
  const vca = ctx.createGain(); vca.gain.setValueAtTime(0, when);
  const { attack, decay, sustain } = state.env;
  const peak = Math.max(0.0001, Math.min(1, velocity));
  vca.gain.linearRampToValueAtTime(peak, when + attack);
  vca.gain.linearRampToValueAtTime(peak * sustain, when + attack + decay);
  osc.connect(vca); vca.connect(bus); osc.start(when);
  return { osc, vca };
}
function releaseVoice(v, when=ctx.currentTime){
  if (!v) return;
  const { release } = state.env;
  try {
    v.vca.gain.cancelScheduledValues(when);
    v.vca.gain.setValueAtTime(v.vca.gain.value, when);
    v.vca.gain.linearRampToValueAtTime(0, when + release);
    v.osc.stop(when + release + 0.05);
  } catch {}
}
function scheduleMelodic(freq, t, gateSec, velocity, bus){
  const v = startVoiceAt(freq, t, velocity, bus);
  const off = t + gateSec;
  v.vca.gain.setValueAtTime(v.vca.gain.value, off);
  v.vca.gain.linearRampToValueAtTime(0, off + state.env.release);
  v.osc.stop(off + state.env.release + 0.05);
}

/* ---------- Drums ---------- */
let noiseBuf=null;
function noise() {
  if (noiseBuf) return noiseBuf;
  const sr = ctx.sampleRate, len = sr * 2;
  const buf = ctx.createBuffer(1, len, sr); const d = buf.getChannelData(0);
  for (let i=0;i<len;i++) d[i] = Math.random()*2-1; noiseBuf = buf; return buf;
}
function scheduleKick(t, vel=0.9){
  const osc = ctx.createOscillator(); osc.type='sine';
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.max(0.0001, vel), t);
  osc.frequency.setValueAtTime(160, t); osc.frequency.exponentialRampToValueAtTime(50, t+0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.18); osc.connect(g); g.connect(drumBus);
  osc.start(t); osc.stop(t+0.22);
}
function scheduleSnare(t, vel=0.6){
  const src = ctx.createBufferSource(); src.buffer = noise();
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=700;
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.max(0.0001, vel), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.15);
  src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(drumBus);
  src.start(t); src.stop(t+0.2);
}
function scheduleHat(t, open=false, vel=0.4){
  const src = ctx.createBufferSource(); src.buffer = noise();
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=6000;
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.max(0.0001, vel), t);
  const dur = open ? 0.25 : 0.06; g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  src.connect(hp); hp.connect(g); g.connect(drumBus);
  src.start(t); src.stop(t + dur + 0.05);
}

/* ---------- UI refs ---------- */
const $ = (id)=>document.getElementById(id);

const modeSel = $('mode'), keyRootSel = $('keyRoot'), scaleSel = $('scaleType');
const attack=$('attack'), decay=$('decay'), sustain=$('sustain'), release=$('release');
const cutoff=$('cutoff'), q=$('q'), filterType=$('filterType');
const lfoRate=$('lfoRate'), lfoDepth=$('lfoDepth');
const delayTime=$('delayTime'), delayFeedback=$('delayFeedback'), delayMix=$('delayMix');
const imageInput=$('imageInput'), imageReactive=$('imageReactive');
const transportBtn=$('transportBtn'), bpmInput=$('bpm'), swingInput=$('swing'), clearSeqBtn=$('clearSeq');
const leadVol=$('leadVol'), bassVol=$('bassVol'), drumVol=$('drumVol');
const octaveDisp=$('octaveDisp'), exportMidiBtn=$('exportMidiBtn');

$('startBtn').addEventListener('click', async ()=>{ await initAudio(); });
$('stopAllBtn').addEventListener('click', ()=> started && stopAllNotes());

document.querySelectorAll('input[name="wave"]').forEach(r=> r.addEventListener('change', ()=> state.wave = r.value));

[attack,decay,sustain,release].forEach(el=>el.addEventListener('input', ()=>{
  state.env.attack=+attack.value; state.env.decay=+decay.value; state.env.sustain=+sustain.value; state.env.release=+release.value;
}));
filterType.addEventListener('change', ()=> { if (started){ state.filter.type=filterType.value; filter.type=state.filter.type; }});
cutoff.addEventListener('input', ()=> { if (started){ state.filter.cutoff=+cutoff.value; filter.frequency.setTargetAtTime(state.filter.cutoff, ctx.currentTime, 0.01); }});
q.addEventListener('input', ()=> { if (started){ state.filter.q=+q.value; filter.Q.setTargetAtTime(state.filter.q, ctx.currentTime, 0.01); }});
lfoRate.addEventListener('input', ()=> { if (started){ state.lfo.rate=+lfoRate.value; lfo.frequency.setTargetAtTime(state.lfo.rate, ctx.currentTime, 0.01); }});
lfoDepth.addEventListener('input', ()=> { if (started){ state.lfo.depth=+lfoDepth.value; lfoGain.gain.setTargetAtTime(state.lfo.depth, ctx.currentTime, 0.02); }});
delayTime.addEventListener('input', ()=> { if (started){ state.delay.time=+delayTime.value; delayNode.delayTime.setTargetAtTime(state.delay.time, ctx.currentTime, 0.02); }});
delayFeedback.addEventListener('input', ()=> { if (started){ state.delay.feedback=+delayFeedback.value; feedbackGain.gain.setTargetAtTime(state.delay.feedback, ctx.currentTime, 0.02); }});
delayMix.addEventListener('input', ()=> { if (started){ state.delay.mix=+delayMix.value; delayMixGain.gain.setTargetAtTime(state.delay.mix, ctx.currentTime, 0.02); }});

[leadVol,bassVol,drumVol].forEach(el=>el.addEventListener('input', ()=>{
  if (!started) return;
  leadBus.gain.setTargetAtTime(+leadVol.value, ctx.currentTime, 0.02);
  bassBus.gain.setTargetAtTime(+bassVol.value, ctx.currentTime, 0.02);
  drumBus.gain.setTargetAtTime(+drumVol.value, ctx.currentTime, 0.02);
}));

/* ---------- Keyboard: sustain + octave + theme ---------- */
let octaveOffset = 0;
function updateOctaveUI(){ octaveDisp.textContent = (octaveOffset/12)|0; applyTheme((octaveOffset/12)|0 + 2); }
applyTheme(2);

window.addEventListener('keydown', async (e)=>{
  const key = e.key.toLowerCase();
  if (key === ' ') { if (!sustainPedal) sustainPedal = true; e.preventDefault(); return; }
  if (key === 'z') { octaveOffset = Math.max(-24, octaveOffset - 12); updateOctaveUI(); e.preventDefault(); return; }
  if (key === 'x') { octaveOffset = Math.min( 24, octaveOffset + 12); updateOctaveUI(); e.preventDefault(); return; }
  if (!(key in KEY_TO_NOTE) || keyVoices.has(key)) return;
  e.preventDefault(); await initAudio();
  const freq = midiToFreq(noteNameToMidi(KEY_TO_NOTE[key]) + octaveOffset);
  const v = startVoiceAt(freq, ctx.currentTime, 1.0, leadBus);
  keyVoices.set(key, v);
});
window.addEventListener('keyup', (e)=>{
  const key = e.key.toLowerCase();
  if (key === ' ') { sustainPedal = false; for (const [k,v] of sustainedVoices){ releaseVoice(v); sustainedVoices.delete(k); keyVoices.delete(k);} e.preventDefault(); return; }
  const v = keyVoices.get(key); if (!v) return;
  if (sustainPedal) sustainedVoices.set(key, v); else { releaseVoice(v); keyVoices.delete(key); }
});

function stopAllNotes(){
  for (const v of [...activeVoices]) { releaseVoice(v); activeVoices.delete(v); }
  for (const [k,v] of keyVoices) { if (!sustainPedal) { releaseVoice(v); keyVoices.delete(k); } }
  if (!sustainPedal) sustainedVoices.clear();
}

/* ---------- Visual canvases ---------- */
const cSeq=$('seq'), gSeq=cSeq.getContext('2d');
const cImg=$('img'), gImg=cImg.getContext('2d');
const cWave=$('wave'), gWave=cWave.getContext('2d');
const cBars=$('bars'), gBars=cBars.getContext('2d');

function resizeCanvasToDisplaySize(c){ const w=c.clientWidth, h=c.clientHeight; if(c.width!==w||c.height!==h){ c.width=w; c.height=h; } }
function resizeAll(){ [cSeq,cImg,cWave,cBars].forEach(resizeCanvasToDisplaySize); }
window.addEventListener('resize', resizeAll);
new ResizeObserver(resizeAll).observe(document.querySelector('.display'));
new ResizeObserver(resizeAll).observe(document.querySelector('.topRow'));
new ResizeObserver(resizeAll).observe(document.querySelector('.stack'));
resizeAll();

/* ---------- Image reactive (contain-fit using natural size) ---------- */
let reactiveImg=null, imgReady=false, offscreen=null, offctx=null;
imageInput.addEventListener('change',(e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{ reactiveImg=img; imgReady=true; offscreen=null; offctx=null; URL.revokeObjectURL(url); };
  img.src=url;
});
function fitContain(w,h,iw,ih){ const s=Math.min(w/iw,h/ih,1); const dw=Math.max(1,Math.floor(iw*s)), dh=Math.max(1,Math.floor(ih*s)); return {dw,dh,dx:Math.floor((w-dw)/2),dy:Math.floor((h-dh)/2)}; }
function ensureOffscreen(dw,dh){ if(!offscreen||offscreen.width!==dw||offscreen.height!==dh){ offscreen=document.createElement('canvas'); offscreen.width=dw; offscreen.height=dh; offctx=offscreen.getContext('2d'); offctx.imageSmoothingEnabled=true; }
  offctx.clearRect(0,0,dw,dh); offctx.drawImage(reactiveImg,0,0,reactiveImg.naturalWidth||reactiveImg.width,reactiveImg.naturalHeight||reactiveImg.height,0,0,dw,dh); }

/* ---------- Analyser data ---------- */
let waveArr=new Uint8Array(1024), bins=new Uint8Array(1024);

/* ---------- Scale systems ---------- */
const SCALES = {
  major:            [0,2,4,5,7,9,11],
  naturalMinor:     [0,2,3,5,7,8,10],
  harmonicMinor:    [0,2,3,5,7,8,11],
  dorian:           [0,2,3,5,7,9,10],
  pentatonicMajor:  [0,2,4,7,9],
  pentatonicMinor:  [0,3,5,7,10],
};
const STEPS_LEAD = 16, STEPS_BASS = 32, STEPS_DRUM = 16;
const DRUM_NAMES=['Kick','Snare','Hat C','Hat O'];

let MODE = 'scale'; // 'scale' | 'chromatic'
let KEY_ROOT = 'C', SCALE = 'naturalMinor';

function buildRowMIDI() {
  const baseOctLead = 5;      // center Lead around C5..C3-ish
  const baseOctBass = 3;      // Bass two octs lower naturally (we still apply -24 later if desired)

  if (MODE === 'chromatic') {
    // 24 rows: two octaves descending high→low
    const topMidiLead = 12*(baseOctLead+1); // C6
    const rowsLead = Array.from({length:24},(_,i)=> topMidiLead - i);
    const topMidiBass = 12*(baseOctBass+1); // C4
    const rowsBass = Array.from({length:24},(_,i)=> topMidiBass - i);
    return { rowsLead, rowsBass };
  }

  // Scale mode: two octaves of the chosen scale degrees
  const rootSemi = nameToSemitone(KEY_ROOT);
  const degrees = SCALES[SCALE] || SCALES.naturalMinor;
  const degCount = degrees.length;
  const octaves = 2;
  const rowsLead = [];
  const rowsBass = [];
  for (let o=octaves-1; o>=0; o--) { // high → low for UI
    for (let d=degCount-1; d>=0; d--) {
      const semi = rootSemi + degrees[d] + o*12;
      rowsLead.push(12*(baseOctLead-1) + semi); // around ~C5 area
      rowsBass.push(12*(baseOctBass-1) + semi);
    }
  }
  return { rowsLead, rowsBass };
}

/* ---------- Patterns & velocities (dynamic rows) ---------- */
let ROWS_LEAD_MIDI = [], ROWS_BASS_MIDI = [];
let patLead = [], patBass = [], patDrum = Array.from({length:4},()=>Array(STEPS_DRUM).fill(false));
let velLead = [], velBass = [], velDrum = [0.85,0.85,0.85,0.85];

function resetPitchGrids(){
  const { rowsLead, rowsBass } = buildRowMIDI();
  ROWS_LEAD_MIDI = rowsLead.map(m=>m); ROWS_BASS_MIDI = rowsBass.map(m=>m-24); // Bass two octaves down by default
  patLead = Array.from({length: ROWS_LEAD_MIDI.length}, ()=> Array(STEPS_LEAD).fill(false));
  patBass = Array.from({length: ROWS_BASS_MIDI.length}, ()=> Array(STEPS_BASS).fill(false));
  velLead = new Array(ROWS_LEAD_MIDI.length).fill(0.85);
  velBass = new Array(ROWS_BASS_MIDI.length).fill(0.85);
}
resetPitchGrids();

/* ---------- Transport / scheduler ---------- */
let isPlaying=false, nextNoteTime=0, tick32=0;
const scheduleAheadTime=0.1, lookaheadMs=25;

function secondsPer32nd(){
  const bpm = Math.max(40, Math.min(240, +bpmInput.value || 120));
  const sp32 = 60.0 / bpm / 8.0;
  const swingPct = Math.max(0, Math.min(65, +swingInput.value || 0)) / 100;
  return { sp32, swingPct };
}

let schedulerTimer=null;
function schedulerTick(){
  if (!started || !isPlaying) return;
  const { sp32, swingPct } = secondsPer32nd();

  while (nextNoteTime < ctx.currentTime + scheduleAheadTime) {
    const t = nextNoteTime;

    // Lead on 16ths
    if (tick32 % 2 === 0) {
      const stepL = (tick32/2) % STEPS_LEAD;
      for (let r=0; r<ROWS_LEAD_MIDI.length; r++) if (patLead[r][stepL]) {
        const midi = ROWS_LEAD_MIDI[r] + octaveOffset;
        scheduleMelodic(midiToFreq(midi), t, sp32*2*0.9, velLead[r], leadBus);
      }
      // Drums (16ths)
      const stepD = stepL;
      if (patDrum[0][stepD]) scheduleKick(t, velDrum[0]);
      if (patDrum[1][stepD]) scheduleSnare(t, velDrum[1]);
      if (patDrum[2][stepD]) scheduleHat(t,false, velDrum[2]);
      if (patDrum[3][stepD]) scheduleHat(t,true,  velDrum[3]);
    }

    // Bass on 32nds
    const stepB = tick32 % STEPS_BASS;
    for (let r=0; r<ROWS_BASS_MIDI.length; r++) if (patBass[r][stepB]) {
      const midi = ROWS_BASS_MIDI[r] + octaveOffset;
      scheduleMelodic(midiToFreq(midi), t, sp32*0.9, velBass[r], bassBus);
    }

    // swing
    const isOdd32 = (tick32 % 2) === 1;
    const stepDur = sp32 * (isOdd32 ? (1 + swingPct) : (1 - swingPct));
    nextNoteTime += stepDur;
    tick32 = (tick32 + 1) % STEPS_BASS;
  }
}
function startTransport(){ if (!started) return; if (isPlaying) return; isPlaying=true; tick32=0; nextNoteTime=ctx.currentTime+0.05; schedulerTimer=setInterval(schedulerTick, lookaheadMs); transportBtn.textContent='Stop'; }
function stopTransport(){ isPlaying=false; if (schedulerTimer){ clearInterval(schedulerTimer); schedulerTimer=null; } transportBtn.textContent='Play'; }
transportBtn.addEventListener('click', async ()=>{ await initAudio(); isPlaying?stopTransport():startTransport(); });
clearSeqBtn.addEventListener('click', ()=>{ resetPitchGrids(); patDrum = Array.from({length:4},()=>Array(STEPS_DRUM).fill(false)); });

/* ---------- Sequencer interactions + CHORD shortcuts ---------- */
const GUTTER_W = 64;
let draggingKnob=null;

cSeq.addEventListener('pointerdown', (e)=>{
  const pos = seqHitTest(e); if (!pos) return;
  if (pos.kind==='knob'){ draggingKnob = {section:pos.section,rowIndex:pos.row}; updateRowVelocityFromY(pos.section,pos.row,pos.localY,pos.rowH); return; }
  if (pos.kind==='cell'){
    const addTriad = e.shiftKey;
    const add7th = e.ctrlKey || e.metaKey;

    if (pos.section==='drum'){
      patDrum[pos.row][pos.col] = !patDrum[pos.row][pos.col];
      return;
    }

    // Lead/Bass chords
    const P = (pos.section==='lead') ? patLead : patBass;
    const rowsMidi = (pos.section==='lead') ? ROWS_LEAD_MIDI : ROWS_BASS_MIDI;

    if (!addTriad && !add7th){
      P[pos.row][pos.col] = !P[pos.row][pos.col];
      return;
    }

    // Build chord from current mode
    const rootMidi = rowsMidi[pos.row];
    const rowsCount = rowsMidi.length;

    const chordOffsetsSemis = (MODE==='chromatic')
      ? (add7th ? [0,4,7,10] : [0,4,7])           // major triad (+ minor 7th)
      : diatonicChordOffsets(rowsMidi, pos.row, add7th); // scale degrees 1-3-5-(7)

    // For each offset, find the nearest row with that MIDI (within this section) and toggle
    chordOffsetsSemis.forEach(semi=>{
      const target = rootMidi + semi;
      // pick row with same pitch class within ±24 semis (wrap by 12 across rows)
      let bestRow = -1, bestDiff = 9999;
      for (let r=0;r<rowsCount;r++){
        const diff = Math.abs((rowsMidi[r] % 12) - (target % 12)) + Math.abs(Math.floor(rowsMidi[r]/12) - Math.floor(target/12))*12;
        if (diff < bestDiff) { bestDiff = diff; bestRow = r; }
      }
      if (bestRow>=0) P[bestRow][pos.col] = true;
    });
  }
});
cSeq.addEventListener('pointermove', (e)=>{
  if (!draggingKnob) return;
  const pos = seqHitTest(e);
  if (!pos || pos.kind!=='knob' || pos.section!==draggingKnob.section || pos.row!==draggingKnob.rowIndex) return;
  updateRowVelocityFromY(pos.section,pos.row,pos.localY,pos.rowH);
});
cSeq.addEventListener('pointerup', ()=> draggingKnob=null);
cSeq.addEventListener('pointerleave', ()=> draggingKnob=null);

function diatonicChordOffsets(rowsMidi, rowIndex, add7th){
  // Build 1–3–5–(7) in current scale by walking rows of the same section (since rows are degrees high→low)
  // Each degree is adjacent (downwards). Root rowIndex, then +2, +4, (+6).
  const degStep = 1; // one row = next degree
  const offsets = [0]; // in semitones relative to root
  const indices = [rowIndex, rowIndex-2*degStep, rowIndex-4*degStep]; // rows go high→low
  if (add7th) indices.push(rowIndex-6*degStep);
  // Convert row indices to semitone offsets using their MIDI difference to root row
  const root = rowsMidi[rowIndex];
  const out = [];
  for (const idx of indices){
    if (idx<0 || idx>=rowsMidi.length) continue;
    out.push(rowsMidi[idx] - root);
  }
  // Ensure root present
  if (!out.includes(0)) out.push(0);
  // Unique + sort low→high
  return [...new Set(out)].sort((a,b)=>a-b);
}

function getPatternBySection(section){ if (section==='lead') return patLead; if (section==='bass') return patBass; return patDrum; }
function getVelocityArray(section){ if (section==='lead') return velLead; if (section==='bass') return velBass; return velDrum; }

function seqHitTest(e){
  const r = cSeq.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const w = cSeq.width, h = cSeq.height;

  const totalRows = ROWS_LEAD_MIDI.length + ROWS_BASS_MIDI.length + 4;
  const leadH = Math.floor(h * (ROWS_LEAD_MIDI.length / totalRows));
  const bassH = Math.floor(h * (ROWS_BASS_MIDI.length / totalRows));
  const drumH = h - leadH - bassH;

  if (y < leadH) return rowColOrKnob('lead', x, y, w, leadH, ROWS_LEAD_MIDI.length, STEPS_LEAD);
  if (y < leadH + bassH) return rowColOrKnob('bass', x, y - leadH, w, bassH, ROWS_BASS_MIDI.length, STEPS_BASS);
  return rowColOrKnob('drum', x, y - leadH - bassH, w, drumH, 4, STEPS_DRUM);
}
function rowColOrKnob(section, x, y, w, h, rows, cols){
  const rowH = h / rows;
  const row = Math.max(0, Math.min(rows-1, Math.floor(y / rowH)));
  if (x <= GUTTER_W) return { kind:'knob', section, row, localY: y - row*rowH, rowH };
  const cw = (w - GUTTER_W) / cols;
  const col = Math.max(0, Math.min(cols-1, Math.floor((x - GUTTER_W) / cw)));
  return { kind:'cell', section, row, col };
}
function updateRowVelocityFromY(section, row, localY, rowH){
  const arr = getVelocityArray(section);
  const t = 1 - Math.min(1, Math.max(0, localY / rowH)); // top=1, bottom=0
  arr[row] = 0.1 + 0.9*t;
}

/* ---------- Drawing ---------- */
function drawSequencer(){
  resizeCanvasToDisplaySize(cSeq);
  const w=cSeq.width, h=cSeq.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#8ab4ff';
  const accent2=getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim()||'#9be58c';
  const canvasBg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gSeq.clearRect(0,0,w,h); gSeq.fillStyle=canvasBg; gSeq.fillRect(0,0,w,h);

  const totalRows = ROWS_LEAD_MIDI.length + ROWS_BASS_MIDI.length + 4;
  const leadH = Math.floor(h * (ROWS_LEAD_MIDI.length / totalRows));
  const bassH = Math.floor(h * (ROWS_BASS_MIDI.length / totalRows));
  const drumH = h - leadH - bassH;

  drawBlock('lead', 0, leadH, ROWS_LEAD_MIDI.length, STEPS_LEAD, patLead, velLead, accent2, ROWS_LEAD_MIDI);
  drawBlock('bass', leadH, bassH, ROWS_BASS_MIDI.length, STEPS_BASS, patBass, velBass, accent, ROWS_BASS_MIDI);
  drawBlock('drum', leadH+bassH, drumH, 4, STEPS_DRUM, patDrum, velDrum, '#ffcf77');

  function drawBlock(type, top, height, rows, cols, pattern, velocities, activeFill, rowMidi){
    const rh = height / rows;
    const cw = (w - GUTTER_W) / cols;

    // gutter
    gSeq.fillStyle = '#151515'; gSeq.fillRect(0, top, GUTTER_W, height);

    // knobs + labels
    gSeq.fillStyle = 'rgba(255,255,255,0.6)'; gSeq.textBaseline='middle'; gSeq.font='12px system-ui';
    for (let r=0;r<rows;r++){
      const y0=top + r*rh, yc=y0 + rh/2, xc=GUTTER_W/2, radius=Math.min(20, rh*0.35);
      // knob
      gSeq.fillStyle='#222'; gSeq.beginPath(); gSeq.arc(xc,yc,radius,0,Math.PI*2); gSeq.fill();
      gSeq.strokeStyle='#444'; gSeq.lineWidth=2; gSeq.stroke();
      // arc
      gSeq.strokeStyle=activeFill; gSeq.lineWidth=3;
      const v=velocities[r], start=-Math.PI*0.75, end=start+v*Math.PI*1.5;
      gSeq.beginPath(); gSeq.arc(xc,yc,radius-2,start,end); gSeq.stroke();
      // label
      gSeq.fillStyle='rgba(255,255,255,0.7)';
      const label = type==='drum' ? DRUM_NAMES[r] : midiToNote((rowMidi[r]||0) + octaveOffset);
      gSeq.fillText(label, 6, yc);
    }

    // active cells
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        if (pattern[r][c]) { const x=GUTTER_W+c*cw, y=top+r*rh; gSeq.fillStyle=activeFill; gSeq.fillRect(x+1,y+1,cw-2,rh-2); }
      }
    }

    // playhead
    if (isPlaying){
      const step = (type==='bass') ? Math.floor(tick32%cols) : Math.floor((tick32/2)%cols);
      const x = GUTTER_W + step*cw;
      gSeq.fillStyle='rgba(255,255,255,0.07)'; gSeq.fillRect(x, top, cw, height);
    }

    // grid
    gSeq.globalAlpha=0.9; gSeq.strokeStyle=grid; gSeq.lineWidth=1; gSeq.beginPath();
    for (let i=0;i<=cols;i++){ const x=GUTTER_W+i*cw; gSeq.moveTo(x,top); gSeq.lineTo(x,top+height); }
    for (let j=0;j<=rows;j++){ gSeq.moveTo(GUTTER_W,top+j*rh); gSeq.lineTo(w,top+j*rh); }
    gSeq.stroke(); gSeq.globalAlpha=1;

    // bar markers
    gSeq.strokeStyle='rgba(255,255,255,0.15)'; gSeq.lineWidth=2; gSeq.beginPath();
    const mark=(cols===32)?8:4; for (let i=0;i<=cols;i+=mark){ const x=GUTTER_W+i*cw; gSeq.moveTo(x,top); gSeq.lineTo(x,top+height); } gSeq.stroke();

    // title
    gSeq.fillStyle='rgba(255,255,255,0.45)'; gSeq.font='bold 12px system-ui';
    gSeq.fillText(type.toUpperCase(), GUTTER_W+8, top+12);
  }
}

function drawImageReactive(){
  resizeCanvasToDisplaySize(cImg);
  const w=cImg.width,h=cImg.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const canvasBg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gImg.clearRect(0,0,w,h); gImg.fillStyle=canvasBg; gImg.fillRect(0,0,w,h);
  gImg.globalAlpha=0.35; gImg.strokeStyle=grid; gImg.beginPath();
  for(let x=0;x<=w;x+=50){ gImg.moveTo(x,0); gImg.lineTo(x,h); }
  for(let y=0;y<=h;y+=50){ gImg.moveTo(0,y); gImg.lineTo(w,y); }
  gImg.stroke(); gImg.globalAlpha=1;

  if(!analyser || !imgReady || !imageReactive.checked) return;
  analyser.getByteTimeDomainData(waveArr);

  const iw=reactiveImg.naturalWidth||reactiveImg.width, ih=reactiveImg.naturalHeight||reactiveImg.height;
  const {dw,dh,dx,dy}=fitContain(w,h,iw,ih); ensureOffscreen(dw,dh);

  const maxDx=Math.max(8,Math.min(40,Math.floor(w*0.03))), sliceH=4;
  for(let sy=0; sy<dh; sy+=sliceH){
    const t=Math.floor((sy/dh)*(waveArr.length-1)); const v=(waveArr[t]-128)/128; const shift=v*maxDx;
    gImg.drawImage(offscreen,0,sy,dw,sliceH, dx+shift,dy+sy,dw,sliceH);
  }
}
function drawWaveform(){
  resizeCanvasToDisplaySize(cWave);
  const w=cWave.width,h=cWave.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const accent2=getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim()||'#9be58c';
  const canvasBg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gWave.clearRect(0,0,w,h); gWave.fillStyle=canvasBg; gWave.fillRect(0,0,w,h);
  gWave.globalAlpha=0.35; gWave.strokeStyle=grid; gWave.beginPath();
  for(let x=0;x<=w;x+=50){ gWave.moveTo(x,0); gWave.lineTo(x,h); }
  for(let y=0;y<=h;y+=50){ gWave.moveTo(0,y); gWave.lineTo(w,y); }
  gWave.stroke(); gWave.globalAlpha=1;

  if (!analyser) return;
  analyser.getByteTimeDomainData(waveArr);
  gWave.lineWidth=2; gWave.strokeStyle=accent2; gWave.beginPath();
  for (let i=0;i<waveArr.length;i++){ const x=(i/(waveArr.length-1))*w; const v=(waveArr[i]-128)/128; const y=(h/2)+v*(h*0.45); i===0?gWave.moveTo(x,y):gWave.lineTo(x,y); }
  gWave.stroke();
}
function drawSpectrum(){
  resizeCanvasToDisplaySize(cBars);
  const w=cBars.width,h=cBars.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#8ab4ff';
  const canvasBg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gBars.clearRect(0,0,w,h); gBars.fillStyle=canvasBg; gBars.fillRect(0,0,w,h);
  gBars.globalAlpha=0.35; gBars.strokeStyle=grid; gBars.beginPath();
  for(let x=0;x<=w;x+=50){ gBars.moveTo(x,0); gBars.lineTo(x,h); }
  for(let y=0;y<=h;y+=50){ gBars.moveTo(0,y); gBars.lineTo(w,y); }
  gBars.stroke(); gBars.globalAlpha=1;

  if (!analyser) return;
  analyser.getByteFrequencyData(bins);
  const barCount=128, step=Math.max(1,Math.floor(bins.length/barCount)), barW=Math.max(1,w/barCount);
  for(let i=0;i<barCount;i++){
    const v=bins[i*step]/255, bh=v*(h-6), x=Math.floor(i*barW), y=h-bh;
    gBars.fillStyle=accent; gBars.fillRect(x,y,Math.max(1,barW-1),bh);
  }
}
function draw(){ requestAnimationFrame(draw); drawImageReactive(); drawWaveform(); drawSpectrum(); drawSequencer(); }
draw();

/* ---------- Mode/Key/Scale handlers ---------- */
function refreshTheory(){
  MODE = modeSel.value;
  KEY_ROOT = keyRootSel.value;
  SCALE = scaleSel.value;
  resetPitchGrids();
}
[modeSel, keyRootSel, scaleSel].forEach(el=> el.addEventListener('change', refreshTheory));

/* ---------- MIDI Export (SMF Type 1, 480 PPQ) ---------- */
exportMidiBtn.addEventListener('click', ()=> {
  const bpm = Math.max(40, Math.min(240, +bpmInput.value || 120));
  const ppq = 480;
  const tracks = [];

  function pushTempoTrack(){
    const t=[]; // delta-time, event bytes
    // Set Tempo (microseconds per quarter)
    const usPerQ = Math.round(60000000 / bpm);
    t.push(...midiDelta(0), 0xFF, 0x51, 0x03, (usPerQ>>16)&0xFF, (usPerQ>>8)&0xFF, usPerQ&0xFF);
    // Time Signature 4/4
    t.push(...midiDelta(0), 0xFF, 0x58, 0x04, 4, 2, 24, 8);
    // End of track
    t.push(...midiDelta(0), 0xFF, 0x2F, 0x00);
    tracks.push(t);
  }

  function buildTrack(pattern, rowsMidi, steps, channel, velocities, isBass=false){
    const ev=[];
    const stepDurTicks = Math.round(ppq / 4); // 16th = quarter/4
    const stepDurBass = Math.round(ppq / 8);  // 32nd for bass
    const durTicks = isBass ? stepDurBass : stepDurTicks;

    for (let c=0;c<steps;c++){
      // For all rows, emit note-ons at column c; turn them off at column end
      for (let r=0;r<rowsMidi.length;r++){
        if (pattern[r][c]){
          const midi = rowsMidi[r] + octaveOffset;
          const vel = Math.max(1, Math.min(127, Math.round(velocities[r]*127)));
          // Note On
          ev.push(...midiDelta(0), 0x90|channel, midi & 0x7F, vel);
          // Note Off after duration
          ev.push(...midiDelta(durTicks), 0x80|channel, midi & 0x7F, 0x40);
        }
      }
      // advance to next column time if no notes were on; we already advanced per-note, so add a "barrier" of 0 ticks
    }

    // End
    ev.push(...midiDelta(0), 0xFF, 0x2F, 0x00);
    tracks.push(ev);
  }

  function buildDrumTrack(){
    const ev=[];
    const stepDurTicks = Math.round(ppq / 4); // 16th
    const notesGM = [36,38,42,46]; // kick, snare, hatC, hatO on channel 9
    for (let c=0;c<STEPS_DRUM;c++){
      for (let r=0;r<4;r++){
        if (patDrum[r][c]){
          const vel = Math.max(1, Math.min(127, Math.round(velDrum[r]*127)));
          ev.push(...midiDelta(0), 0x99, notesGM[r], vel);
          ev.push(...midiDelta(stepDurTicks), 0x89, notesGM[r], 0x40);
        }
      }
    }
    ev.push(...midiDelta(0), 0xFF, 0x2F, 0x00);
    tracks.push(ev);
  }

  pushTempoTrack();
  buildTrack(patLead, ROWS_LEAD_MIDI, STEPS_LEAD, 0, velLead, false);
  buildTrack(patBass, ROWS_BASS_MIDI, STEPS_BASS, 1, velBass, true);
  buildDrumTrack();

  const bytes = buildSMF(tracks, ppq);
  const blob = new Blob([new Uint8Array(bytes)], {type:'audio/midi'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='pattern.mid'; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
});

function midiDelta(v){ // variable-length qty
  const bytes=[]; let buffer=v & 0x7F;
  while ((v >>= 7)) { buffer <<= 8; buffer |= ((v & 0x7F) | 0x80); }
  while (true){ bytes.push(buffer & 0xFF); if (buffer & 0x80) buffer >>= 8; else break; }
  return bytes;
}
function buildSMF(tracks, ppq){
  function strBytes(s){ return [...s].map(ch=>ch.charCodeAt(0)); }
  const out=[];
  // Header
  out.push(...strBytes('MThd'), 0,0,0,6, 0,1, 0, tracks.length, (ppq>>8)&0xFF, ppq&0xFF);
  for (const t of tracks){
    out.push(...strBytes('MTrk'));
    const len = t.length;
    out.push( (len>>>24)&0xFF, (len>>>16)&0xFF, (len>>>8)&0xFF, len&0xFF );
    out.push(...t);
  }
  return out;
}

/* ---------- Draw loop ---------- */
function tick(){
  requestAnimationFrame(tick);
  drawImageReactive(); drawWaveform(); drawSpectrum(); drawSequencer();
}
tick();

/* ---------- Mode/key/scale boot ---------- */
refreshTheory();

/* ---------- Waveform/Image/Analyser handlers (from previous version) ---------- */
let startedOnce=false;
function applyParams(){
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
