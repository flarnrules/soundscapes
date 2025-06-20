export class WaveformVisualizer {
  constructor(amplitude = 50) {
    this.amplitude = amplitude;
  }

  draw(p, frequency) {
    p.stroke(100, 200, 255);
    p.noFill();
    p.beginShape();
    for (let x = 0; x < p.width; x++) {
      const t = x / p.width;
      const angle = p.TWO_PI * frequency * t;
      const y = p.height / 2 + Math.sin(angle) * this.amplitude;
      p.vertex(x, y);
    }
    p.endShape();
  }
}
