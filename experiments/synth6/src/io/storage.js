// src/io/storage.js
// LocalStorage-backed pattern bank + thin UI glue for the pattern grid.

const NS = "browser-synth";
const STORAGE_VERSION = 1;

const KEYS = {
  pattern: (slot) => `${NS}:v${STORAGE_VERSION}:pattern:${slot}`,
  bank: `${NS}:v${STORAGE_VERSION}:bankmeta`,
};

function assertSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 31) {
    throw new Error(`Invalid slot ${slot} (expected 0..31)`);
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ---- Minimal default snapshot (kept in sync with app schema) ----
function emptySnapshot(name = "Empty") {
  const mk = (rows, steps) => ({
    steps,
    rowsMidi: Array.from({ length: rows }, (_, i) => 60 - i), // descending placeholders
    pattern: Array.from({ length: rows }, () => Array(steps).fill(false)),
    velocities: Array(rows).fill(0.85),
  });
  return {
    name,
    updatedAt: Date.now(),
    bpm: 120,
    swing: 0,
    mode: "scale",
    keyRoot: "C",
    scaleType: "naturalMinor",
    octaveOffset: 0,
    wave: "square",
    env: { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.4 },
    filter: { type: "lowpass", cutoff: 1200, q: 0.7 },
    lfo: { rate: 4, depth: 500 },
    delay: { time: 0.25, feedback: 0.35, mix: 0.3 },
    volume: { lead: 0.9, bass: 0.9, drum: 0.9 },
    lead: mk(16, 16),          // rows will be replaced by theory at apply time
    bass: mk(16, 32),
    drums: { steps: 16, pattern: Array.from({ length: 4 }, () => Array(16).fill(false)), velocities: [0.85,0.85,0.85,0.85] },
  };
}

// ---- Core persistence API ----
export function savePatternSlot(slot, snapshot) {
  assertSlot(slot);
  const data = { ...(snapshot || emptySnapshot(`Pattern ${slot}`)), updatedAt: Date.now() };
  localStorage.setItem(KEYS.pattern(slot), JSON.stringify(data));
  // update bank meta
  const bank = safeParse(localStorage.getItem(KEYS.bank)) || {};
  bank[slot] = { name: data.name || `Pattern ${slot}`, updatedAt: data.updatedAt };
  localStorage.setItem(KEYS.bank, JSON.stringify(bank));
  return data;
}

export function loadPatternSlot(slot) {
  assertSlot(slot);
  const json = localStorage.getItem(KEYS.pattern(slot));
  return json ? safeParse(json) : emptySnapshot(`Pattern ${slot}`);
}

export function deletePatternSlot(slot) {
  assertSlot(slot);
  const existed = !!localStorage.getItem(KEYS.pattern(slot));
  localStorage.removeItem(KEYS.pattern(slot));
  const bank = safeParse(localStorage.getItem(KEYS.bank)) || {};
  delete bank[slot];
  localStorage.setItem(KEYS.bank, JSON.stringify(bank));
  return existed;
}

export function listPatternBank() {
  const bank = safeParse(localStorage.getItem(KEYS.bank)) || {};
  return Object.keys(bank)
    .map((k) => ({ slot: +k, name: bank[k].name, updatedAt: bank[k].updatedAt }))
    .sort((a, b) => a.slot - b.slot);
}

export function duplicateSlotUI(from, to) {
  assertSlot(from); assertSlot(to);
  const src = loadPatternSlot(from);
  const clone = { ...src, name: `${src.name} (dup)`, updatedAt: Date.now() };
  return savePatternSlot(to, clone);
}

// ---- Lightweight UI binder for the pattern grid ----
/**
 * initStorage wires the visible bank grid (#patternGrid) and exposes callbacks.
 * It renders 16 slots (0..15). Click behavior for launching is handled in index.js.
 */
export function initStorage({ onLoadSlot, onSaveSlot, onDeleteSlot, onDuplicate }) {
  const grid = document.getElementById("patternGrid");
  if (!grid) return;

  function fmt(ts) {
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`;
    }

  function refreshGrid() {
    const meta = listPatternBank();
    const metaBySlot = new Map(meta.map(m => [m.slot, m]));
    const slots = Array.from({ length: 16 }, (_, i) => i);
    grid.innerHTML = "";
    for (const s of slots) {
      const cell = document.createElement("button");
      cell.className = "patternSlot";
      cell.dataset.slot = String(s);
      const m = metaBySlot.get(s);
      const name = m?.name || `Pattern ${s}`;
      const when = m?.updatedAt ? ` • ${fmt(m.updatedAt)}` : "";
      cell.title = `${name}${when}`;
      cell.innerHTML = `<strong>${s}</strong><span>${name}</span>`;
      grid.appendChild(cell);
    }
  }

  refreshGrid();

  // Optional: alt/ctrl interactions on the grid for quick ops
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-slot]");
    if (!btn) return;
    const slot = +btn.dataset.slot;

    // Plain click: index.js handles "requestPatternLaunch" externally.
    // Alt-click: Save to slot
    // Ctrl/Cmd-click: Load immediately
    // Shift+Del (or Shift+click): Delete slot
    if (e.altKey) {
      const snap = window.serializeFullState ? window.serializeFullState() : null;
      if (snap && onSaveSlot) { onSaveSlot(slot); refreshGrid(); }
    } else if (e.ctrlKey || e.metaKey) {
      if (onLoadSlot) onLoadSlot(slot);
    } else if (e.shiftKey) {
      if (onDeleteSlot) { onDeleteSlot(slot); refreshGrid(); }
    }
  });

  // Public helpers for external UI (e.g., dedicated Save/Load buttons)
  initStorage.refreshGrid = refreshGrid;
}
