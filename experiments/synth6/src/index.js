// index.js
import {
  initAudioGraph, setWave, setEnv, setFilter, setLFO, setDelay,
  setSectionGains, buses, getAnalyser, stopAllNotes, audio
} from './audio/engine.js';

import {
  startKeyboardListeners, setOctaveOffset, getOctaveOffset
} from './audio/voices.js';

import {
  initSequencer, startTransport, stopTransport, isPlaying,
  setBPMGetter, setSwingGetter, setQuantizeLaunchGetter,
  requestPatternLaunch, clearAllPatterns, exportMidi
} from './seq/scheduler.js';

import { buildTheoryRows, setTheoryConfig } from './seq/theory.js';
import {
  state, setGridsFromTheory, serializeFullState, applyFullState
} from './seq/state.js';

import { drawLoopInit } from './ui/canvases.js';
import { initSequencerCanvas } from './ui/sequencerCanvas.js';
import { initControls } from './ui/controls.js';
import { initRecorderUI } from './audio/recorder.js';
import {
  initStorage, loadPatternSlot, savePatternSlot,
  deletePatternSlot, duplicateSlotUI
} from './io/storage.js';
import { initMidiExport } from './io/midiExport.js';
import { applyThemeForOffset } from './ui/theme.js';

const $ = (id) => document.getElementById(id);

function isTextEntryTarget(ev){
  const el = ev?.target; if (!el) return false;
  const tag = (el.tagName||'').toLowerCase();
  if (tag === 'textarea' || el.isContentEditable) return true;
  if (tag === 'input'){
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text','email','number','password','search','tel','url'].includes(type);
  }
  return false;
}

// -------- Boot --------
function boot() {
  // 1) Theory defaults and pitch grids
  setTheoryConfig({ mode: 'scale', keyRoot: 'C', scaleType: 'naturalMinor' });
  setGridsFromTheory(buildTheoryRows());

  // 2) Audio + keyboard + analyzers
  initAudioGraph();
  startKeyboardListeners();
  drawLoopInit(getAnalyser());

  // 3) Sequencer loop
  initSequencer();

  // 4) Transport parameter getters
  const bpmInput   = $('bpm');
  const swingInput = $('swing');
  const quantizeLaunch = $('quantizeLaunch');

  setBPMGetter(() => {
    const v = +(bpmInput?.value ?? 120);
    return Math.max(40, Math.min(240, Number.isFinite(v) ? v : 120));
  });
  setSwingGetter(() => {
    const v = +(swingInput?.value ?? 0);
    return Math.max(0, Math.min(0.65, Number.isFinite(v) ? v/100 : 0));
  });
  setQuantizeLaunchGetter(() => !!quantizeLaunch?.checked);

  // 5) Controls (UI -> engine)
  initControls({
    onStart: async () => { await initAudioGraph(); },
    onStopNotes: () => stopAllNotes(),
    onPlay: () => isPlaying() ? stopTransport() : startTransport(),
    onClear: () => { clearAllPatterns(); },

    onWaveChange: (w) => setWave(w),
    onEnvChange:  (e) => setEnv(e),
    onFilterChange: (f) => setFilter(f),
    onLFOChange:    (l) => setLFO(l),
    onDelayChange:  (d) => setDelay(d),
    onVolumesChange:(v) => setSectionGains(v),

    onMuteSolo: (which, action) => {
      const bus = buses()[which];
      if (!bus) return;
      if (action === 'mute')    bus.mute();
      if (action === 'unmute')  bus.unmute();
      if (action === 'solo')    bus.solo();
      if (action === 'unsolo')  bus.unsolo();
    },

    onModeKeyScaleChange: (cfg) => {
      setTheoryConfig(cfg);
      setGridsFromTheory(buildTheoryRows());
    },

    // Octave via UI
    onOctaveChange: (offset) => {
      setOctaveOffset(offset);
      state.octaveOffset = offset;
    },
    getOctaveOffset,
  });

  // 6) Sequencer canvas
  initSequencerCanvas();

  // 7) Recording UI
  initRecorderUI();

  // 8) Pattern bank & storage
  initStorage({
    onLoadSlot:   (i) => applyFullState(loadPatternSlot(i)),
    onSaveSlot:   (i) => savePatternSlot(i, serializeFullState()),
    onDeleteSlot: (i) => deletePatternSlot(i),
    onDuplicate:  (from,to) => duplicateSlotUI(from,to),
  });

  // 9) Quantized pattern launch
  const patternGrid = $('patternGrid');
  if (patternGrid){
    patternGrid.addEventListener('click', (e) => {
      const slot = +(e.target?.dataset?.slot ?? NaN);
      if (!Number.isFinite(slot)) return;
      requestPatternLaunch(() => applyFullState(loadPatternSlot(slot)));
    });
  }

  // 10) MIDI export
  initMidiExport(() => exportMidi());

  // 11) Buttons
  $('startBtn')    ?.addEventListener('click', () => initAudioGraph());
  $('stopAllBtn')  ?.addEventListener('click', () => stopAllNotes());
  $('transportBtn')?.addEventListener('click', () => isPlaying() ? stopTransport() : startTransport());
  $('clearSeq')    ?.addEventListener('click', () => clearAllPatterns());

  // 12) Spacebar transport toggle (works even when sliders focused)
  window.addEventListener('keydown', async (e)=>{
    if (e.code !== 'Space') return;
    if (!isTextEntryTarget(e)) e.preventDefault();
    try { await audio().ctx?.resume?.(); } catch {}
    isPlaying() ? stopTransport() : startTransport();
  });

  // 13) Keep audio alive after UI interactions
  ['pointerdown','touchstart','keydown'].forEach(ev=>{
    window.addEventListener(ev, () => { try { audio().ctx?.resume?.(); } catch {} }, { passive:true });
  });

  // 14) Octave broadcast → theme + readout + sequencer offset
  window.addEventListener('octave-change', (e) => {
    const off = (e.detail?.semitones | 0) || 0;
    state.octaveOffset = off;
    applyThemeForOffset(off);
    const disp = $('octaveDisp') || $('octaveDisplay');
    if (disp) disp.textContent = String((off / 12) | 0);
  });

  // Initial theme & readout
  applyThemeForOffset(0);
  const disp = $('octaveDisp') || $('octaveDisplay');
  if (disp) disp.textContent = '0';
}

boot();
