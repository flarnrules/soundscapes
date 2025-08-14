// src/io/midiExport.js
// SMF Type-1 encoder + tiny UI binder for the Export button.

const PPQ_DEFAULT = 480;
const DRUM_CHANNEL = 9; // ch10
const GM_DRUM_NOTES = [36, 38, 42, 46]; // Kick, Snare, CHat, OHat

// --------- utils ----------
function vlq(n) {
  let buffer = n & 0x7F;
  const out = [];
  while ((n >>= 7)) { buffer <<= 8; buffer |= ((n & 0x7F) | 0x80); }
  while (true) { out.push(buffer & 0xFF); if (buffer & 0x80) buffer >>= 8; else break; }
  return out;
}
function strBytes(s){ return [...s].map(ch=>ch.charCodeAt(0)); }

function pushTempoTrack(tracks, bpm, ppq) {
  const t = [];
  const usPerQ = Math.max(1, Math.round(60000000 / (bpm || 120)));
  t.push(...vlq(0), 0xFF, 0x51, 0x03, (usPerQ>>16)&0xFF, (usPerQ>>8)&0xFF, usPerQ&0xFF);
  t.push(...vlq(0), 0xFF, 0x58, 0x04, 4, 2, 24, 8);
  t.push(...vlq(0), 0xFF, 0x2F, 0x00);
  tracks.push(t);
}

function buildTrackFromEvents(events) {
  events.sort((a, b) => (a.tick - b.tick) || (a.kindOrder - b.kindOrder));
  const out = [];
  let last = 0;
  for (const ev of events) {
    const dt = ev.tick - last; last = ev.tick;
    out.push(...vlq(dt), ...ev.bytes);
  }
  out.push(...vlq(0), 0xFF, 0x2F, 0x00);
  return out;
}

function makePolyGridEvents({ pattern, rowsMidi, steps, channel, velocities, stepTicks, gateRatio = 0.9, octaveOffset = 0 }) {
  const onKind = 1, offKind = 0, ev = [];
  for (let c=0;c<steps;c++){
    const start = c*stepTicks, end = start + Math.max(1, Math.floor(stepTicks*gateRatio));
    for (let r=0;r<rowsMidi.length;r++){
      if (!pattern[r]?.[c]) continue;
      const midi = Math.max(0, Math.min(127, (rowsMidi[r] + octaveOffset)|0));
      const vel = Math.max(1, Math.min(127, Math.round((velocities?.[r] ?? 0.85) * 127)));
      ev.push({ tick:start, kindOrder:onKind,  bytes:[0x90 | (channel & 0x0F), midi, vel] });
      ev.push({ tick:end,   kindOrder:offKind, bytes:[0x80 | (channel & 0x0F), midi, 0x40] });
    }
  }
  return ev;
}
function makeDrumGridEvents({ pattern, steps, velocities, stepTicks, gateRatio=0.95 }) {
  const onKind=1, offKind=0, ev=[];
  for (let c=0;c<steps;c++){
    const start = c*stepTicks, end = start + Math.max(1, Math.floor(stepTicks*gateRatio));
    for (let r=0;r<Math.min(pattern.length, GM_DRUM_NOTES.length); r++){
      if (!pattern[r]?.[c]) continue;
      const note = GM_DRUM_NOTES[r];
      const vel = Math.max(1, Math.min(127, Math.round((velocities?.[r] ?? 0.85) * 127)));
      ev.push({ tick:start, kindOrder:onKind,  bytes:[0x90 | DRUM_CHANNEL, note, vel] });
      ev.push({ tick:end,   kindOrder:offKind, bytes:[0x80 | DRUM_CHANNEL, note, 0x40] });
    }
  }
  return ev;
}

// --------- public encoder ----------
export function encodeMIDI(cfg = {}) {
  const bpm = Number.isFinite(cfg.bpm) ? cfg.bpm : 120;
  const ppq = Number.isFinite(cfg.ppq) ? cfg.ppq : PPQ_DEFAULT;
  const octaveOffset = Number.isFinite(cfg.octaveOffset) ? cfg.octaveOffset : 0;

  const lead = cfg.lead || {};
  const bass = cfg.bass || {};
  const drums = cfg.drums || {};

  const tracks = [];
  pushTempoTrack(tracks, bpm, ppq);

  // Lead @ 16ths (ch 1 -> 0)
  if (lead.pattern && lead.rowsMidi && Number.isFinite(lead.steps)) {
    const stepTicks = Math.max(1, Math.floor(ppq/4));
    const ev = makePolyGridEvents({
      pattern: lead.pattern, rowsMidi: lead.rowsMidi, steps: lead.steps,
      channel: 0, velocities: lead.velocities, stepTicks, gateRatio: 0.90, octaveOffset
    });
    tracks.push(buildTrackFromEvents(ev));
  } else tracks.push([ ...vlq(0), 0xFF, 0x2F, 0x00 ]);

  // Bass @ 32nds (ch 2 -> 1)
  if (bass.pattern && bass.rowsMidi && Number.isFinite(bass.steps)) {
    const stepTicks = Math.max(1, Math.floor(ppq/8));
    const ev = makePolyGridEvents({
      pattern: bass.pattern, rowsMidi: bass.rowsMidi, steps: bass.steps,
      channel: 1, velocities: bass.velocities, stepTicks, gateRatio: 0.85, octaveOffset
    });
    tracks.push(buildTrackFromEvents(ev));
  } else tracks.push([ ...vlq(0), 0xFF, 0x2F, 0x00 ]);

  // Drums @ 16ths (ch 10 -> 9)
  if (drums.pattern && Number.isFinite(drums.steps)) {
    const stepTicks = Math.max(1, Math.floor(ppq/4));
    const ev = makeDrumGridEvents({
      pattern: drums.pattern, velocities: drums.velocities, steps: drums.steps, stepTicks
    });
    tracks.push(buildTrackFromEvents(ev));
  } else tracks.push([ ...vlq(0), 0xFF, 0x2F, 0x00 ]);

  // Assemble SMF
  const bytes = [];
  bytes.push(...strBytes("MThd"), 0,0,0,6, 0,1, 0, tracks.length, (ppq>>8)&0xFF, ppq&0xFF);
  for (const t of tracks) {
    bytes.push(...strBytes("MTrk"));
    const len = t.length;
    bytes.push((len>>>24)&0xFF, (len>>>16)&0xFF, (len>>>8)&0xFF, len&0xFF);
    bytes.push(...t);
  }
  return new Uint8Array(bytes);
}

export function downloadMIDI(filename, bytes) {
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename || "pattern.mid";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}

// Convert your app state to the encoder config (optional helper)
export function stateToMidiConfig(s) {
  return {
    bpm: s.bpm, ppq: PPQ_DEFAULT, octaveOffset: s.octaveOffset || 0,
    lead:  { pattern:s.lead.pattern,  rowsMidi:s.lead.rowsMidi,  velocities:s.lead.velocities,  steps:s.lead.steps },
    bass:  { pattern:s.bass.pattern,  rowsMidi:s.bass.rowsMidi,  velocities:s.bass.velocities,  steps:s.bass.steps },
    drums: { pattern:s.drums.pattern, velocities:s.drums.velocities, steps:s.drums.steps },
  };
}

// --------- tiny UI binder for your index.js ---------
/**
 * initMidiExport wires the #exportMidiBtn to a provided callback that
 * returns (or triggers) a MIDI export. Your index passes () => exportMidi().
 */
export function initMidiExport(onExport) {
  const btn = document.getElementById("exportMidiBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      const res = await onExport?.();
      // If the callback returned bytes, we’ll auto-download.
      if (res instanceof Uint8Array) downloadMIDI("pattern.mid", res);
    } catch (err) {
      console.error("MIDI export failed:", err);
    }
  });
}
