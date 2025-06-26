let song;
let fft;
let img;
let canvas;
let started = false;

function preload() {
  song = loadSound('../../assets/everglow.mp3');
  img = loadImage('../../assets/proto_tower_8.png');
}

function setup() {
  const wrapper = document.getElementById('scene-wrapper');
  const size = wrapper.offsetWidth;
  canvas = createCanvas(size, size);
  canvas.parent('scene-wrapper');

  fft = new p5.FFT();
}

function draw() {
  if (!started) return;

  // Draw static background image
  image(img, 0, 0, width, height);

  // Draw waveform
  let waveform = fft.waveform();
  stroke(255);
  strokeWeight(2);
  noFill();
  beginShape();
  for (let i = 0; i < waveform.length; i++) {
    let x = map(i, 0, waveform.length, 0, width);
    let y = height / 2 + waveform[i] * height / 2;
    vertex(x, y);
  }
  endShape();
}

function mousePressed() {
  if (!started) {
    getAudioContext().resume().then(() => {
      song.loop();
      started = true;
    });
  }
}

window.setup = setup;
window.draw = draw;
window.preload = preload;
window.mousePressed = mousePressed;
