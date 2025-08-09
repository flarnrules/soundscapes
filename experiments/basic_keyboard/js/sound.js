document.body.addEventListener("click", async () => {
  await Tone.start()
  console.log("🔊 Audio Ready")

  window.synth = new Tone.PolySynth().toDestination()
  window.analyser = new Tone.Analyser("fft", 32)
  window.synth.connect(window.analyser)

  const noteMap = {
    a: "C4", s: "D4", d: "E4", f: "F4",
    g: "G4", h: "A4", j: "B4", k: "C5"
  }

  window.heldKeys = new Set()
  window.timelineNotes = []

  window.addEventListener("keydown", (e) => {
    const note = noteMap[e.key]
    if (note && !window.heldKeys.has(e.key)) {
      window.synth.triggerAttack(note)
      window.heldKeys.add(e.key)

      const now = Tone.now()
      const visualNote = {
        key: e.key,
        note,
        time: now,
        y: mapNoteToY(note),
        color: mapNoteToColor(note),
      }
      window.timelineNotes.push(visualNote)

      if (window.isRecording) {
        const timeOffset = now - window.recordingStartTime
        window.recordedNotes.push({
          note,
          timeOffset,
          y: visualNote.y,
          color: visualNote.color,
          played: false
        })
      }
    }
  })

  window.addEventListener("keyup", (e) => {
    const note = noteMap[e.key]
    if (note) {
      window.synth.triggerRelease(note)
      window.heldKeys.delete(e.key)
    }
  })
})

// Utility: map note to vertical screen position
function mapNoteToY(note) {
  const scale = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]
  const index = scale.indexOf(note)
  return map(index, 0, scale.length - 1, window.innerHeight * 0.2, window.innerHeight * 0.8)
}

// Utility: map note to color
function mapNoteToColor(note) {
  const hues = {
    C4: 200,
    D4: 220,
    E4: 240,
    F4: 260,
    G4: 280,
    A4: 320,
    B4: 350,
    C5: 50
  }
  return `hsl(${hues[note] || 0}, 80%, 60%)`
}
