// src/ui/theme.js
// Theme palette (same vibe as synth5)
const THEMES = [
  { bg:'#121212', panel:'#1b1b1b', line:'#2a2a2a', canvas:'#0e0e0e', grid:'#222', accent:'#8ab4ff', accent2:'#9be58c' },
  { bg:'#0f141a', panel:'#15202b', line:'#253341', canvas:'#0b1116', grid:'#1c2a35', accent:'#64b5f6', accent2:'#81c784' },
  { bg:'#161217', panel:'#221b25', line:'#3a2e43', canvas:'#120f14', grid:'#2a2230', accent:'#ba68c8', accent2:'#ffb74d' },
  { bg:'#12160f', panel:'#1b2215', line:'#2a3a21', canvas:'#0e120b', grid:'#1f2a18', accent:'#a5d6a7', accent2:'#ffcc80' },
  { bg:'#1a1310', panel:'#281b16', line:'#3e2a22', canvas:'#140f0c', grid:'#2b201b', accent:'#ffab91', accent2:'#ffd54f' },
];

export function applyThemeForOffset(semitones = 0){
  const octave = (semitones/12)|0;
  let idx = (octave + 2) % THEMES.length; if (idx < 0) idx += THEMES.length;
  const t = THEMES[idx];
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg);
  r.setProperty('--panel', t.panel);
  r.setProperty('--line', t.line);
  r.setProperty('--canvas', t.canvas);
  r.setProperty('--grid', t.grid);
  r.setProperty('--accent', t.accent);
  r.setProperty('--accent2', t.accent2);
}
