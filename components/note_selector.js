export class NoteSelector {
  constructor(notes, x, y, onClick, options = {}) {
    this.notes = notes;
    this.x = x;
    this.y = y;
    this.onClick = onClick;

    this.noteWidth = options.noteWidth || 40;
    this.noteHeight = options.noteHeight || 20;

    this.selectedNotes = [];
    this.layout = [];
  }

  updateLayout(x, y, options = {}) {
    this.x = x;
    this.y = y;
    if (options.noteWidth) this.noteWidth = options.noteWidth;
    if (options.noteHeight) this.noteHeight = options.noteHeight;
  }

  draw(p) {
    const noteNames = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];
    const octaves = [...new Set(this.notes.map(n => n.note.slice(-1)))];
    const numCols = noteNames.length;
    const numRows = octaves.length;

    const totalW = numCols * this.noteWidth;
    const totalH = numRows * this.noteHeight;

    const originX = this.x - totalW / 2;
    const originY = this.y - totalH / 2;

    this.layout = [];

    this.notes.forEach(note => {
      const match = note.note.match(/^([A-G]#?\/?[A-Gb]*)(\d)$/);
      if (!match) return;

      const name = match[1];
      const octave = match[2];

      const col = noteNames.indexOf(name);
      const row = octaves.indexOf(octave);
      if (col < 0 || row < 0) return;

      const px = originX + col * this.noteWidth;
      const py = originY + row * this.noteHeight;

      this.layout.push({ x: px, y: py, width: this.noteWidth, height: this.noteHeight, note });

      const isSelected = this.selectedNotes.includes(note.freq);

      p.stroke(255);
      p.fill(isSelected ? '#ffaa33' : '#dddddd');
      p.strokeWeight(1);
      p.rect(px, py, this.noteWidth - 2, this.noteHeight - 2, 6);

      p.fill(0);
      p.textSize(10);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(note.note, px + this.noteWidth / 2, py + this.noteHeight / 2);
    });
  }

  handlePressed(mx, my) {
    this.layout.forEach(box => {
      const { x, y, width, height, note } = box;

      const hit = (
        mx >= x && mx <= x + width - 2 &&
        my >= y && my <= y + height - 2
      );

      if (hit) {
        if (keyIsDown(CONTROL)) {
          const i = this.selectedNotes.indexOf(note.freq);
          if (i === -1) {
            this.selectedNotes.push(note.freq);
          } else {
            this.selectedNotes.splice(i, 1);
          }
        } else {
          this.selectedNotes = [note.freq];
        }

        this.onClick(note);
      }
    });
  }

  getSelectedFrequencies() {
    return this.selectedNotes;
  }

  clearSelection() {
    this.selectedNotes = [];
  }
}
