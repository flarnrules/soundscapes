// src/seq/theory.js
// Builds theory rows exactly like your synth5 buildRowMIDI(), with chromatic/scale modes.

export const SCALES = {
  major:            [0,2,4,5,7,9,11],
  naturalMinor:     [0,2,3,5,7,8,10],
  harmonicMinor:    [0,2,3,5,7,8,11],
  dorian:           [0,2,3,5,7,9,10],
  pentatonicMajor:  [0,2,4,7,9],
  pentatonicMinor:  [0,3,5,7,10],
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }

function nameToSemitone(n){ return NOTE_NAMES.indexOf(n); }

let _theory = { mode:'scale', keyRoot:'C', scaleType:'naturalMinor' };
export function setTheoryConfig(cfg={}){ _theory = { ..._theory, ...cfg }; }
export function getTheoryConfig(){ return { ..._theory }; }

/**
 * Returns { rowsLead:number[], rowsBass:number[] }
 * - Scale mode: two octaves of degrees, high→low (UI friendly)
 * - Chromatic mode: 24 chromatic steps, high→low
 * Bass rows are NOT lowered here; we keep parity with synth5 and do -24 in state.js
 */
export function buildTheoryRows(){
  const baseOctLead = 5; // center around ~C5
  const baseOctBass = 3; // center around ~C3

  if (_theory.mode === 'chromatic'){
    const topLead = 12*(baseOctLead+1); // C6
    const topBass = 12*(baseOctBass+1); // C4
    const rowsLead = Array.from({length:24}, (_,i)=> topLead - i);
    const rowsBass = Array.from({length:24}, (_,i)=> topBass - i);
    return { rowsLead, rowsBass };
  }

  const rootSemi = nameToSemitone(_theory.keyRoot);
  const degrees = SCALES[_theory.scaleType] || SCALES.naturalMinor;
  const octaves = 2;

  const rowsLead = [];
  const rowsBass = [];
  for (let o = octaves-1; o >= 0; o--){
    for (let d = degrees.length-1; d >= 0; d--){
      const semi = rootSemi + degrees[d] + o*12;
      rowsLead.push(12*(baseOctLead-1) + semi);
      rowsBass.push(12*(baseOctBass-1) + semi);
    }
  }
  return { rowsLead, rowsBass };
}

/**
 * Given section rows (as MIDI) and a row index, build diatonic chord offsets
 * for 1–3–5–(7) using adjacent rows (rows are ordered high→low).
 * Returns semitone offsets relative to the root row.
 */
export function diatonicOffsetsFromRows(rowsMidi, rowIndex, add7th){
  if (!Array.isArray(rowsMidi) || rowsMidi.length === 0) return [0];
  const idxs = [rowIndex, rowIndex - 2, rowIndex - 4];
  if (add7th) idxs.push(rowIndex - 6);
  const root = rowsMidi[rowIndex] ?? rowsMidi[0];
  const out = [];
  for (const i of idxs){
    if (i >= 0 && i < rowsMidi.length) out.push(rowsMidi[i] - root);
  }
  if (!out.includes(0)) out.push(0);
  return [...new Set(out)].sort((a,b)=>a-b);
}
