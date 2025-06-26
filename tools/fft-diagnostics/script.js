import { FrequencySlider } from '../../components/frequency_slider.js';
import { PlayButton } from '../../components/play_button.js';
import { StopButton } from '../../components/stop_button.js';
import { WaveformVisualizer } from '../../components/waveform_visualizer.js';
import { FftGraph } from '../../components/fft_graph.js';
import { NoteSelector } from '../../components/note_selector.js';
import { noteFrequencies } from '../../components/notes.js';

let clickStart = null;
const CLICK_TOLERANCE = 25;

let slider, playButton, stopButton, visualizer, noteSelector;
let oscillators = [];
let playing = false;
let masterGain;
let previewOsc;

let fftGraph;
let fft;
let numBars = 32;
let binsPerBar;
let logEl;

function setup() {
  console.log('🔧 setup fired');

  const canvasWidth = min(windowWidth - 40, 1200);
  const canvasHeight = min(windowHeight - 100, 700);

  createCanvas(canvasWidth, canvasHeight).parent('app-container');
  textFont('monospace');

  // Resume audio context ASAP
  getAudioContext().resume();

  // UI Components
  slider = new FrequencySlider(100, 100, canvasWidth - 200);
  playButton = new PlayButton(canvasWidth - 50, 20);
  stopButton = new StopButton(canvasWidth - 30, 20);
  visualizer = new WaveformVisualizer();

  // FFT Setup
  fft = new p5.FFT(0.9, 1024);
  fftGraph = new FftGraph({
    fft: fft,
    x: 0,
    y: 200,
    width: canvasWidth,
    height: 200,
    fillColor: [0, 255, 0],
  });

  // Persistent preview oscillator
  previewOsc = new p5.Oscillator('sine');
  previewOsc.amp(0);
  previewOsc.start();

  // Note Selector
  if (!noteSelector) {
    noteSelector = new NoteSelector(
      noteFrequencies,
      canvasWidth / 2,
      canvasHeight - 100,
      (note) => {
        slider.setFrequency(note.freq);
        getAudioContext().resume().then(() => {
          previewOsc.freq(note.freq);
          previewOsc.amp(0.4, 0.05);     // quick fade-in
          previewOsc.amp(0, 0.2, 0.1);   // fade out after 0.1s
        });
      },
      {
        toggleMode: true,
        noteSize: 30,
      }
    );
  } else {
    noteSelector.updateLayout(canvasWidth / 2, canvasHeight - 100, {
      noteSize: 30,
    });
  }

  // Diagnostic log
  const spectrum = fft.analyze();
  binsPerBar = floor(spectrum.length / numBars);
  const sampleRate = getAudioContext().sampleRate;
  const nyquist = sampleRate / 2;
  const freqPerBin = nyquist / spectrum.length;

  if (!logEl) {
    logEl = createDiv('').id('log');
  }

  let output = `🔍 FFT Diagnostic – ${spectrum.length} bins @ ${freqPerBin.toFixed(2)} Hz per bin\n\n`;
  for (let i = 0; i < numBars; i++) {
    let startFreq = i * binsPerBar * freqPerBin;
    let endFreq = (i + 1) * binsPerBar * freqPerBin;
    output += `Bar ${String(i).padStart(2)}: ${startFreq.toFixed(0)}Hz – ${endFreq.toFixed(0)}Hz\n`;
  }
  logEl.html(output);
}

function draw() {
  background(0);
  slider.draw(this);
  playButton.draw(this);
  stopButton.draw(this);
  visualizer.draw(this, slider.frequency);
  fftGraph.draw(this);
  noteSelector.draw(this);
}

function mousePressed() {
  clickStart = { x: mouseX, y: mouseY };

  if (playButton.isClicked(mouseX, mouseY)) {
    if (!playing) {
      if (noteSelector.selectedNotes.length === 0) {
        console.warn("⚠️ No notes selected!");
        return;
      }

      // Clean up previous oscillators
      oscillators.forEach((osc) => {
        osc.stop();
        osc.dispose();
      });
      oscillators = [];

      // Kill previewOsc to avoid overlap
      previewOsc.amp(0, 0.05);

      // Create master gain
      masterGain = new p5.Gain();
      masterGain.amp(1);
      masterGain.connect();

      // Resume audio and start oscillators
      getAudioContext().resume().then(() => {
        const perOscAmp = 1 / noteSelector.selectedNotes.length;

        noteSelector.selectedNotes.forEach((freq) => {
          const osc = new p5.Oscillator('sine');
          osc.freq(freq);
          osc.amp(perOscAmp);
          osc.start();
          osc.connect(masterGain);
          oscillators.push(osc);
        });

        fft.setInput(masterGain);
        playing = true;
      });
    }
  }

  if (stopButton.isClicked(mouseX, mouseY)) {
    oscillators.forEach((osc) => {
      osc.stop();
      osc.dispose();
    });
    oscillators = [];
    playing = false;
  }

  slider.handlePressed(mouseX, mouseY);
}

function mouseDragged() {
  slider.handleDragged(mouseX);

  if (noteSelector.selectedNotes.length > 0) {
    noteSelector.clearSelection();
  }

  if (playing) {
    oscillators.forEach((osc) => osc.freq(slider.frequency));
  }
}

function mouseReleased() {
  if (clickStart) {
    const dx = mouseX - clickStart.x;
    const dy = mouseY - clickStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < CLICK_TOLERANCE) {
      noteSelector.handlePressed(mouseX, mouseY);
    }

    clickStart = null;
  }

  slider.handleReleased();
}

function windowResized() {
  setup();
}

window.setup = setup;
window.draw = draw;
window.mousePressed = mousePressed;
window.mouseDragged = mouseDragged;
window.mouseReleased = mouseReleased;
window.windowResized = windowResized;
