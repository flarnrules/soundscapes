export class ColoredVerticalBar {
  constructor({
    x,
    baseY,
    width = 10,
    height = 100,
    fillColor = 'orange',
    capColor = 'darkorange',
    maxHeight = 200,
    decayRate = 2,
    startFreq = null,
    endFreq = null,
    fontSize = 10
  }) {
    this.x = x;
    this.baseY = baseY;
    this.width = width;
    this.height = height;
    this.currentHeight = height;
    this.fillColor = fillColor;
    this.capColor = capColor;
    this.maxHeight = maxHeight;
    this.decayRate = decayRate;
    this.fontSize = fontSize;

    this.capY = this.baseY - this.currentHeight;
    this.startFreq = startFreq;
    this.endFreq = endFreq;
  }

  update(targetHeight) {
    this.currentHeight = lerp(this.currentHeight, targetHeight, 0.1);

    const targetCapY = this.baseY - this.currentHeight;
    if (this.capY > targetCapY) {
      this.capY -= this.decayRate;
      this.capY = max(this.capY, targetCapY);
    } else {
      this.capY = targetCapY;
    }
  }

  draw(p) {
    p.noStroke();
    p.fill(this.fillColor);
    p.rect(this.x, this.baseY - this.currentHeight, this.width, this.currentHeight);

    // Draw top cap
    p.fill(this.capColor);
    p.rect(this.x, this.capY, this.width, 4);

    // Draw only the top frequency below each bar
    if (this.endFreq !== null) {
      p.fill(255);
      p.textAlign(p.CENTER, p.TOP);
      p.textSize(this.fontSize);
      p.text(
        Math.round(this.endFreq),
        this.x + this.width / 2,
        this.baseY + 2
      );
    }
  }

  influenceFrom(otherBar) {
    this.update(otherBar.currentHeight);
  }
}
