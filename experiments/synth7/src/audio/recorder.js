import { audio } from './engine.js';

let mediaDest, recorder, chunks = [];
const $ = (id)=>document.getElementById(id);

export function initRecorderUI(){
  const btn = $('recToggle'), link = $('recDownload');
  btn.addEventListener('click', ()=>{
    if (!recorder || recorder.state === 'inactive') startRec(btn, link);
    else stopRec(btn, link);
  });
}

function ensureDestination(){
  if (mediaDest) return mediaDest;
  const { ctx, masterGain } = audio();
  mediaDest = ctx.createMediaStreamDestination();
  masterGain.connect(mediaDest);
  return mediaDest;
}
function startRec(btn, link){
  const stream = ensureDestination().stream;
  recorder = new MediaRecorder(stream);
  chunks = [];
  recorder.ondataavailable = (e)=> chunks.push(e.data);
  recorder.onstop = ()=>{
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = 'live-set.webm';
    link.style.display = 'inline-block';
    link.textContent = 'Download recording';
  };
  link.style.display = 'none';
  recorder.start();
  btn.textContent = '■ Stop';
}
function stopRec(btn){
  recorder?.stop();
  btn.textContent = '● Record';
}
