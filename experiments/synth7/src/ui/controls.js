// src/ui/controls.js
//
// Wires UI -> engine via callbacks provided by index.js.
// Supports both synth5 IDs and modular IDs. Missing elements are ignored.

function $(id){ return document.getElementById(id); }
function on(el, ev, fn){ if (el) el.addEventListener(ev, fn, { passive: true }); }
function num(v, d=0){ const n = +v; return Number.isFinite(n) ? n : d; }

function pickId(...ids){ for (const id of ids){ const el=$(id); if (el) return id; } return null; }
function pickRadioName(...names){
  for (const name of names){
    const nodes = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
    if (nodes.length) return name;
  }
  return null;
}

// Bind a range/number input; also update paired readout if present.
function bindValueInput(id, handler, { readoutId } = {}){
  const el = $(id);
  const out = readoutId ? $(readoutId) : $(id + 'Val');
  if (!el) return;
  const emit = () => {
    const value = el.type === 'checkbox' ? !!el.checked : num(el.value);
    if (out) out.textContent = (typeof value === 'number') ? String(value) : (value ? 'On' : 'Off');
    handler?.(value);
  };
  on(el, 'input', emit);
  on(el, 'change', emit);
  requestAnimationFrame(emit);
}

// Bind a select
function bindSelect(id, handler){
  const el = $(id);
  if (!el) return;
  const emit = () => handler?.(el.value);
  on(el, 'change', emit);
  requestAnimationFrame(emit);
}

// Bind a radio group
function bindRadioGroup(name, handler){
  const nodes = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  if (!nodes.length) return;
  const emit = () => {
    const checked = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
    if (checked) handler?.(checked.value);
  };
  nodes.forEach(n => on(n, 'change', emit));
  requestAnimationFrame(emit);
}

// Mixer mute/solo click delegation (optional; safe if #mixer absent)
function bindMixerDelegation(containerId, onMuteSolo){
  const root = $(containerId);
  if (!root || !onMuteSolo) return;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action][data-section]');
    if (!btn) return;
    onMuteSolo(btn.dataset.section, btn.dataset.action);
  });
}

function setOctaveReadout(getOctaveOffset){
  const out = $('octaveDisp') || $('octaveDisplay');
  if (!out || !getOctaveOffset) return;
  out.textContent = String(getOctaveOffset());
}

export function initControls({
  onStart,
  onStopNotes,
  onPlay,
  onClear,

  onWaveChange,
  onEnvChange,
  onFilterChange,
  onLFOChange,
  onDelayChange,

  onVolumesChange,
  onMuteSolo,

  onModeKeyScaleChange,
  onOctaveChange,
  getOctaveOffset
} = {}){

  // --- Transport & global ---
  on($('startBtn'), 'click', () => onStart?.());
  on($('stopAllBtn'), 'click', () => onStopNotes?.());
  on($('transportBtn'), 'click', () => onPlay?.());
  on($('clearSeq'), 'click', () => onClear?.());

  // --- Waveform radios ---
  const waveName = pickRadioName('waveType','wave');
  if (waveName) bindRadioGroup(waveName, (val) => onWaveChange?.(val));

  // --- Envelope (ADSR) — support both id sets ---
  const envIds = {
    A: pickId('envA','attack'),
    D: pickId('envD','decay'),
    S: pickId('envS','sustain'),
    R: pickId('envR','release'),
  };
  function collectEnv(){
    return {
      attack:  num($(envIds.A)?.value, 0.02),
      decay:   num($(envIds.D)?.value, 0.15),
      sustain: num($(envIds.S)?.value, 0.6),
      release: num($(envIds.R)?.value, 0.4),
    };
  }
  ['A','D','S','R'].forEach(k => {
    if (envIds[k]) bindValueInput(envIds[k], () => onEnvChange?.(collectEnv()));
  });
  // Initial emit if at least one control exists
  if (envIds.A || envIds.D || envIds.S || envIds.R) requestAnimationFrame(() => onEnvChange?.(collectEnv()));

  // --- Filter (cutoff/Q/type) — support both id sets ---
  const filterIds = {
    cutoff: pickId('filterCutoff','cutoff'),
    q:      pickId('filterQ','q'),
    type:   pickId('filterType'),
  };
  function collectFilter(){
    const typeEl = $(filterIds.type);
    return {
      type:   typeEl ? typeEl.value : 'lowpass',
      cutoff: num($(filterIds.cutoff)?.value, 1200),
      q:      num($(filterIds.q)?.value, 0.7),
    };
  }
  if (filterIds.type) bindSelect(filterIds.type, () => onFilterChange?.(collectFilter()));
  if (filterIds.cutoff) bindValueInput(filterIds.cutoff, () => onFilterChange?.(collectFilter()));
  if (filterIds.q)      bindValueInput(filterIds.q,      () => onFilterChange?.(collectFilter()));
  if (filterIds.type || filterIds.cutoff || filterIds.q) requestAnimationFrame(() => onFilterChange?.(collectFilter()));

  // --- LFO ---
  bindValueInput('lfoRate',  () => onLFOChange?.({ rate:  num($('lfoRate')?.value, 4), depth: num($('lfoDepth')?.value, 500) }));
  bindValueInput('lfoDepth', () => onLFOChange?.({ rate:  num($('lfoRate')?.value, 4), depth: num($('lfoDepth')?.value, 500) }));

  // --- Delay ---
  bindValueInput('delayTime',     () => onDelayChange?.(collectDelay()));
  bindValueInput('delayFeedback', () => onDelayChange?.(collectDelay()));
  bindValueInput('delayMix',      () => onDelayChange?.(collectDelay()));
  function collectDelay(){
    return {
      time:     num($('delayTime')?.value, 0.25),
      feedback: num($('delayFeedback')?.value, 0.35),
      mix:      num($('delayMix')?.value, 0.3),
    };
  }

  // --- Volumes — support both id sets ---
  const volIds = {
    lead: pickId('volLead','leadVol'),
    bass: pickId('volBass','bassVol'),
    drum: pickId('volDrum','drumVol'),
  };
  const emitVols = () => {
    const v = {
      lead: num($(volIds.lead)?.value, 0.9),
      bass: num($(volIds.bass)?.value, 0.9),
      drum: num($(volIds.drum)?.value, 0.9),
    };
    onVolumesChange?.(v);
  };
  Object.values(volIds).forEach(id => { if (id) bindValueInput(id, emitVols); });
  if (volIds.lead || volIds.bass || volIds.drum) requestAnimationFrame(emitVols);

  // --- Mixer mute/solo (optional) ---
  bindMixerDelegation('mixer', onMuteSolo);

  // --- Theory (mode/key/scale) — support both sets ---
  const theoryIds = {
    mode:  pickId('modeSelect','mode'),
    key:   pickId('keySelect','keyRoot'),
    scale: pickId('scaleSelect','scaleType'),
  };
  const emitTheory = () => {
    const cfg = {
      mode:     ($(theoryIds.mode)?.value)  || 'scale',
      keyRoot:  ($(theoryIds.key)?.value)   || 'C',
      scaleType:($(theoryIds.scale)?.value) || 'naturalMinor',
    };
    onModeKeyScaleChange?.(cfg);
  };
  Object.values(theoryIds).forEach(id => { if (id) on($(id), 'change', emitTheory); });
  if (theoryIds.mode || theoryIds.key || theoryIds.scale) requestAnimationFrame(emitTheory);

  // --- Octave controls + readout (supports octaveDisp & octaveDisplay) ---
  const applyOctave = (delta) => {
    if (!onOctaveChange) return;
    const current = getOctaveOffset?.() ?? 0;
    const next = current + delta;
    onOctaveChange(next);
    setOctaveReadout(getOctaveOffset);
    document.documentElement.dataset.octave = String(next); // optional theming hook
  };
  on($('octaveDown'), 'click', () => applyOctave(-12));
  on($('octaveUp'),   'click', () => applyOctave(+12));
  setOctaveReadout(getOctaveOffset);

  // --- BPM/Swing readouts (logic pulled by index.js getters) ---
  bindValueInput('bpm',   () => {}, { readoutId: 'bpmVal' });
  bindValueInput('swing', () => {}, { readoutId: 'swingVal' });
}
