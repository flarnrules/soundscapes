export class FrequencySlider {
  constructor(x, y, width, minHz = 1, maxHz = 22050) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.minHz = minHz;
    this.maxHz = maxHz;

    this.handleX = x + width / 2;
    this.dragging = false;
    this.frequency = this.getFrequency();
  }

  getFrequency() {
    const percent = (this.handleX - this.x) / this.width;
    return map(percent, 0, 1, this.minHz, this.maxHz);
  }

  updateHandle(mouseX) {
    this.handleX = constrain(mouseX, this.x, this.x + this.width);
    this.frequency = this.getFrequency();
  }

  draw(p) {
    p.stroke(255);
    p.noFill();
    p.rect(this.x, this.y, this.width, 20);

    p.fill(255);
    p.noStroke();
    p.ellipse(this.handleX, this.y + 10, 12);

    p.fill(200);
    p.textAlign(p.CENTER, p.BOTTOM);
    p.textSize(12);
    p.text(`${Math.round(this.frequency)} Hz`, this.handleX, this.y - 5);
  }

  handlePressed(mx, my) {
    if (
      mx >= this.x &&
      mx <= this.x + this.width &&
      my >= this.y &&
      my <= this.y + 20
    ) {
      this.dragging = true;
      this.updateHandle(mx);
      return true;
    }
    return false;
  }

  handleDragged(mx) {
    if (this.dragging) this.updateHandle(mx);
  }

  handleReleased() {
    this.dragging = false;
  }
}
