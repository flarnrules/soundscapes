// src/ui/sequencerCanvas.js
import { state, STEPS_LEAD, STEPS_BASS, STEPS_DRUM } from '../seq/state.js';
import { diatonicOffsetsFromRows } from '../seq/theory.js';
import { getPlayhead } from '../seq/scheduler.js';

const cSeq = document.getElementById('seq');
const g = cSeq.getContext('2d');
const GUTTER_W = 64;

function resize(){
  const w = cSeq.clientWidth, h = cSeq.clientHeight;
  if (cSeq.width !== w || cSeq.height !== h){ cSeq.width = w; cSeq.height = h; }
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.querySelector('.display') || document.body);

export function initSequencerCanvas(){
  resize();
  cSeq.addEventListener('pointerdown', onDown);
  cSeq.addEventListener('pointermove', onMove);
  cSeq.addEventListener('pointerup', ()=> draggingKnob=null);
  cSeq.addEventListener('pointerleave', ()=> draggingKnob=null);
  requestAnimationFrame(loop);
}

let draggingKnob = null;

function onDown(e){
  const pos = hit(e);
  if (!pos) return;

  if (pos.kind === 'knob'){
    draggingKnob = { section: pos.section, rowIndex: pos.row };
    setVelFromLocal(pos.section, pos.row, pos.localY, pos.rowH);
    return;
  }

  if (pos.kind === 'cell'){
    if (pos.section === 'drum'){
      state.patDrum[pos.row][pos.col] = !state.patDrum[pos.row][pos.col];
      return;
    }

    // ----- Lead / Bass with chord shortcuts -----
    const addTriad = e.shiftKey;
    const add7th   = e.ctrlKey || e.metaKey;

    const isLead = (pos.section === 'lead');
    const P       = isLead ? state.patLead : state.patBass;
    const rowsMidi= isLead ? state.ROWS_LEAD_MIDI : state.ROWS_BASS_MIDI;

    if (!addTriad && !add7th){
      P[pos.row][pos.col] = !P[pos.row][pos.col];
      return;
    }

    // Build diatonic chord offsets (root, 3rd, 5th, (+7th if requested))
    const offsets = diatonicOffsetsFromRows(rowsMidi, pos.row, add7th);

    // For each offset in semitones, find the closest row and place the note
    const rootMidi = rowsMidi[pos.row];
    for (const semi of offsets){
      const target = rootMidi + semi;
      let best = -1, bestDiff = 1e9;
      for (let r=0; r<rowsMidi.length; r++){
        const diff = Math.abs(rowsMidi[r] - target);
        if (diff < bestDiff){ bestDiff = diff; best = r; }
      }
      if (best >= 0) P[best][pos.col] = true;
    }
  }
}

function onMove(e){
  if (!draggingKnob) return;
  const pos = hit(e);
  if (!pos || pos.kind !== 'knob' ||
      pos.section !== draggingKnob.section || pos.row !== draggingKnob.rowIndex) return;
  setVelFromLocal(pos.section, pos.row, pos.localY, pos.rowH);
}

function setVelFromLocal(section, row, localY, rowH){
  const t = 1 - Math.min(1, Math.max(0, localY / rowH)); // top=1, bottom=0
  const v = 0.1 + 0.9*t;
  if (section==='lead') state.velLead[row] = v;
  else if (section==='bass') state.velBass[row] = v;
  else state.velDrum[row] = v;
}

function hit(e){
  const r = cSeq.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const w = cSeq.width, h = cSeq.height;

  const totalRows = state.ROWS_LEAD_MIDI.length + state.ROWS_BASS_MIDI.length + 4;
  const leadH = Math.floor(h * (state.ROWS_LEAD_MIDI.length / totalRows));
  const bassH = Math.floor(h * (state.ROWS_BASS_MIDI.length / totalRows));
  const drumH = h - leadH - bassH;

  if (y < leadH) return rowColOrKnob('lead', x, y, w, leadH, state.ROWS_LEAD_MIDI.length, STEPS_LEAD);
  if (y < leadH + bassH) return rowColOrKnob('bass', x, y - leadH, w, bassH, state.ROWS_BASS_MIDI.length, STEPS_BASS);
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

function loop(){ requestAnimationFrame(loop); draw(); }

function draw(){
  resize();
  const w = cSeq.width, h = cSeq.height;
  const grid = css('--grid','#222'), accent=css('--accent','#8ab4ff'), accent2=css('--accent2','#9be58c'), bg=css('--canvas','#0e0e0e');

  g.clearRect(0,0,w,h);
  g.fillStyle = bg; g.fillRect(0,0,w,h);

  const totalRows = state.ROWS_LEAD_MIDI.length + state.ROWS_BASS_MIDI.length + 4;
  const leadH = Math.floor(h * (state.ROWS_LEAD_MIDI.length / totalRows));
  const bassH = Math.floor(h * (state.ROWS_BASS_MIDI.length / totalRows));
  const drumH = h - leadH - bassH;

  const ph = getPlayhead();

  drawBlock('lead', 0,           leadH, state.ROWS_LEAD_MIDI.length, STEPS_LEAD, state.patLead, state.velLead, accent2, state.ROWS_LEAD_MIDI, ph.leadStep);
  drawBlock('bass', leadH,       bassH, state.ROWS_BASS_MIDI.length, STEPS_BASS, state.patBass, state.velBass, accent,  state.ROWS_BASS_MIDI, ph.bassStep);
  drawBlock('drum', leadH+bassH, drumH, 4,                              STEPS_DRUM, state.patDrum, state.velDrum, '#ffcf77', [], ph.drumStep);

  function drawBlock(type, top, height, rows, cols, pattern, velocities, activeFill, rowMidi=[], playCol=-1){
    const rh = height/rows, cw = (w - GUTTER_W)/cols;

    // gutter
    g.fillStyle = '#151515'; g.fillRect(0, top, GUTTER_W, height);

    // knobs & labels
    g.fillStyle='rgba(255,255,255,0.7)'; g.font='12px system-ui'; g.textBaseline='middle';
    for (let r=0;r<rows;r++){
      const y0=top+r*rh, yc=y0+rh/2, xc=GUTTER_W/2, radius=Math.min(20,rh*0.35);
      g.fillStyle='#222'; g.beginPath(); g.arc(xc,yc,radius,0,Math.PI*2); g.fill();
      g.strokeStyle='#444'; g.lineWidth=2; g.stroke();
      g.strokeStyle=activeFill; g.lineWidth=3;
      const v=velocities[r], start=-Math.PI*0.75, end=start+v*Math.PI*1.5;
      g.beginPath(); g.arc(xc,yc,radius-2,start,end); g.stroke();
      g.fillStyle='rgba(255,255,255,0.8)';
      const label = type==='drum' ? ['Kick','Snare','Hat C','Hat O'][r]
                                  : midiLabel((rowMidi[r]||60) + (state.octaveOffset|0));
      g.fillText(label, 6, yc);
    }

    // active cells
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      if (pattern[r][c]){ const x=GUTTER_W+c*cw, y=top+r*rh; g.fillStyle=activeFill; g.fillRect(x+1,y+1,cw-2,rh-2); }
    }

    // playhead
    if (playCol>=0){ const x=GUTTER_W+playCol*cw; g.fillStyle='rgba(255,255,255,0.08)'; g.fillRect(x, top, cw, height); }

    // grid
    g.globalAlpha=.9; g.strokeStyle=grid; g.lineWidth=1; g.beginPath();
    for (let i=0;i<=cols;i++){ const x=GUTTER_W+i*cw; g.moveTo(x,top); g.lineTo(x,top+height); }
    for (let j=0;j<=rows;j++){ g.moveTo(GUTTER_W,top+j*rh); g.lineTo(w,top+j*rh); }
    g.stroke(); g.globalAlpha=1;

    // bar markers
    g.strokeStyle='rgba(255,255,255,0.15)'; g.lineWidth=2; g.beginPath();
    const step=(cols===32)?8:4; for(let i=0;i<=cols;i+=step){ const x=GUTTER_W+i*cw; g.moveTo(x,top); g.lineTo(x,top+height); } g.stroke();

    // title
    g.fillStyle='rgba(255,255,255,0.5)'; g.font='bold 12px system-ui'; g.fillText(type.toUpperCase(), GUTTER_W+8, top+12);
  }
}

function css(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function midiLabel(m){
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[((m%12)+12)%12] + (Math.floor(m/12)-1);
}
