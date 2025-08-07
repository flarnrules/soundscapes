const textInput = document.getElementById('text');
const voiceSelect = document.getElementById('voiceSelect');
const speakBtn = document.getElementById('speak');

const layers = document.getElementById('layers');
const delay = document.getElementById('delay');
const detune = document.getElementById('detune');
const spread = document.getElementById('spread');

const updateVal = (id, el) => el.addEventListener('input', () => {
  document.getElementById(id).textContent = el.value;
});
updateVal('layersVal', layers);
updateVal('delayVal', delay);
updateVal('detuneVal', detune);
updateVal('spreadVal', spread);

let voices = [];

function populateVoices() {
  voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  voices.forEach(voice => {
    const opt = document.createElement('option');
    opt.textContent = `${voice.name} (${voice.lang})`;
    opt.setAttribute('data-name', voice.name);
    voiceSelect.appendChild(opt);
  });
}
populateVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = populateVoices;
}

async function synthesizeToBuffer(text, selectedVoiceName) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voices.find(v => v.name === selectedVoiceName);
    utterance.volume = 1;

    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const recorder = new MediaRecorder(dest.stream);

    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks);
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      resolve({ buffer: audioBuffer, context: audioCtx });
    };

    const audio = new Audio();
    audio.srcObject = dest.stream;
    audio.play();

    speechSynthesis.speak(utterance);
    recorder.start();

    utterance.onend = () => {
      recorder.stop();
    };
  });
}

function playPhasedVoice(audioBuffer, context, options) {
  const now = context.currentTime;

  for (let i = 0; i < options.layers; i++) {
    const source = context.createBufferSource();
    source.buffer = audioBuffer;

    const gain = context.createGain();
    const panner = context.createStereoPanner();

    const pitchShift = ((i - options.layers / 2) / options.layers) * options.detune;
    const panValue = ((i / (options.layers - 1)) - 0.5) * 2 * options.spread;

    source.playbackRate.value = 1 + pitchShift / 100;
    panner.pan.value = panValue;

    source.connect(gain).connect(panner).connect(context.destination);

    // Envelope shaping
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.3);
    gain.gain.linearRampToValueAtTime(0, now + audioBuffer.duration + 0.1);

    source.start(now + i * options.delay / 1000);
  }
}

speakBtn.addEventListener('click', async () => {
  const text = textInput.value;
  const voiceName = voiceSelect.selectedOptions[0].getAttribute('data-name');

  const { buffer, context } = await synthesizeToBuffer(text, voiceName);

  playPhasedVoice(buffer, context, {
    layers: parseInt(layers.value),
    delay: parseFloat(delay.value),
    detune: parseFloat(detune.value),
    spread: parseFloat(spread.value)
  });
});
