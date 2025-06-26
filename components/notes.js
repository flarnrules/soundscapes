// Flat list of note frequencies (for dropdowns, iterating in UI)
export const noteFrequencies = [
  { note: "C0", freq: 16.35 }, { note: "C#/Db0", freq: 17.32 }, { note: "D0", freq: 18.35 }, { note: "D#/Eb0", freq: 19.45 }, { note: "E0", freq: 20.60 }, { note: "F0", freq: 21.83 }, { note: "F#/Gb0", freq: 23.12 }, { note: "G0", freq: 24.50 }, { note: "G#/Ab0", freq: 25.96 }, { note: "A0", freq: 27.50 }, { note: "A#/Bb0", freq: 29.14 }, { note: "B0", freq: 30.87 },

  { note: "C1", freq: 32.70 }, { note: "C#/Db1", freq: 34.65 }, { note: "D1", freq: 36.71 }, { note: "D#/Eb1", freq: 38.89 }, { note: "E1", freq: 41.20 }, { note: "F1", freq: 43.65 }, { note: "F#/Gb1", freq: 46.25 }, { note: "G1", freq: 49.00 }, { note: "G#/Ab1", freq: 51.91 }, { note: "A1", freq: 55.00 }, { note: "A#/Bb1", freq: 58.27 }, { note: "B1", freq: 61.74 },

  { note: "C2", freq: 65.41 }, { note: "C#/Db2", freq: 69.30 }, { note: "D2", freq: 73.42 }, { note: "D#/Eb2", freq: 77.78 }, { note: "E2", freq: 82.41 }, { note: "F2", freq: 87.31 }, { note: "F#/Gb2", freq: 92.50 }, { note: "G2", freq: 98.00 }, { note: "G#/Ab2", freq: 103.83 }, { note: "A2", freq: 110.00 }, { note: "A#/Bb2", freq: 116.54 }, { note: "B2", freq: 123.47 },

  { note: "C3", freq: 130.81 }, { note: "C#/Db3", freq: 138.59 }, { note: "D3", freq: 146.83 }, { note: "D#/Eb3", freq: 155.56 }, { note: "E3", freq: 164.81 }, { note: "F3", freq: 174.61 }, { note: "F#/Gb3", freq: 185.00 }, { note: "G3", freq: 196.00 }, { note: "G#/Ab3", freq: 207.65 }, { note: "A3", freq: 220.00 }, { note: "A#/Bb3", freq: 233.08 }, { note: "B3", freq: 246.94 },

  { note: "C4", freq: 261.63 }, { note: "C#/Db4", freq: 277.18 }, { note: "D4", freq: 293.66 }, { note: "D#/Eb4", freq: 311.13 }, { note: "E4", freq: 329.63 }, { note: "F4", freq: 349.23 }, { note: "F#/Gb4", freq: 369.99 }, { note: "G4", freq: 392.00 }, { note: "G#/Ab4", freq: 415.30 }, { note: "A4", freq: 440.00 }, { note: "A#/Bb4", freq: 466.16 }, { note: "B4", freq: 493.88 },

  { note: "C5", freq: 523.25 }, { note: "C#/Db5", freq: 554.37 }, { note: "D5", freq: 587.33 }, { note: "D#/Eb5", freq: 622.25 }, { note: "E5", freq: 659.25 }, { note: "F5", freq: 698.46 }, { note: "F#/Gb5", freq: 739.99 }, { note: "G5", freq: 783.99 }, { note: "G#/Ab5", freq: 830.61 }, { note: "A5", freq: 880.00 }, { note: "A#/Bb5", freq: 932.33 }, { note: "B5", freq: 987.77 },

  { note: "C6", freq: 1046.50 }, { note: "C#/Db6", freq: 1108.73 }, { note: "D6", freq: 1174.66 }, { note: "D#/Eb6", freq: 1244.51 }, { note: "E6", freq: 1318.51 }, { note: "F6", freq: 1396.91 }, { note: "F#/Gb6", freq: 1479.98 }, { note: "G6", freq: 1567.98 }, { note: "G#/Ab6", freq: 1661.22 }, { note: "A6", freq: 1760.00 }, { note: "A#/Bb6", freq: 1864.66 }, { note: "B6", freq: 1975.53 },

  { note: "C7", freq: 2093.00 }, { note: "C#/Db7", freq: 2217.46 }, { note: "D7", freq: 2349.32 }, { note: "D#/Eb7", freq: 2489.02 }, { note: "E7", freq: 2637.02 }, { note: "F7", freq: 2793.83 }, { note: "F#/Gb7", freq: 2959.96 }, { note: "G7", freq: 3135.96 }, { note: "G#/Ab7", freq: 3322.44 }, { note: "A7", freq: 3520.00 }, { note: "A#/Bb7", freq: 3729.31 }, { note: "B7", freq: 3951.07 },

  { note: "C8", freq: 4186.01 }, { note: "C#/Db8", freq: 4434.92 }, { note: "D8", freq: 4698.63 }, { note: "D#/Eb8", freq: 4978.03 }, { note: "E8", freq: 5274.04 }, { note: "F8", freq: 5587.65 }, { note: "F#/Gb8", freq: 5919.91 }, { note: "G8", freq: 6271.93 }, { note: "G#/Ab8", freq: 6644.88 }, { note: "A8", freq: 7040.00 }, { note: "A#/Bb8", freq: 7458.62 }, { note: "B8", freq: 7902.13 }
];

// Grouped notes by name with frequency arrays (for utilities or visualization)
export const notes = [
  { name: 'C',     freqs: [16.35, 32.70, 65.41, 130.81, 261.63, 523.25, 1046.50, 2093.00, 4186.01] },
  { name: 'C#/Db', freqs: [17.32, 34.65, 69.30, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92] },
  { name: 'D',     freqs: [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.63] },
  { name: 'D#/Eb', freqs: [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489.02, 4978.03] },
  { name: 'E',     freqs: [20.60, 41.20, 82.41, 164.81, 329.63, 659.25, 1318.51, 2637.02, 5274.04] },
  { name: 'F',     freqs: [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65] },
  { name: 'F#/Gb', freqs: [23.12, 46.25, 92.50, 185.00, 369.99, 739.99, 1479.98, 2959.96, 5919.91] },
  { name: 'G',     freqs: [24.50, 49.00, 98.00, 196.00, 392.00, 783.99, 1567.98, 3135.96, 6271.93] },
  { name: 'G#/Ab', freqs: [25.96, 51.91, 103.83, 207.65, 415.30, 830.61, 1661.22, 3322.44, 6644.88] },
  { name: 'A',     freqs: [27.50, 55.00, 110.00, 220.00, 440.00, 880.00, 1760.00, 3520.00, 7040.00] },
  { name: 'A#/Bb', freqs: [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62] },
  { name: 'B',     freqs: [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951.07, 7902.13] }
];

// Utility function for quickly getting frequency by name + octave index
export function getNoteFrequency(noteName, octave) {
  const note = notes.find(n => n.name === noteName);
  return note ? note.freqs[octave] : null;
}