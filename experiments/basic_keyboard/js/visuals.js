function setup() {
  createCanvas(windowWidth, windowHeight)
  colorMode(HSL)
  noStroke()

  window.isRecording = false
  window.isPlaying = false
  window.recordedNotes = []
  window.playbackStartTime = null
}

function draw() {
  background(0)

  drawBars()
  drawTimeline()
  drawButtons()
  handlePlayback()
}

function drawBars() {
  if (!window.analyser) return

  const values = window.analyser.getValue()
  const barCount = values.length
  const barWidth = width / barCount

  for (let i = 0; i < barCount; i++) {
    const amp = values[i] / 100 + 1
    const barHeight = amp * height * 0.4
    const x = i * barWidth
    const y = height - barHeight

    fill((i * 10) % 360, 100, 50)
    rect(x, y, barWidth - 2, barHeight)

    fill(0, 0, 100)
    rect(x, y, barWidth - 2, 5)
  }
}

function drawTimeline() {
  const currentTime = Tone.now()

  // Live input notes
  if (window.timelineNotes) {
    for (let note of window.timelineNotes) {
      const t = currentTime - note.time
      const x = t * 200
      fill(note.color)
      rect(x, note.y, 12, 12)
    }
  }

  // Playback notes
  if (window.isPlaying && window.recordedNotes.length > 0) {
    const elapsed = currentTime - window.playbackStartTime
    for (let note of window.recordedNotes) {
      const t = elapsed - note.timeOffset
      if (t > 0 && t < 2) {
        const x = t * 200
        fill(note.color)
        rect(x, note.y, 12, 12)
      }
    }
  }
}

function drawButtons() {
  // Record (red circle)
  fill(window.isRecording ? 'white' : 'red')
  ellipse(width - 70, 40, 20)

  // Play (green triangle)
  fill('green')
  triangle(width - 45, 30, width - 45, 50, width - 30, 40)

  // Stop (blue square)
  fill('blue')
  rect(width - 20, 30, 12, 12)
}

function mousePressed() {
  const x = mouseX
  const y = mouseY

  // Record
  if (dist(x, y, width - 70, 40) < 10) {
    window.isRecording = !window.isRecording
    if (window.isRecording) {
      window.recordedNotes = []
      window.recordingStartTime = Tone.now()
      console.log("🔴 Recording started")
    } else {
      console.log("🔴 Recording stopped")
    }
    return
  }

  // Play
  if (x > width - 45 && x < width - 30 && y > 30 && y < 50) {
    if (window.recordedNotes.length > 0) {
      window.isPlaying = true
      window.playbackStartTime = Tone.now()
      for (let n of window.recordedNotes) n.played = false
      console.log("▶️ Playback started")
    }
    return
  }

  // Stop
  if (x > width - 20 && x < width - 8 && y > 30 && y < 42) {
    window.isPlaying = false
    console.log("⏹️ Playback stopped")
    return
  }
}

function handlePlayback() {
  if (!window.isPlaying) return

  const currentTime = Tone.now()
  for (let note of window.recordedNotes) {
    const t = currentTime - window.playbackStartTime
    if (Math.abs(t - note.timeOffset) < 0.02 && !note.played) {
      note.played = true
      if (window.synth) {
        window.synth.triggerAttackRelease(note.note, "8n")
      }
    }
  }
}
