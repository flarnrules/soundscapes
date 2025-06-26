import { NoteSelector } from '../../../components/note_selector.js';
import { noteFrequencies } from '../../../components/notes.js';

let noteSelector;
let waveformData = [];
let waveformCount = 0;
let lastSavedWaveform = null;

// UI options
let sampleCountInput, normalizeCheckbox, stackModeCheckbox;

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('app-container');
  textFont('monospace');

  setupUI();

  noteSelector = new NoteSelector(
    noteFrequencies,
    150,
    height / 2,
    handleNoteClick,
    {
      noteWidth: 60,
      noteHeight: 20,
    }
  );
}

function setupUI() {
  const container = select('#options');

  sampleCountInput = createInput('512', 'number');
  sampleCountInput.attribute('min', 32);
  sampleCountInput.attribute('max', 2048);
  sampleCountInput.style('width', '60px');
  container.child(createSpan('Samples: '));
  container.child(sampleCountInput);
  container.child(createSpan('  '));

  normalizeCheckbox = createCheckbox('Normalize', false);
  container.child(normalizeCheckbox);
  container.child(createSpan('  '));

  stackModeCheckbox = createCheckbox('Stack Mode', false);
  container.child(stackModeCheckbox);
  container.child(createSpan('  '));

  const saveButton = createButton('💾 Save Last Waveform');
  saveButton.mousePressed(() => {
    if (lastSavedWaveform) {
      saveJSON(lastSavedWaveform, `waveform_${lastSavedWaveform.note}_${waveformCount++}.json`);
    }
  });
  container.child(saveButton);
}

function draw() {
  background(0);
  noteSelector.draw(this);

  const plotX = width / 2;
  const plotY = 50;
  const plotW = width / 2 - 60;
  const plotH = height - 100;

  stroke(255);
  noFill();
  rect(plotX, plotY, plotW, plotH);

  const setsToDraw = stackModeCheckbox.checked() ? waveformData : waveformData.slice(-1);

  setsToDraw.forEach((data, i) => {
    stroke(255, 100 + i * 50, 150);
    noFill();
    beginShape();
    for (let j = 0; j < data.length; j++) {
      const x = map(j, 0, data.length, plotX, plotX + plotW);
      const y = map(data[j], -1, 1, plotY + plotH, plotY);
      vertex(x, y);
    }
    endShape();
  });
}

function handleNoteClick(note) {
  const osc = new p5.Oscillator('sine');
  osc.freq(note.freq);
  osc.amp(0.8);
  osc.start();

  const duration = 1.5;
  const sampleCount = int(sampleCountInput.value()) || 512;
  const normalize = normalizeCheckbox.checked();
  const fft = new p5.FFT();
  fft.setInput(osc);

  let buffer = [];

  const interval = setInterval(() => {
    const wave = fft.waveform(sampleCount);
    buffer = normalize
      ? wave.map(v => v / Math.max(...wave.map(Math.abs)) || 1)
      : wave;
  }, 10);

  setTimeout(() => {
    clearInterval(interval);
    osc.stop();
    osc.dispose();

    waveformData.push(buffer);
    if (!stackModeCheckbox.checked()) {
      waveformData = [buffer];
    }

    lastSavedWaveform = {
      note: note.note,
      freq: note.freq,
      samples: buffer,
      sampleCount: sampleCount,
      normalized: normalize,
      timestamp: new Date().toISOString()
    };
  }, duration * 1000);
}

function mousePressed() {
  noteSelector.handlePressed(mouseX, mouseY);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  noteSelector.updateLayout(150, height / 2);
}

window.setup = setup;
window.draw = draw;
window.mousePressed = mousePressed;
window.windowResized = windowResized;
