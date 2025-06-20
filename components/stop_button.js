export class StopButton {
  constructor(x, y, size = 16) {
    this.x = x;
    this.y = y;
    this.size = size;
  }

  draw(p) {
    p.fill(255, 0, 0);
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(this.size);
    p.text('■', this.x, this.y);
  }

  isClicked(mx, my) {
    return dist(mx, my, this.x, this.y) < this.size;
  }
}
