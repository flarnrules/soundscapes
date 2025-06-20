import { ColoredVerticalBar } from '../../components/index.js';

let song;
let fft;
let bars = [];
let numBars = 22;
let barSpacing = 50;

function preload() {
  song = loadSound('../../assets/everglow.mp3', () => {
    console.log('🎵 Sound loaded');
  }, (err) => {
    console.error('❌ Sound failed to load', err);
  });
}

function setup() {
  createCanvas(800, 400);
  fft = new p5.FFT(0.9, 1024);
  song.loop();

  let sampleRate = getAudioContext().sampleRate;
  let nyquist = sampleRate / 2;
  let freqPerBin = nyquist / 1024;
  let binsPerBar = floor(1024 / numBars);

for (let i = 0; i < numBars; i++) {
  let startFreq = i * binsPerBar * freqPerBin;
  let endFreq = (i + 1) * binsPerBar * freqPerBin;

  bars.push(new ColoredVerticalBar({
    x: i * barSpacing + 20,
    baseY: height - 50,
    width: 15,
    height: 0,
    fillColor: 'orange',
    capColor: 'darkred',
    startFreq,
    endFreq
  }));
}

  console.log('🛠 setup complete');
}

function draw() {
  background(30);
  let spectrum = fft.analyze();

  let binsPerBar = floor(spectrum.length / numBars);

  for (let i = 0; i < numBars; i++) {
    let start = i * binsPerBar;
    let end = start + binsPerBar;
    let chunk = spectrum.slice(start, end);
    let avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;

    let h = map(avg, 0, 255, 0, 200);
    bars[i].update(h);
    bars[i].draw(this);
  }

  console.log('🌀 draw frame');
}

// Needed for p5 to hook in
window.setup = setup;
window.draw = draw;
window.preload = preload;
