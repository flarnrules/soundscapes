// src/audio/voices.js
import { audio, buses } from './engine.js';

// ---------------- Octave control (CLAMPED) ----------------
let octaveOffsetSemis = 0;
const OCT_MIN = -36, OCT_MAX = +36; // clamp ±3 octaves
export function setOctaveOffset(semitones){
  const clamped = Math.max(OCT_MIN, Math.min(OCT_MAX, semitones|0));
  octaveOffsetSemis = clamped;
  // Broadcast so UI + sequencer + theme can react
  try { window.dispatchEvent(new CustomEvent('octave-change', { detail: { semitones: clamped } })); } catch {}
}
export function getOctaveOffset(){ return octaveOffsetSemis|0; }

// ---------------- Helpers ----------------
function busInput(bus){
  const { ctx } = audio();
  if (!bus) return ctx.destination;
  if (bus.input?.connect) return bus.input;
  if (bus.connect) return bus;
  return ctx.destination;
}
function futureTime(ctx, t){
  const now = ctx.currentTime;
  const minFuture = now + 0.002;
  if (!Number.isFinite(t)) return minFuture;
  return Math.max(t, minFuture);
}

// ---------------- Synth voice (ADSR driven by env; smooth release) ----------------
export function startVoice(freq, when, velocity, bus, gateSec = 0.12){
  const { ctx, params } = audio();
  if (!ctx) return null;

  const t0 = futureTime(ctx, when);
  const wave = params.wave || 'square';
  const env  = params.env  || { attack:0.02, decay:0.15, sustain:0.6, release:0.4 };

  const A = Math.max(0.001, +env.attack  || 0.02);
  const D = Math.max(0.001, +env.decay   || 0.15);
  const S = Math.max(0, Math.min(1, +env.sustain || 0.6));
  const R = Math.max(0.01,  +env.release || 0.4);
  const G = Math.max(0.005, +gateSec     || 0.12);

  const aEnd   = t0 + A;
  const dEnd   = aEnd + D;
  const offT   = t0 + G;
  const relEnd = offT + R;
  const stopAt = Math.max(relEnd + 0.05, ctx.currentTime + 0.01);

  const osc = ctx.createOscillator();
  const vca = ctx.createGain();

  osc.connect(vca);
  vca.connect(busInput(bus));

  osc.type = wave;
  if (Number.isFinite(freq) && freq > 0) osc.frequency.setValueAtTime(freq, t0);

  const peak = Math.max(0, Math.min(1, velocity ?? 0.85));
  vca.gain.setValueAtTime(0, t0);
  vca.gain.linearRampToValueAtTime(peak, aEnd);
  vca.gain.linearRampToValueAtTime(peak * S, dEnd);
  vca.gain.setValueAtTime(peak * S, offT);
  vca.gain.linearRampToValueAtTime(0, relEnd);

  try { osc.start(t0); } catch {}
  try { osc.stop(stopAt); } catch {}

  return {
    node: osc,
    gain: vca,
    stopAt,
    stop: (ts) => {
      const t = futureTime(ctx, ts ?? ctx.currentTime);
      try {
        vca.gain.cancelScheduledValues(t);
        vca.gain.setValueAtTime(vca.gain.value, t);
        vca.gain.linearRampToValueAtTime(0, t + 0.03);
      } catch {}
      try { osc.stop(t + 0.04); } catch {}
    }
  };
}

// ---------------- Drums (unchanged-ish, short one-shots) ----------------
let noiseBuf = null;
function getNoise(ctx){
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i=0;i<len;i++) d[i] = Math.random()*2 - 1;
  noiseBuf = buf; return buf;
}
export function kick(when = audio().ctx.currentTime, velocity = 0.9){
  const { ctx } = audio();
  const out = busInput(buses().drum);
  const t0 = futureTime(ctx, when);
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t0);
  osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
  g.gain.setValueAtTime(0.9*Math.max(0,Math.min(1,velocity)), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
  osc.connect(g); g.connect(out);
  try { osc.start(t0); osc.stop(futureTime(ctx, t0 + 0.22)); } catch {}
}
export function snare(when = audio().ctx.currentTime, velocity = 0.9){
  const { ctx } = audio(); const out = busInput(buses().drum); const t0 = futureTime(ctx, when);
  const n = ctx.createBufferSource(); n.buffer = getNoise(ctx);
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=0.8;
  const hp = ctx.createBiquadFilter(); hp.type='highpass';  hp.frequency.value=700;
  const g  = ctx.createGain(); g.gain.setValueAtTime(0.7*Math.max(0,Math.min(1,velocity)), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
  n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
  try { n.start(t0); n.stop(futureTime(ctx, t0 + 0.2)); } catch {}
  const o = ctx.createOscillator(); const og = ctx.createGain();
  o.type='triangle'; o.frequency.setValueAtTime(180, t0);
  og.gain.setValueAtTime(0.35*Math.max(0,Math.min(1,velocity)), t0);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  o.connect(og); og.connect(out);
  try { o.start(t0); o.stop(futureTime(ctx, t0 + 0.18)); } catch {}
}
export function hat(when = audio().ctx.currentTime, open=false, velocity = 0.8){
  const { ctx } = audio(); const out = busInput(buses().drum); const t0 = futureTime(ctx, when);
  const n = ctx.createBufferSource(); n.buffer = getNoise(ctx); n.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=6000; hp.Q.value=0.7;
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=10000; bp.Q.value=0.8;
  const g  = ctx.createGain(); const peak = (open ? 0.5 : 0.4)*Math.max(0,Math.min(1,velocity)); const dur = open ? 0.35 : 0.08;
  g.gain.setValueAtTime(peak, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
  try { n.start(t0); n.stop(futureTime(ctx, t0 + dur + 0.02)); } catch {}
}

// ---------------- Keyboard control ----------------
const BASE_MIDI = 60; // C4
const KEY_TO_SEMI = { a:0, s:2, d:4, f:5, g:7, h:9, j:11, k:12, l:14, ';':16, "'":17, w:1, e:3, t:6, y:8, u:10, o:13, p:15, '[':18 };
const activeKeys = new Map();
function isTextEntryTarget(ev){
  const el = ev?.target; if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea' || el.isContentEditable) return true;
  if (tag === 'input'){
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text','email','number','password','search','tel','url'].includes(type);
  }
  return false;
}
export function startKeyboardListeners(){
  if (window.__kbBound) return; window.__kbBound = true;
  window.addEventListener('keydown', async (e) => {
    if (e.repeat) return;
    const { ctx } = audio();
    if (!isTextEntryTarget(e)) { try { await ctx.resume(); } catch {} }
    // Octave Z/X
    if ((e.key === 'z' || e.key === 'Z')){ setOctaveOffset(getOctaveOffset() - 12); e.preventDefault(); return; }
    if ((e.key === 'x' || e.key === 'X')){ setOctaveOffset(getOctaveOffset() + 12); e.preventDefault(); return; }
    // Drums
    if (e.key === '1'){ kick(ctx.currentTime, 0.95); e.preventDefault(); return; }
    if (e.key === '2'){ snare(ctx.currentTime, 0.95); e.preventDefault(); return; }
    if (e.key === '3'){ hat(ctx.currentTime, false, 0.9); e.preventDefault(); return; }
    if (e.key === '4'){ hat(ctx.currentTime, true, 0.9); e.preventDefault(); return; }
    // Notes
    const semi = KEY_TO_SEMI[e.key.toLowerCase()]; if (semi === undefined) return;
    if (isTextEntryTarget(e)) return;
    const midi = BASE_MIDI + semi + getOctaveOffset();
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const handle = startVoice(freq, audio().ctx.currentTime, 0.95, buses().lead, 0.18);
    if (handle) activeKeys.set(e.key.toLowerCase(), handle);
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (isTextEntryTarget(e)) return;
    const key = e.key.toLowerCase();
    const h = activeKeys.get(key);
    if (h){ try { h.stop(); } catch {} activeKeys.delete(key); e.preventDefault(); }
  });
}
