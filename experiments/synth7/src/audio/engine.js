// src/audio/engine.js
// One-time AudioContext + full mix graph with section buses (lead/bass/drum),
// filter + LFO, delay send, master, and analyser. Designed to match synth5.

let _ctx = null;
let _started = false;

// Core nodes
let analyser, masterGain, mixBusGain, dryGain, delayNode, fbGain, delayMixGain;
let filter, lfoOsc, lfoGain;

// Section buses (each is a wrapper: { input: GainNode, mute(), unmute(), solo(), unsolo(), setVolume() })
let _busLead, _busBass, _busDrum;
let _soloCount = 0;

// User-tweakable params (read by voices.js; updated live by setters)
const _params = {
  wave: 'square',
  env:    { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.4 },
  filter: { type: 'lowpass', cutoff: 1200, q: 0.7 },
  lfo:    { rate: 4, depth: 500 },
  delay:  { time: 0.25, feedback: 0.35, mix: 0.3 },
  volume: { lead: 0.9, bass: 0.9, drum: 0.9 },
};

// ===== helpers =====
function ctx(){ return _ctx; }
function now(){ return _ctx?.currentTime || 0; }

function makeBus(initialVol = 0.9) {
  // We separate "volume" and "gate" so mute/solo logic doesn’t clobber the user volume.
  const vol = _ctx.createGain(); vol.gain.value = initialVol;
  const gate = _ctx.createGain(); gate.gain.value = 1.0;
  vol.connect(gate);

  const bus = {
    input: vol,
    _volNode: vol,
    _gateNode: gate,
    _muted: false,
    _soloed: false,
    _baseVol: initialVol,
    setVolume(v){
      this._baseVol = Math.max(0, Math.min(1, +v || 0));
      this._volNode.gain.setTargetAtTime(this._baseVol, now(), 0.01);
      updateBusGates();
    },
    mute(){ this._muted = true; updateBusGates(); },
    unmute(){ this._muted = false; updateBusGates(); },
    solo(){ if (!this._soloed){ this._soloed = true; _soloCount++; updateBusGates(); } },
    unsolo(){ if (this._soloed){ this._soloed = false; _soloCount = Math.max(0, _soloCount-1); updateBusGates(); } },
  };
  return bus;
}

function updateBusGates(){
  const soloActive = _soloCount > 0;
  const busesArr = [_busLead, _busBass, _busDrum];
  for (const b of busesArr){
    if (!b) continue;
    const shouldPlay = soloActive ? b._soloed : !b._muted;
    const target = shouldPlay ? 1 : 0;
    b._gateNode.gain.setTargetAtTime(target, now(), 0.01);
  }
}

// ===== public surface =====
export function audio(){ return { ctx: _ctx, params: _params }; }

export async function initAudioGraph(){
  if (_started && _ctx) return;
  _ctx = _ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended'){ try { await _ctx.resume(); } catch {} }

  // --- section buses ---
  _busLead = makeBus(_params.volume.lead);
  _busBass = makeBus(_params.volume.bass);
  _busDrum = makeBus(_params.volume.drum);

  // all sections flow into a single mix bus
  mixBusGain = _ctx.createGain(); mixBusGain.gain.value = 1;
  _busLead._gateNode.connect(mixBusGain);
  _busBass._gateNode.connect(mixBusGain);
  _busDrum._gateNode.connect(mixBusGain);

  // --- tone shaper: filter (modulated by LFO) ---
  filter = _ctx.createBiquadFilter();
  filter.type = _params.filter.type;
  filter.frequency.value = _params.filter.cutoff;
  filter.Q.value = _params.filter.q;

  // LFO that modulates filter cutoff
  lfoOsc = _ctx.createOscillator();
  lfoGain = _ctx.createGain();
  lfoOsc.frequency.value = _params.lfo.rate;
  lfoGain.gain.value = _params.lfo.depth;         // amount of modulation
  lfoOsc.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  // --- delay send/return ---
  delayNode = _ctx.createDelay(1.5);
  fbGain = _ctx.createGain();
  delayMixGain = _ctx.createGain();
  delayNode.delayTime.value = _params.delay.time;
  fbGain.gain.value = _params.delay.feedback;
  delayMixGain.gain.value = _params.delay.mix;

  // feedback loop
  delayNode.connect(fbGain);
  fbGain.connect(delayNode);

  // --- dry path and summing ---
  dryGain = _ctx.createGain(); dryGain.gain.value = 1.0;

  // route: sections → mix → filter → (split: dry + delay) → sum → master → analyser → destination
  mixBusGain.connect(filter);
  filter.connect(dryGain);
  filter.connect(delayNode);
  delayNode.connect(delayMixGain);

  const sum = _ctx.createGain();
  dryGain.connect(sum);
  delayMixGain.connect(sum);

  masterGain = _ctx.createGain(); masterGain.gain.value = 0.85;
  sum.connect(masterGain);

  analyser = _ctx.createAnalyser();
  analyser.fftSize = 2048;
  masterGain.connect(analyser);
  analyser.connect(_ctx.destination);

  // Start LFO
  try { lfoOsc.start(); } catch {}

  _started = true;
  updateBusGates();
}

export function getAnalyser(){ return analyser; }

export function buses(){
  return {
    lead: _busLead,
    bass: _busBass,
    drum: _busDrum,
  };
}

// ---- Parameter setters (live updates) ----
export function setWave(wave){
  _params.wave = String(wave || 'square');
}
export function setEnv(env){
  _params.env = {
    attack:  Math.max(0, +env.attack  || 0.02),
    decay:   Math.max(0, +env.decay   || 0.15),
    sustain: Math.max(0, +env.sustain || 0.6),
    release: Math.max(0, +env.release || 0.4),
  };
}
export function setFilter(f){
  _params.filter.type   = f.type || _params.filter.type;
  _params.filter.cutoff = Math.max(20, +f.cutoff || _params.filter.cutoff);
  _params.filter.q      = Math.max(0.0001, +f.q || _params.filter.q);
  if (filter){
    filter.type = _params.filter.type;
    filter.frequency.setTargetAtTime(_params.filter.cutoff, now(), 0.01);
    filter.Q.setTargetAtTime(_params.filter.q, now(), 0.01);
  }
}
export function setLFO(l){
  _params.lfo.rate  = Math.max(0, +l.rate || _params.lfo.rate);
  _params.lfo.depth = Math.max(0, +l.depth || _params.lfo.depth);
  if (lfoOsc)  lfoOsc.frequency.setTargetAtTime(_params.lfo.rate, now(), 0.02);
  if (lfoGain) lfoGain.gain.setTargetAtTime(_params.lfo.depth, now(), 0.02);
}
export function setDelay(d){
  _params.delay.time     = Math.max(0, Math.min(1.5, +d.time || _params.delay.time));
  _params.delay.feedback = Math.max(0, Math.min(0.98, +d.feedback || _params.delay.feedback));
  _params.delay.mix      = Math.max(0, Math.min(1.0, +d.mix || _params.delay.mix));
  if (delayNode)   delayNode.delayTime.setTargetAtTime(_params.delay.time, now(), 0.02);
  if (fbGain)      fbGain.gain.setTargetAtTime(_params.delay.feedback, now(), 0.02);
  if (delayMixGain)delayMixGain.gain.setTargetAtTime(_params.delay.mix, now(), 0.02);
}
export function setSectionGains(v){
  if (!_started) return;
  if (v.lead != null) { _params.volume.lead = +v.lead; _busLead?.setVolume(_params.volume.lead); }
  if (v.bass != null) { _params.volume.bass = +v.bass; _busBass?.setVolume(_params.volume.bass); }
  if (v.drum != null) { _params.volume.drum = +v.drum; _busDrum?.setVolume(_params.volume.drum); }
}

// Quick global “panic” that ducks master briefly (since voices are one-shots)
export function stopAllNotes(){
  if (!_ctx || !masterGain) return;
  const t = now();
  try {
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setTargetAtTime(0.0001, t, 0.01);
    masterGain.gain.setTargetAtTime(0.85, t + 0.06, 0.05);
  } catch {}
}
