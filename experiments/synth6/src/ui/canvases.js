const cImg = document.getElementById('img'),  gImg = cImg.getContext('2d');
const cWave= document.getElementById('wave'), gWave= cWave.getContext('2d');
const cBars= document.getElementById('bars'), gBars= cBars.getContext('2d');

let analyser=null, wave=new Uint8Array(1024), bins=new Uint8Array(1024);
let reactiveImg=null, imgReady=false, offscreen=null, offctx=null;

const $ = (id)=>document.getElementById(id);
const imageInput = $('imageInput'), imageReactive = $('imageReactive');

export function drawLoopInit(ana){
  analyser = ana;
  imageInput.addEventListener('change', (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const url=URL.createObjectURL(file); const img=new Image();
    img.onload=()=>{ reactiveImg=img; imgReady=true; offscreen=null; offctx=null; URL.revokeObjectURL(url); };
    img.src=url;
  });
  function tick(){ requestAnimationFrame(tick); drawImageReactive(); drawWaveform(); drawSpectrum(); }
  tick();
}

export function kickInitialResize() {
  // two RAFs to let CSS grid settle before first draw
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resizeAll && resizeAll();   // call your existing function
  }));
}


function resizeCanvas(c){ const w=c.clientWidth,h=c.clientHeight; if(c.width!==w||c.height!==h){ c.width=w;c.height=h; } }
function fitContain(w,h,iw,ih){ const s=Math.min(w/iw,h/ih,1); const dw=Math.max(1,Math.floor(iw*s)), dh=Math.max(1,Math.floor(ih*s)); return {dw,dh,dx:Math.floor((w-dw)/2),dy:Math.floor((h-dh)/2)}; }
function ensureOffscreen(dw,dh){ if(!offscreen || offscreen.width!==dw || offscreen.height!==dh){ offscreen=document.createElement('canvas'); offscreen.width=dw; offscreen.height=dh; offctx=offscreen.getContext('2d'); }
  offctx.clearRect(0,0,dw,dh); offctx.drawImage(reactiveImg,0,0,reactiveImg.naturalWidth||reactiveImg.width,reactiveImg.naturalHeight||reactiveImg.height,0,0,dw,dh); }

function drawImageReactive(){
  resizeCanvas(cImg);
  const w=cImg.width,h=cImg.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gImg.clearRect(0,0,w,h); gImg.fillStyle=bg; gImg.fillRect(0,0,w,h);
  gImg.globalAlpha=.35; gImg.strokeStyle=grid; gImg.beginPath();
  for(let x=0;x<=w;x+=50){ gImg.moveTo(x,0); gImg.lineTo(x,h); }
  for(let y=0;y<=h;y+=50){ gImg.moveTo(0,y); gImg.lineTo(w,y); }
  gImg.stroke(); gImg.globalAlpha=1;

  if(!analyser || !imgReady || !imageReactive.checked) return;
  analyser.getByteTimeDomainData(wave);
  const iw=reactiveImg.naturalWidth||reactiveImg.width, ih=reactiveImg.naturalHeight||reactiveImg.height;
  const {dw,dh,dx,dy}=fitContain(w,h,iw,ih); ensureOffscreen(dw,dh);

  const maxDx=Math.max(8,Math.min(40,Math.floor(w*0.03))), sliceH=4;
  for(let sy=0;sy<dh;sy+=sliceH){
    const t=Math.floor((sy/dh)*(wave.length-1)), v=(wave[t]-128)/128, shift=v*maxDx;
    gImg.drawImage(offscreen,0,sy,dw,sliceH, dx+shift,dy+sy,dw,sliceH);
  }
}
function drawWaveform(){
  resizeCanvas(cWave);
  const w=cWave.width,h=cWave.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const accent2=getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim()||'#9be58c';
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gWave.clearRect(0,0,w,h); gWave.fillStyle=bg; gWave.fillRect(0,0,w,h);
  gWave.globalAlpha=.35; gWave.strokeStyle=grid; gWave.beginPath();
  for(let x=0;x<=w;x+=50){ gWave.moveTo(x,0); gWave.lineTo(x,h); }
  for(let y=0;y<=h;y+=50){ gWave.moveTo(0,y); gWave.lineTo(w,y); }
  gWave.stroke(); gWave.globalAlpha=1;
  if(!analyser) return;
  analyser.getByteTimeDomainData(wave);
  gWave.lineWidth=2; gWave.strokeStyle=accent2; gWave.beginPath();
  for (let i=0;i<wave.length;i++){ const x=(i/(wave.length-1))*w; const v=(wave[i]-128)/128; const y=(h/2)+v*(h*.45); i===0?gWave.moveTo(x,y):gWave.lineTo(x,y); }
  gWave.stroke();
}
function drawSpectrum(){
  resizeCanvas(cBars);
  const w=cBars.width,h=cBars.height;
  const grid=getComputedStyle(document.documentElement).getPropertyValue('--grid').trim()||'#222';
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#8ab4ff';
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--canvas');
  gBars.clearRect(0,0,w,h); gBars.fillStyle=bg; gBars.fillRect(0,0,w,h);
  gBars.globalAlpha=.35; gBars.strokeStyle=grid; gBars.beginPath();
  for(let x=0;x<=w;x+=50){ gBars.moveTo(x,0); gBars.lineTo(x,h); }
  for(let y=0;y<=h;y+=50){ gBars.moveTo(0,y); gBars.lineTo(w,y); }
  gBars.stroke(); gBars.globalAlpha=1;
  if (!analyser) return;
  analyser.getByteFrequencyData(bins);
  const barCount=128, step=Math.max(1,Math.floor(bins.length/barCount)), barW=Math.max(1,w/barCount);
  for(let i=0;i<barCount;i++){
    const v=bins[i*step]/255, bh=v*(h-6), x=Math.floor(i*barW), y=h-bh;
    gBars.fillStyle=accent; gBars.fillRect(x,y,Math.max(1,barW-1),bh);
  }
}
