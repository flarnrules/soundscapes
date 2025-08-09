// app.js

// --- UI References ---
const fileInput    = document.getElementById('fileInput');
const loadBtn      = document.getElementById('loadBtn');
const stopBtn      = document.getElementById('stopBtn');
const rateSlider   = document.getElementById('rate');
const depthSlider  = document.getElementById('depth');
const stagesSlider = document.getElementById('stages');
const feedbackSlider = document.getElementById('feedback');
const mixSlider    = document.getElementById('mix');
const phaserMinIn  = document.getElementById('phaserMin');
const phaserMaxIn  = document.getElementById('phaserMax');
const speedSlider  = document.getElementById('speed');
const pitchSlider  = document.getElementById('pitch');
const fftSizeSlider= document.getElementById('fftSize');
const canvas       = document.getElementById('waveform');
const ctx2d        = canvas.getContext('2d');

// --- Audio Setup ---
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx      = new AudioCtx();
const analyser = ctx.createAnalyser();
analyser.fftSize = +fftSizeSlider.value;

// allow FFT size change
fftSizeSlider.addEventListener('input', () => {
  analyser.fftSize = +fftSizeSlider.value;
});

// --- Stereo Phaser Builder ---
function makeStereoPhaser({
  stages    = 6,
  baseFreq  = 700,
  octaves   = 1,
  rate      = 0.5,
  depth     = 0.5,
  feedback  = 0.7,
  mix       = 0.5
} = {}) {
  // build one channel
  function buildChain(phaseOffset) {
    const input  = ctx.createGain();
    const output = ctx.createGain();
    let prev = input;
    const filters = [];

    // all-pass stages
    for (let i = 0; i < stages; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = baseFreq * Math.pow(2, (i/(stages-1)) * octaves);
      prev.connect(ap);
      filters.push(ap);
      prev = ap;
    }
    prev.connect(output);

    // feedback loop
    const fb = ctx.createGain();
    fb.gain.value = feedback;
    output.connect(fb);
    fb.connect(input);

    // LFO
    const lfo     = ctx.createOscillator();
    lfo.type      = 'triangle';
    lfo.frequency.value = rate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = depth * (baseFreq * Math.pow(2, octaves) - baseFreq);
    lfo.connect(lfoGain);
    filters.forEach(f => lfoGain.connect(f.frequency));
    lfo.start();

    return { input, output, lfo, lfoGain, fb };
  }

  // two channels with 90° phase offset
  const left  = buildChain(0);
  const right = buildChain(0.25);

  // splitter & merger
  const splitter = ctx.createChannelSplitter(2);
  const merger   = ctx.createChannelMerger(2);

  left.output .connect(merger, 0, 0);
  right.output.connect(merger, 0, 1);

  // dry/wet mix
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.value = 1 - mix;
  wetGain.gain.value = mix;

  // master out
  const master = ctx.createGain();

  function connect(inputNode) {
    // dry path
    inputNode.connect(dryGain);
    dryGain.connect(master);
    // wet path
    inputNode.connect(splitter);
    splitter.connect(left.input,  0);
    splitter.connect(right.input, 1);
    merger.connect(wetGain);
    wetGain.connect(master);
  }

  return { connect, master, left, right, dryGain, wetGain };
}

// --- Draw Waveform ---
function drawWave() {
  requestAnimationFrame(drawWave);
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  ctx2d.fillStyle = '#222';
  ctx2d.fillRect(0,0,canvas.width,canvas.height);
  ctx2d.lineWidth = 2;
  ctx2d.strokeStyle = '#0f0';
  ctx2d.beginPath();

  const slice = canvas.width / data.length;
  let x = 0;
  for (let v of data) {
    const y = (v/255)*canvas.height;
    ctx2d.lineTo(x,y);
    x += slice;
  }
  ctx2d.stroke();
}
drawWave();

// --- State ---
let sourceNode, recorder, sp;

// live-update LFO & depth
rateSlider.addEventListener('input', () => {
  if (sp) {
    sp.left.lfo.frequency.value  = +rateSlider.value;
    sp.right.lfo.frequency.value = +rateSlider.value;
  }
});
depthSlider.addEventListener('input', () => {
  if (sp) {
    const minF = +phaserMinIn.value;
    const maxF = +phaserMaxIn.value;
    const range = maxF - minF;
    sp.left.lfoGain.gain.value  = +depthSlider.value * range;
    sp.right.lfoGain.gain.value = +depthSlider.value * range;
  }
});

// --- Load & Play ---
loadBtn.addEventListener('click', async () => {
  if (!fileInput.files[0]) {
    alert("Choose a WAV file first!");
    return;
  }
  if (ctx.state === 'suspended') await ctx.resume();

  // decode
  const buf = await fileInput.files[0].arrayBuffer().then(a=>ctx.decodeAudioData(a));
  sourceNode && sourceNode.stop();

  // source
  sourceNode = ctx.createBufferSource();
  sourceNode.buffer = buf;
  sourceNode.playbackRate.value = +speedSlider.value;
  sourceNode.detune.value       = +pitchSlider.value;

  // phaser params
  const minF = +phaserMinIn.value;
  const maxF = +phaserMaxIn.value;
  const octs = Math.log2(maxF / minF);

  sp = makeStereoPhaser({
    stages:   +stagesSlider.value,
    baseFreq: minF,
    octaves:  octs,
    rate:     +rateSlider.value,
    depth:    +depthSlider.value,
    feedback:+feedbackSlider.value,
    mix:     +mixSlider.value
  });

  // wire up
  sp.connect(sourceNode);
  sp.master.connect(analyser);
  analyser.connect(ctx.destination);

  // record
  recorder = new Recorder(sp.master, { numChannels: 2 });
  recorder.record();

  sourceNode.start();
  stopBtn.disabled = false;
});

// --- Stop & Download ---
stopBtn.addEventListener('click', () => {
  sourceNode && sourceNode.stop();
  recorder.stop();
  recorder.exportWAV(blob => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download= 'processed_robot.wav';
    a.click();
  });
  stopBtn.disabled = true;
});
