// src/seq/state.js
// Centralized app state: step sizes, row MIDI arrays, patterns, velocities,
// and safe helpers to (re)build grids from theory rows (synth5 parity).

export const STEPS_LEAD = 16;
export const STEPS_BASS = 32;
export const STEPS_DRUM = 16;

export const state = {
  // pitch rows (MIDI numbers)
  ROWS_LEAD_MIDI: [],
  ROWS_BASS_MIDI: [],

  // patterns (rows x cols) and velocities (per row)
  patLead: [],
  patBass: [],
  patDrum: Array.from({length:4}, ()=> Array(STEPS_DRUM).fill(false)),

  velLead: [],
  velBass: [],
  velDrum: [0.85, 0.85, 0.85, 0.85],

  // global pitch offset in semitones (Z/X keys etc.)
  octaveOffset: 0,
};

// -------- utilities --------
function emptyGrid(rows, cols){
  return Array.from({ length: rows }, () => Array(cols).fill(false));
}
function sizedArray(n, val=0.85){
  return Array.from({ length: n }, () => val);
}

// When theory changes, update rows and *reshape* patterns/velocities.
// Mirrors synth5 resetPitchGrids(): lead and bass get two octaves; bass lowered -24.
export function setGridsFromTheory({ rowsLead, rowsBass } = {}){
  const RL = Array.isArray(rowsLead) ? rowsLead.slice() : [];
  const RB = Array.isArray(rowsBass) ? rowsBass.slice() : [];

  // Fallbacks if theory returned nothing.
  const defaultLeadRows = RL.length || 14; // reasonable non-zero default
  const defaultBassRows = RB.length || 14;

  state.ROWS_LEAD_MIDI = RL.length ? RL : fallbackChromatic(defaultLeadRows, 72); // ~C6 down
  // lower bass by 24 semitones to sit two octaves under lead-ish, matching synth5
  const rawBass = RB.length ? RB : fallbackChromatic(defaultBassRows, 48);        // ~C4 down
  state.ROWS_BASS_MIDI = rawBass.map(m => m - 24);

  // (Re)shape patterns to match row counts exactly
  const leadRows = state.ROWS_LEAD_MIDI.length;
  const bassRows = state.ROWS_BASS_MIDI.length;

  state.patLead = emptyGrid(leadRows, STEPS_LEAD);
  state.patBass = emptyGrid(bassRows, STEPS_BASS);
  // patDrum remains 4 x STEPS_DRUM

  state.velLead = sizedArray(leadRows, 0.85);
  state.velBass = sizedArray(bassRows, 0.85);
}

// Simple chromatic fallback builder (descending), used if theory rows are empty
function fallbackChromatic(count, topMidi){
  const n = Math.max(1, count | 0);
  const arr = new Array(n);
  for (let i=0; i<n; i++) arr[i] = topMidi - i;
  return arr;
}

// Optional convenience if you want an explicit reset like synth5
export function resetPitchGrids(){
  // no-op here; caller should call setGridsFromTheory(buildTheoryRows()) from theory.js
  // included for compatibility with earlier code that might call it.
}

// -------- serialization (for storage / pattern slots) --------
export function serializeFullState(){
  return {
    octaveOffset: state.octaveOffset,

    rowsLead: state.ROWS_LEAD_MIDI.slice(),
    rowsBass: state.ROWS_BASS_MIDI.slice(),

    patLead: state.patLead.map(r => r.slice()),
    patBass: state.patBass.map(r => r.slice()),
    patDrum: state.patDrum.map(r => r.slice()),

    velLead: state.velLead.slice(),
    velBass: state.velBass.slice(),
    velDrum: state.velDrum.slice(),
  };
}

export function applyFullState(s){
  if (!s || typeof s !== 'object') return;

  state.octaveOffset = s.octaveOffset | 0;

  // rows
  if (Array.isArray(s.rowsLead) && s.rowsLead.length) state.ROWS_LEAD_MIDI = s.rowsLead.slice();
  if (Array.isArray(s.rowsBass) && s.rowsBass.length) state.ROWS_BASS_MIDI = s.rowsBass.slice();

  // patterns (shape-checked; if mismatch, rebuild blanks with current steps)
  if (Array.isArray(s.patLead) && s.patLead.length){
    state.patLead = s.patLead.map(row => ensureCols(row, STEPS_LEAD));
  } else {
    state.patLead = emptyGrid(state.ROWS_LEAD_MIDI.length, STEPS_LEAD);
  }

  if (Array.isArray(s.patBass) && s.patBass.length){
    state.patBass = s.patBass.map(row => ensureCols(row, STEPS_BASS));
  } else {
    state.patBass = emptyGrid(state.ROWS_BASS_MIDI.length, STEPS_BASS);
  }

  if (Array.isArray(s.patDrum) && s.patDrum.length === 4){
    state.patDrum = s.patDrum.map(row => ensureCols(row, STEPS_DRUM));
  } else {
    state.patDrum = Array.from({length:4}, ()=> Array(STEPS_DRUM).fill(false));
  }

  // velocities
  state.velLead = Array.isArray(s.velLead) && s.velLead.length === state.patLead.length
    ? s.velLead.slice()
    : sizedArray(state.patLead.length, 0.85);

  state.velBass = Array.isArray(s.velBass) && s.velBass.length === state.patBass.length
    ? s.velBass.slice()
    : sizedArray(state.patBass.length, 0.85);

  state.velDrum = Array.isArray(s.velDrum) && s.velDrum.length === 4
    ? s.velDrum.slice()
    : [0.85,0.85,0.85,0.85];
}

function ensureCols(row, cols){
  if (!Array.isArray(row)) return Array(cols).fill(false);
  if (row.length === cols) return row.slice();
  const out = Array(cols).fill(false);
  for (let i=0; i<Math.min(cols, row.length); i++) out[i] = !!row[i];
  return out;
}

// For code paths that want a fresh blank payload
export function newEmptyPatterns(){
  return {
    octaveOffset: 0,
    rowsLead: state.ROWS_LEAD_MIDI.slice(),
    rowsBass: state.ROWS_BASS_MIDI.slice(),
    patLead: emptyGrid(state.ROWS_LEAD_MIDI.length, STEPS_LEAD),
    patBass: emptyGrid(state.ROWS_BASS_MIDI.length, STEPS_BASS),
    patDrum: Array.from({length:4}, ()=> Array(STEPS_DRUM).fill(false)),
    velLead: sizedArray(state.ROWS_LEAD_MIDI.length, 0.85),
    velBass: sizedArray(state.ROWS_BASS_MIDI.length, 0.85),
    velDrum: [0.85,0.85,0.85,0.85],
  };
}
