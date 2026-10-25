/**
 * main.js — app setup: builds the UI from MOODS, wires the controls, and
 * connects the audio engine to the visuals.
 */
import { MOODS, createEngine } from './audio.js';
import { createVisuals } from './visuals.js';

const IDLE_MS = 3000; // hide controls after this long without input

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const welcome = $('welcome');
const controls = $('controls');
const startBtn = $('start-btn');
const playBtn = $('play-btn');
const volumeInput = $('volume');
const intensityInput = $('intensity');
const fullscreenBtn = $('fullscreen-btn');
const screenshotBtn = $('screenshot-btn');
const nextShapeBtn = $('next-shape-btn');
const settingsBtn = $('settings-btn');
const settingsPanel = $('settings');
const sourceButtons = settingsPanel.querySelectorAll('[data-source]');
const moodTuning = $('mood-tuning');
const tempoInput = $('tempo');
const tempoValue = $('tempo-value');
const keySelect = $('key');
const fileInput = $('file-input');

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const engine = createEngine();
// The visuals pull analyser levels from the engine every frame.
const visuals = createVisuals(canvas, engine.getLevels);

const moodKeys = Object.keys(MOODS);
let mood = moodKeys[0];
let started = false;

// ---------------------------------------------------------------------------
// Moods
// ---------------------------------------------------------------------------

function buildMoodButtons(container) {
  moodKeys.forEach((key, i) => {
    const { label, visual } = MOODS[key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mood-btn';
    btn.dataset.mood = key;
    btn.textContent = label;
    btn.title = `${label} (${i + 1})`;
    btn.style.setProperty('--c1', visual.palette[0]);
    btn.style.setProperty('--c2', visual.palette[1]);
    btn.addEventListener('click', () => selectMood(key));
    container.append(btn);
  });
}

function selectMood(key) {
  mood = key;
  engine.setMood(key);
  visuals.setMood(key);

  for (const btn of document.querySelectorAll('.mood-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mood === key));
  }
  // Tint the UI to match the mood.
  const [a, b] = MOODS[key].visual.palette;
  document.documentElement.style.setProperty('--accent', a);
  document.documentElement.style.setProperty('--accent-2', b);
  refreshTuning();
}

// ---------------------------------------------------------------------------
// Per-mood tempo & key
// ---------------------------------------------------------------------------

function scaleName(scale) {
  if (scale[2] === 3) return 'minor';
  if (scale[3] === 6) return 'lydian';
  return 'major';
}

/** Shows the current mood's tempo and key in the settings panel. */
function refreshTuning() {
  const { bpm, root } = engine.getMoodSettings(mood);
  const mode = scaleName(MOODS[mood].music.scale);
  tempoInput.value = bpm;
  tempoValue.textContent = `${bpm} BPM`;
  paintSlider(tempoInput);
  keySelect.replaceChildren(...NOTE_NAMES.map((name, pitchClass) => new Option(`${name} ${mode}`, String(pitchClass))));
  keySelect.value = String(root % 12);
}

function onTempo() {
  const bpm = Number(tempoInput.value);
  engine.setMoodSettings(mood, { bpm });
  tempoValue.textContent = `${bpm} BPM`;
  paintSlider(tempoInput);
}

function onKey() {
  const base = MOODS[mood].music.root;
  // Transpose to the chosen note by the smallest step (−6…+5 semitones) to stay in the same register.
  const shift = ((Number(keySelect.value) - (base % 12) + 18) % 12) - 6;
  engine.setMoodSettings(mood, { root: base + shift });
}

function resetTuning() {
  engine.resetMoodSettings(mood);
  refreshTuning();
}

// ---------------------------------------------------------------------------
// Sound source: generated music, microphone or an audio file
// ---------------------------------------------------------------------------

function setStatus(message) {
  $('welcome-status').textContent = message;
  $('settings-status').textContent = message;
}

async function useSource(type, file) {
  if (type === 'mic') setStatus('Waiting for microphone permission…');
  try {
    await engine.setSource(type, file);
    if (type === 'mic') setStatus('Listening to your microphone.');
    else if (type === 'file') setStatus(`Playing ${file.name}`);
    else setStatus('');
  } catch (err) {
    console.error('moodwave: could not switch source', err);
    if (type === 'mic') setStatus('Microphone unavailable. Allow access in your browser (the site must be on https or localhost).');
    else if (type === 'file' && err.name === 'NotAllowedError') setStatus('Press play to start the file.');
    else if (type === 'file') setStatus(`Couldn't play ${file.name}. Try an MP3, WAV or M4A file.`);
  }
  updateSourceButtons();
  updatePlayButton();
  // From the welcome screen, enter the app once the source is actually active.
  if (engine.source === type) enterApp();
}

function pickFile() {
  // Create the AudioContext during this click; the file itself arrives later in a 'change' event.
  engine.unlock();
  fileInput.value = '';
  fileInput.click();
}

function onFileChosen() {
  const file = fileInput.files[0];
  if (file) void useSource('file', file);
}

function updateSourceButtons() {
  for (const btn of sourceButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.source === engine.source));
  }
  // Tempo and key only apply to the generated music.
  moodTuning.disabled = engine.source !== 'synth';
}

function toggleSettings(open = settingsPanel.hidden) {
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function enterApp() {
  if (started) return;
  started = true;
  welcome.classList.add('is-hidden');
  controls.hidden = false;
  updatePlayButton();
  wake();
}

function togglePlay() {
  if (engine.isPlaying) engine.pause();
  else engine.play().catch((err) => console.error('moodwave: could not resume', err));
  updatePlayButton();
}

function updatePlayButton() {
  const playing = engine.isPlaying;
  playBtn.dataset.playing = String(playing);
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

/** Updates the filled part of a range track (styled in style.css via --fill). */
function paintSlider(input) {
  const percent = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${percent}%`);
}

function onVolume() {
  engine.setVolume(volumeInput.value / 100);
  paintSlider(volumeInput);
}

function onIntensity() {
  visuals.setIntensity(intensityInput.value / 100);
  paintSlider(intensityInput);
}

// ---------------------------------------------------------------------------
// Fullscreen & screenshot
// ---------------------------------------------------------------------------

// iPhone Safari has no Fullscreen API, so the button is hidden there.
const fullscreenSupported = document.fullscreenEnabled;

function toggleFullscreen() {
  const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  request.catch(() => {}); // e.g. blocked by the browser; nothing to do
}

function updateFullscreenButton() {
  const active = !!document.fullscreenElement;
  fullscreenBtn.dataset.active = String(active);
  fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
}

async function saveScreenshot() {
  const blob = await visuals.snapshot();
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `moodwave-${mood}-${Date.now()}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  // Camera-flash feedback.
  document.body.classList.remove('flash');
  void document.body.offsetWidth; // restart the CSS animation
  document.body.classList.add('flash');
}

// ---------------------------------------------------------------------------
// Idle: fade the controls out when the mouse stops moving
// ---------------------------------------------------------------------------

let idleTimer = 0;

function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const busy = controls.matches(':hover') || controls.querySelector(':focus-visible') || !settingsPanel.hidden;
    if (started && !busy) document.body.classList.add('idle');
    else wake();
  }, IDLE_MS);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts: Space play/pause, 1–9 moods, N next shapes, F fullscreen, S screenshot, Esc close settings
// ---------------------------------------------------------------------------

function onKeyDown(e) {
  wake();
  if (!started || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') return toggleSettings(false);
  if (e.target.closest('select')) return; // let the key picker use the keyboard

  if (e.code === 'Space') {
    // Let focused buttons handle Space themselves.
    if (e.target.closest('button, input')) return;
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'f' || e.key === 'F') {
    if (fullscreenSupported) toggleFullscreen();
  } else if (e.key === 's' || e.key === 'S') {
    void saveScreenshot();
  } else if (e.key === 'n' || e.key === 'N') {
    visuals.nextShape();
  } else {
    const n = Number(e.key);
    if (n >= 1 && n <= moodKeys.length) selectMood(moodKeys[n - 1]);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  buildMoodButtons($('welcome-moods'));
  buildMoodButtons($('control-moods'));

  // Respect reduced-motion preferences with a calmer default.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) intensityInput.value = 25;

  onVolume();
  onIntensity();
  selectMood(mood);
  visuals.start(); // visuals preview behind the welcome screen; audio waits for Start

  if (!fullscreenSupported) fullscreenBtn.hidden = true;

  startBtn.addEventListener('click', () => useSource('synth'));
  $('welcome-mic').addEventListener('click', () => useSource('mic'));
  $('welcome-file').addEventListener('click', pickFile);
  fileInput.addEventListener('change', onFileChosen);
  for (const btn of sourceButtons) {
    btn.addEventListener('click', () => (btn.dataset.source === 'file' ? pickFile() : useSource(btn.dataset.source)));
  }
  settingsBtn.addEventListener('click', () => toggleSettings());
  tempoInput.addEventListener('input', onTempo);
  keySelect.addEventListener('change', onKey);
  $('reset-mood').addEventListener('click', resetTuning);
  playBtn.addEventListener('click', togglePlay);
  volumeInput.addEventListener('input', onVolume);
  intensityInput.addEventListener('input', onIntensity);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  screenshotBtn.addEventListener('click', saveScreenshot);
  nextShapeBtn.addEventListener('click', () => visuals.nextShape());
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });

  // Tap or click the canvas for a burst of particles.
  canvas.addEventListener('pointerdown', (e) => visuals.burst(e.clientX, e.clientY));
}

init();
