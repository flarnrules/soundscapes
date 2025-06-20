import { FrequencySlider } from '../../components/frequency_slider.js';
import { PlayButton } from '../../components/play_button.js';
import { StopButton } from '../../components/stop_button.js';
import { WaveformVisualizer } from '../../components/waveform_visualizer.js';
import { FftGraph } from '../../components/fft_graph.js';

let slider, playButton, stopButton, visualizer;
let oscillator;
let playing = false;

let fftGraph;
let fft;
let numBars = 32;
let binsPerBar;
let logEl;

function setup() {
  console.log('🔧 setup fired');
  createCanvas(1200, 400);
  textFont('monospace');

  // UI Components
  slider = new FrequencySlider(100, 100, 1000); // px fr left, px fr top, px wide
  playButton = new PlayButton(width - 40, 10);
  stopButton = new StopButton(width - 20, 10);
  visualizer = new WaveformVisualizer();

  // Oscillator
  oscillator = new p5.Oscillator('sine');
  oscillator.amp(0.3);
  
  // FFT Graph
  fft = new p5.FFT(0.9, 1024)
  fft.setInput(oscillator);

  fftGraph = new FftGraph({
    fft: fft,
    x: 0,
    y: 200,
    width: width,
    height: 200,
    fillColor: [0, 255, 0]
  });

  // FFT Analysis
  fft = new p5.FFT(0.9, 1024);
  let spectrum = fft.analyze(); // trigger internal bin sizing

  binsPerBar = floor(spectrum.length / numBars);
  const sampleRate = getAudioContext().sampleRate;
  const nyquist = sampleRate / 2;
  const freqPerBin = nyquist / spectrum.length;

  // Print bin mapping data
  logEl = createDiv('').id('log');
  let output = `🔍 FFT Diagnostic – ${spectrum.length} bins @ ${freqPerBin.toFixed(2)} Hz per bin\n\n`;

  for (let i = 0; i < numBars; i++) {
    let startFreq = i * binsPerBar * freqPerBin;
    let endFreq = (i + 1) * binsPerBar * freqPerBin;
    output += `Bar ${String(i).padStart(2)}: ${startFreq.toFixed(0)}Hz – ${endFreq.toFixed(0)}Hz\n`;
  }

  logEl.html(output);
}

function draw() {
  console.log('🎨 drawing...');
  background(0);

  // UI
  slider.draw(this);
  playButton.draw(this);
  stopButton.draw(this);

  // Wave
  visualizer.draw(this, slider.frequency);

  // FFT Graph
  fftGraph.draw(this);
  
}

function mousePressed() {
  if (playButton.isClicked(mouseX, mouseY)) {
    if (!playing) {
      oscillator.start();
      oscillator.freq(slider.frequency);
      playing = true;
    }
  }

  if (stopButton.isClicked(mouseX, mouseY)) {
    oscillator.stop();
    playing = false;
  }

  slider.handlePressed(mouseX, mouseY);
}

function mouseDragged() {
  slider.handleDragged(mouseX);
  if (playing) oscillator.freq(slider.frequency);
}

function mouseReleased() {
  slider.handleReleased();
}

window.setup = setup;
window.draw = draw;
window.mousePressed = mousePressed;
window.mouseDragged = mouseDragged;
window.mouseReleased = mouseReleased;
