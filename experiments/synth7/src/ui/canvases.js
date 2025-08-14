// src/ui/canvases.js
// Waveform + Spectrum canvases with RIGHT gutters that act like inline controls.
// - Waveform canvas: choose oscillator type (sine/square/saw/triangle)
// - Spectrum canvas: choose filter type (lowpass/highpass/bandpass)
// No "radio dots": selection is indicated by a shaded slot.
// Slots auto-size so all options always fit vertically.

import { audio, setWave, setFilter } from '../audio/engine.js';

const $ = (id)=>document.getElementById(id);

// Canvases (image-reactive canvas is optional and left unchanged)
const cImg  = $('img');   const gImg  = cImg  ? cImg.getContext('2d')  : null;
const cWave = $('wave');  const gWave = cWave ? cWave.getContext('2d') : null;
const cBars = $('bars');  const gBars = cBars ? cBars.getContext('2d') : null;

// Constants
const GUTTER_W = 72;                      // width of right control strip
const WAVE_TYPES   = ['sine','square','sawtooth','triangle'];
const FILTER_TYPES = ['lowpass','highpass','bandpass'];

// Dynamic slot heights (computed per-frame from canvas height)
let waveSlotH = 56;
let filterSlotH = 56;

// Buffers
let waveArr = null, binsArr = null;

// ---------- Utilities ----------
function resizeToDisplay(c) {
  if (!c) return;
  const w = Math.max(1, c.clientWidth|0);
  const h = Math.max(1, c.clientHeight|0);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}
function cssVar(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function drawGridBack(g, w, h){
  const grid  = cssVar('--grid', '#222');
  const bg    = cssVar('--canvas', '#0e0e0e');
  g.clearRect(0,0,w,h);
  g.fillStyle = bg;
  g.fillRect(0,0,w,h);
  g.globalAlpha = 0.35;
  g.strokeStyle = grid;
  g.beginPath();
  for (let x=0; x<=w; x+=50){ g.moveTo(x,0); g.lineTo(x,h); }
  for (let y=0; y<=h; y+=50){ g.moveTo(0,y); g.lineTo(w,y); }
  g.stroke();
  g.globalAlpha = 1;
}
function ensureBuffers(analyser){
  const n = analyser.fftSize;
  if (!waveArr || waveArr.length !== n) waveArr = new Uint8Array(n);
  if (!binsArr || binsArr.length !== n) binsArr = new Uint8Array(n);
}
function slotSize(h, count){
  // Always fit: clamp between 34px and 90px
  return Math.max(34, Math.min(90, Math.floor(h / count)));
}

// ---------- Image-reactive (optional) ----------
let reactiveImg=null, imgReady=false, offscreen=null, offctx=null;
export function bindImageReactive(inputEl, toggleEl){
  if (!inputEl) return;
  inputEl.addEventListener('change',(e)=>{
    const file = e.target.files?.[0]; if(!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ reactiveImg=img; imgReady=true; offscreen=null; offctx=null; URL.revokeObjectURL(url); };
    img.src = url;
  });
}
function fitContain(w,h,iw,ih){ const s=Math.min(w/iw,h/ih,1); const dw=Math.max(1,Math.floor(iw*s)), dh=Math.max(1,Math.floor(ih*s)); return {dw,dh,dx:Math.floor((w-dw)/2),dy:Math.floor((h-dh)/2)}; }
function ensureOffscreen(dw,dh){ if(!offscreen||offscreen.width!==dw||offscreen.height!==dh){ offscreen=document.createElement('canvas'); offscreen.width=dw; offscreen.height=dh; offctx=offscreen.getContext('2d'); offctx.imageSmoothingEnabled=true; } }
function drawImageReactive(analyser){
  if (!cImg || !gImg) return;
  resizeToDisplay(cImg);
  const w=cImg.width, h=cImg.height;
  drawGridBack(gImg, w, h);

  const imageReactive = $('imageReactive');
  if (!analyser || !imgReady || !imageReactive || !imageReactive.checked) return;

  ensureBuffers(analyser);
  analyser.getByteTimeDomainData(waveArr);

  const iw=reactiveImg.naturalWidth||reactiveImg.width, ih=reactiveImg.naturalHeight||reactiveImg.height;
  const {dw,dh,dx,dy}=fitContain(w,h,iw,ih);
  ensureOffscreen(dw,dh);
  offctx.clearRect(0,0,dw,dh);
  offctx.drawImage(reactiveImg,0,0,iw,ih,0,0,dw,dh);

  const maxDx=Math.max(8,Math.min(40,Math.floor(w*0.03))), sliceH=4;
  for(let sy=0; sy<dh; sy+=sliceH){
    const t=Math.floor((sy/dh)*(waveArr.length-1)); const v=(waveArr[t]-128)/128; const shift=v*maxDx;
    gImg.drawImage(offscreen,0,sy,dw,sliceH, dx+shift,dy+sy,dw,sliceH);
  }
}

// ---------- Waveform (with wave-type gutter) ----------
function drawWave(analyser){
  if (!cWave || !gWave) return;
  resizeToDisplay(cWave);
  const w=cWave.width, h=cWave.height;
  const plotW = Math.max(1, w - GUTTER_W);

  // auto slot size so all 4 fit
  waveSlotH = slotSize(h, WAVE_TYPES.length);

  drawGridBack(gWave, w, h);

  // Plot waveform
  if (analyser){
    ensureBuffers(analyser);
    analyser.getByteTimeDomainData(waveArr);
    const accent2 = cssVar('--accent2','#9be58c');

    gWave.save();
    gWave.beginPath();
    gWave.rect(0,0,plotW,h);
    gWave.clip();

    gWave.lineWidth=2; gWave.strokeStyle=accent2; gWave.beginPath();
    for (let i=0;i<waveArr.length;i++){
      const x=(i/(waveArr.length-1))*plotW;
      const v=(waveArr[i]-128)/128;
      const y=(h/2)+v*(h*0.45);
      i===0?gWave.moveTo(x,y):gWave.lineTo(x,y);
    }
    gWave.stroke();
    gWave.restore();
  }

  drawWaveTypeGutter(gWave, w, h, plotW);
}

function drawWaveTypeGutter(g, w, h, plotW){
  const current = (audio().params?.wave) || 'square';
  const grid = cssVar('--grid','#222');
  const selFill = 'rgba(255,255,255,0.10)';

  // Divider
  g.strokeStyle = grid; g.lineWidth = 1;
  g.beginPath(); g.moveTo(plotW+0.5,0); g.lineTo(plotW+0.5,h); g.stroke();

  for (let i=0;i<WAVE_TYPES.length;i++){
    const top = i*waveSlotH;
    if (top >= h) break;
    const isSel = (WAVE_TYPES[i] === current);
    if (isSel){ g.fillStyle = selFill; g.fillRect(w-GUTTER_W, top, GUTTER_W, Math.min(waveSlotH, h-top)); }

    // Icon area
    const x0 = w - GUTTER_W + 8;
    const y0 = top + 8;
    const ww = GUTTER_W - 16;
    const hh = Math.min(waveSlotH - 16, h - y0 - 8);

    drawWaveIcon(g, WAVE_TYPES[i], x0, y0, ww, hh);
  }
}

function drawWaveIcon(g, type, x, y, w, h){
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  g.beginPath();
  const L = x, R = x + w, T = y, B = y + h, M = (T+B)/2;

  if (type === 'sine'){
    const steps = 24;
    for (let i=0;i<=steps;i++){
      const t = i/steps;
      const xx = L + t*w;
      const yy = M + Math.sin(t*2*Math.PI) * (h*0.45);
      i===0?g.moveTo(xx,yy):g.lineTo(xx,yy);
    }
  } else if (type === 'square'){
    const a = h*0.4;
    const q = w/4;
    g.moveTo(L, M - a);
    g.lineTo(L+q, M - a);
    g.lineTo(L+q, M + a);
    g.lineTo(L+2*q, M + a);
    g.lineTo(L+2*q, M - a);
    g.lineTo(L+3*q, M - a);
    g.lineTo(L+3*q, M + a);
    g.lineTo(R, M + a);
  } else if (type === 'sawtooth'){
    const steps = 5;
    const stepW = w / steps;
    g.moveTo(L, B);
    for (let i=0;i<steps;i++){
      g.lineTo(L+i*stepW, B);
      g.lineTo(L+(i+1)*stepW, T);
    }
    g.lineTo(R, T);
  } else { // triangle
    const steps = 4;
    const stepW = w / steps;
    g.moveTo(L, M);
    for (let i=0;i<steps;i++){
      const up = (i % 2 === 0);
      g.lineTo(L+i*stepW, up?T:B);
      g.lineTo(L+(i+1)*stepW, up?B:T);
    }
  }
  g.stroke();
  g.restore();
}

// ---------- Spectrum (with filter-type gutter) ----------
function drawSpectrum(analyser){
  if (!cBars || !gBars) return;
  resizeToDisplay(cBars);
  const w=cBars.width, h=cBars.height;
  const plotW = Math.max(1, w - GUTTER_W);

  // auto slot size so all 3 fit
  filterSlotH = slotSize(h, FILTER_TYPES.length);

  drawGridBack(gBars, w, h);

  if (analyser){
    ensureBuffers(analyser);
    analyser.getByteFrequencyData(binsArr);
    const accent = cssVar('--accent','#8ab4ff');
    const barCount=128, step=Math.max(1,Math.floor(binsArr.length/barCount)), barW=Math.max(1,plotW/barCount);
    for(let i=0;i<barCount;i++){
      const v=binsArr[i*step]/255, bh=v*(h-6), x=Math.floor(i*barW), y=h-bh;
      gBars.fillStyle=accent; gBars.fillRect(x,y,Math.max(1,barW-1),bh);
    }
  }

  drawFilterTypeGutter(gBars, w, h, plotW);
}

function drawFilterTypeGutter(g, w, h, plotW){
  const current = (audio().params?.filter?.type) || 'lowpass';
  const grid = cssVar('--grid','#222');
  const selFill = 'rgba(255,255,255,0.10)';

  // Divider
  g.strokeStyle = grid; g.lineWidth = 1;
  g.beginPath(); g.moveTo(plotW+0.5,0); g.lineTo(plotW+0.5,h); g.stroke();

  for (let i=0;i<FILTER_TYPES.length;i++){
    const top = i*filterSlotH;
    if (top >= h) break;
    const isSel = (FILTER_TYPES[i] === current);
    if (isSel){ g.fillStyle = selFill; g.fillRect(w-GUTTER_W, top, GUTTER_W, Math.min(filterSlotH, h-top)); }

    const x0 = w - GUTTER_W + 8;
    const y0 = top + 8;
    const ww = GUTTER_W - 16;
    const hh = Math.min(filterSlotH - 16, h - y0 - 8);

    drawFilterIcon(g, FILTER_TYPES[i], x0, y0, ww, hh);
  }
}

function drawFilterIcon(g, type, x, y, w, h){
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  g.beginPath();

  // Rough frequency-response sketches:
  const L=x, R=x+w, T=y, B=y+h;

  if (type === 'lowpass'){
    g.moveTo(L, T+6);
    g.lineTo(L + w*0.35, T+8);
    for (let i=0;i<=16;i++){
      const t = i/16;
      const xx = L + w*0.35 + t*w*0.6;
      const yy = T + 8 + Math.pow(t, 2.4)*(h-16);
      g.lineTo(xx, yy);
    }
  } else if (type === 'highpass'){
    g.moveTo(L, B-8);
    for (let i=0;i<=16;i++){
      const t=i/16;
      const xx = L + t*w*0.6;
      const yy = B - 8 - Math.pow(t, 2.4)*(h-16);
      g.lineTo(xx, yy);
    }
    g.lineTo(R, T+6);
  } else { // bandpass
    const cx = L + w*0.5;
    const a  = Math.max(8, h*0.42);
    for (let i=0;i<=24;i++){
      const t = (i/24)*2 - 1; // -1..1
      const xx = cx + t*w*0.35;
      const yy = B - 6 - (1 - Math.min(1, Math.abs(t))) * a;
      i===0 ? g.moveTo(xx, yy) : g.lineTo(xx, yy);
    }
  }
  g.stroke();
  g.restore();
}

// ---------- Interaction (click in gutters) ----------
function clickWaveGutter(e){
  if (!cWave) return;
  const r = cWave.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < cWave.width - GUTTER_W) return; // not in gutter
  const idx = Math.floor(y / waveSlotH);
  const type = WAVE_TYPES[idx];
  if (!type) return;
  try { setWave(type); } catch {}
}
function clickFilterGutter(e){
  if (!cBars) return;
  const r = cBars.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < cBars.width - GUTTER_W) return; // not in gutter
  const idx = Math.floor(y / filterSlotH);
  const type = FILTER_TYPES[idx];
  if (!type) return;
  const p = audio().params?.filter || {};
  try { setFilter({ type, cutoff: p.cutoff ?? 1200, q: p.q ?? 0.7 }); } catch {}
}

// ---------- Public API ----------
export function drawLoopInit(analyser){
  // Resize observers
  const displayEl = document.querySelector('.display') || document.body;
  const ro = new ResizeObserver(()=>{
    [cImg, cWave, cBars].forEach(resizeToDisplay);
  });
  ro.observe(displayEl);

  // Pointer handlers
  if (cWave) cWave.addEventListener('pointerdown', clickWaveGutter);
  if (cBars) cBars.addEventListener('pointerdown', clickFilterGutter);

  // Optional image binder if you have #imageInput/#imageReactive
  const imageInput = $('imageInput'), imageReactive = $('imageReactive');
  if (imageInput) bindImageReactive(imageInput, imageReactive);

  // Draw loop
  function loop(){
    requestAnimationFrame(loop);
    drawImageReactive(analyser);
    drawWave(analyser);
    drawSpectrum(analyser);
  }
  loop();
}
