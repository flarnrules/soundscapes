export class FftGraph {
  constructor({
    fft,
    x = 0,
    y = 0,
    width = 800,
    height = 200,
    fillColor = [0, 255, 0],
    strokeColor = null,
    useLogAverages = false,
    smoothing = 0.9,
    bins = 1024,
  }) {
    this.fft = fft;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.fillColor = fillColor;
    this.strokeColor = strokeColor;
    this.useLogAverages = useLogAverages;
    this.smoothing = smoothing;
    this.bins = bins;

    this.fft.smooth(this.smoothing);
    this.fft.bins = this.bins;
  }

  draw(p) {
    const spectrum = this.useLogAverages
      ? this.fft.logAverages(this.fft.getOctaveBands())
      : this.fft.analyze();

    const barWidth = this.width / spectrum.length;

    if (this.fillColor) p.fill(...this.fillColor);
    if (this.strokeColor) p.stroke(...this.strokeColor);
    else p.noStroke();

    for (let i = 0; i < spectrum.length; i++) {
      const val = spectrum[i];
      const barHeight = p.map(val, 0, 255, 0, this.height);
      const xpos = this.x + i * barWidth;
      const ypos = this.y + this.height - barHeight;

      p.rect(xpos, ypos, barWidth, barHeight);
    }
  }
}
