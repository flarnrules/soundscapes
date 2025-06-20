export class NoteSelector {
  constructor(notes, x, y, callback) {
    this.notes = notes; // array of {note, freq}
    this.x = x;
    this.y = y;
    this.callback = callback; // call this when a note is clicked
    this.buttonSize = 24;
    this.spacing = 6;
  }

  draw(p) {
    p.textAlign(p.CENTER, p.TOP);
    p.textSize(12);

    for (let i = 0; i < this.notes.length; i++) {
      const note = this.notes[i];
      const bx = this.x + (i % 8) * (this.buttonSize + this.spacing);
      const by = this.y + floor(i / 8) * (this.buttonSize + this.spacing);

      p.fill(50);
      p.stroke(150);
      p.rect(bx, by, this.buttonSize, this.buttonSize, 4);

      p.fill(255);
      p.noStroke();
      p.text(note.note, bx + this.buttonSize / 2, by + 6);
    }
  }

  handlePressed(mx, my) {
    for (let i = 0; i < this.notes.length; i++) {
      const bx = this.x + (i % 8) * (this.buttonSize + this.spacing);
      const by = this.y + floor(i / 8) * (this.buttonSize + this.spacing);

      if (
        mx >= bx && mx <= bx + this.buttonSize &&
        my >= by && my <= by + this.buttonSize
      ) {
        this.callback(this.notes[i]);
        return true;
      }
    }
    return false;
  }
}
