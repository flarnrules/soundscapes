// src/seq/scheduler.js
import { midiToFreq } from './theory.js';
import { state, STEPS_LEAD, STEPS_BASS, STEPS_DRUM } from './state.js';
import { startVoice, kick, snare, hat } from '../audio/voices.js';
import { audio, buses } from '../audio/engine.js';
import { encodeMIDI } from '../io/midiExport.js';

// ---------------- Transport ----------------
let _isPlaying = false;
let nextNoteTime = 0;
let tick32 = 0;

const scheduleAheadTime = 0.1;  // s
const lookaheadMs = 25;         // ms

// ---------------- UI getters ----------------
let bpmGetter = () => 120;
let swingGetter = () => 0;              // 0..0.65
let quantizeLaunchGetter = () => true;

export function setBPMGetter(fn){ bpmGetter = fn || (()=>120); }
export function setSwingGetter(fn){ swingGetter = fn || (()=>0); }
export function setQuantizeLaunchGetter(fn){ quantizeLaunchGetter = fn || (()=>true); }

// ---------------- Loop bootstrap ----------------
let schedulerTimer = null;
export function initSequencer(){
  if (!schedulerTimer) schedulerTimer = setInterval(schedulerTick, lookaheadMs);
}
export function isPlaying(){ return _isPlaying; }

export function startTransport(){
  const ctx = audio().ctx;
  try { ctx?.resume?.(); } catch {}
  _isPlaying = true;
  tick32 = 0;
  nextNoteTime = (ctx?.currentTime || 0) + 0.05;
  window.dispatchEvent(new CustomEvent('transport', { detail: { playing: true }}));
}
export function stopTransport(){
  _isPlaying = false;
  window.dispatchEvent(new CustomEvent('transport', { detail: { playing: false }}));
}

// ---------------- Quantized pattern launch ----------------
let pendingLaunch = null;
export function requestPatternLaunch(applyFn){
  if (!quantizeLaunchGetter()){ applyFn?.(); return; }
  pendingLaunch = applyFn; // apply on next bar boundary
}

// ---------------- Timing helpers ----------------
function secondsPer32nd(){
  const bpm = Math.max(40, Math.min(240, +bpmGetter() || 120));
  const sp32 = 60.0 / bpm / 8.0;
  const swing = Math.max(0, Math.min(0.65, +swingGetter() || 0));
  return { sp32, swing, bpm };
}

export function getPlayhead(){
  if (!_isPlaying) return { leadStep:-1, bassStep:-1, drumStep:-1 };
  return {
    leadStep: Math.floor((tick32 / 2) % STEPS_LEAD),
    bassStep: Math.floor(tick32 % STEPS_BASS),
    drumStep: Math.floor((tick32 / 2) % STEPS_DRUM),
  };
}

// ---------------- Safe access ----------------
function rowHasStep(gridRow, step){
  if (!Array.isArray(gridRow) || gridRow.length === 0) return false;
  const col = step % gridRow.length;
  return !!gridRow[col];
}
function finiteFreqFromMidi(m){
  if (!Number.isFinite(m)) return null;
  const f = midiToFreq(m);
  return Number.isFinite(f) && f > 0 ? f : null;
}

// ---------------- Core scheduler (polyphonic, gated) ----------------
function schedulerTick(){
  if (!_isPlaying) return;
  const ctx = audio().ctx;
  if (!ctx) return;

  const { sp32, swing, bpm } = secondsPer32nd();
  const gate16 = (60 / bpm / 4) * 0.90; // ~90% 16th
  const gate32 = (60 / bpm / 8) * 0.90; // ~90% 32nd

  while (nextNoteTime < ctx.currentTime + scheduleAheadTime){
    const t = nextNoteTime;

    // apply queued pattern swap at bar line
    if (tick32 === 0 && pendingLaunch){
      try { pendingLaunch(); } finally { pendingLaunch = null; }
    }

    // ---- Lead (16ths) ----
    if (tick32 % 2 === 0){
      const stepL = (tick32 / 2) % STEPS_LEAD;
      const rowsLead = state.ROWS_LEAD_MIDI || [];
      for (let r = 0; r < rowsLead.length; r++){
        if (!rowHasStep(state.patLead?.[r], stepL)) continue;
        const midi = rowsLead[r] + (state.octaveOffset || 0);
        const freq = finiteFreqFromMidi(midi);
        if (freq == null) continue;
        const vel = state.velLead?.[r] ?? 0.85;
        // startVoice schedules its own release + absolute stop → no infinite holds
        startVoice(freq, t, vel, buses().lead, gate16);
      }

      // ---- Drums (16ths) ----
      const stepD = stepL % STEPS_DRUM;
      if (rowHasStep(state.patDrum?.[0], stepD)) kick(t,   state.velDrum?.[0] ?? 0.85);
      if (rowHasStep(state.patDrum?.[1], stepD)) snare(t,  state.velDrum?.[1] ?? 0.85);
      if (rowHasStep(state.patDrum?.[2], stepD)) hat(t,false, state.velDrum?.[2] ?? 0.85);
      if (rowHasStep(state.patDrum?.[3], stepD)) hat(t,true,  state.velDrum?.[3] ?? 0.85);
    }

    // ---- Bass (32nds) ----
    const stepB = tick32 % STEPS_BASS;
    const rowsBass = state.ROWS_BASS_MIDI || [];
    for (let r = 0; r < rowsBass.length; r++){
      if (!rowHasStep(state.patBass?.[r], stepB)) continue;
      const midi = rowsBass[r] + (state.octaveOffset || 0);
      const freq = finiteFreqFromMidi(midi);
      if (freq == null) continue;
      const vel = state.velBass?.[r] ?? 0.85;
      startVoice(freq, t, vel, buses().bass, gate32);
    }

    // ---- advance with swing ----
    const isOdd32 = (tick32 % 2) === 1;
    const stepDur = sp32 * (isOdd32 ? (1 + swing) : (1 - swing));
    nextNoteTime += (Number.isFinite(stepDur) && stepDur > 0) ? stepDur : (60/120/8);
    tick32 = (tick32 + 1) % STEPS_BASS;
  }
}

// ---------------- Utilities ----------------
export function clearAllPatterns(){
  if (Array.isArray(state.patLead)) state.patLead.forEach(row => row.fill(false));
  if (Array.isArray(state.patBass)) state.patBass.forEach(row => row.fill(false));
  if (Array.isArray(state.patDrum)) state.patDrum.forEach(row => row.fill(false));
}

export function exportMidi(){
  const bytes = encodeMIDI({
    bpm: Math.max(40, Math.min(240, +bpmGetter() || 120)),
    octaveOffset: state.octaveOffset || 0,
    lead:  { pattern: state.patLead, rowsMidi: state.ROWS_LEAD_MIDI, velocities: state.velLead, steps: STEPS_LEAD },
    bass:  { pattern: state.patBass, rowsMidi: state.ROWS_BASS_MIDI, velocities: state.velBass, steps: STEPS_BASS },
    drums: { pattern: state.patDrum, velocities: state.velDrum, steps: STEPS_DRUM },
  });
  return bytes;
}
