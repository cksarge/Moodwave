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
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

async function start() {
  // engine.start() creates the AudioContext, so it must run inside this click handler.
  try {
    await engine.start(mood);
  } catch (err) {
    console.error('moodwave: could not start audio', err);
  }
  started = true;
  welcome.classList.add('is-hidden');
  controls.hidden = false;
  updatePlayButton();
  wake();
}

function togglePlay() {
  if (engine.isPlaying) engine.pause();
  else engine.play();
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
  input.style.setProperty('--fill', `${input.value}%`);
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

const fullscreenSupported = document.fullscreenEnabled || document.webkitFullscreenEnabled;
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;

function toggleFullscreen() {
  const result = fullscreenElement()
    ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
    : (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
  if (result && result.catch) result.catch(() => {});
}

function updateFullscreenButton() {
  const active = !!fullscreenElement();
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
    const busy = controls.matches(':hover') || controls.querySelector(':focus-visible');
    if (started && !busy) document.body.classList.add('idle');
    else wake();
  }, IDLE_MS);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts: Space play/pause, 1–9 moods, N next shapes, F fullscreen, S screenshot
// ---------------------------------------------------------------------------

function onKeyDown(e) {
  wake();
  if (!started || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === 'Space') {
    // Let focused buttons handle Space themselves.
    if (e.target.closest('button, input')) return;
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'f' || e.key === 'F') {
    if (fullscreenSupported) toggleFullscreen();
  } else if (e.key === 's' || e.key === 'S') {
    saveScreenshot();
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

  startBtn.addEventListener('click', start);
  playBtn.addEventListener('click', togglePlay);
  volumeInput.addEventListener('input', onVolume);
  intensityInput.addEventListener('input', onIntensity);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  screenshotBtn.addEventListener('click', saveScreenshot);
  nextShapeBtn.addEventListener('click', () => visuals.nextShape());
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });

  // Tap or click the canvas for a burst of particles.
  canvas.addEventListener('pointerdown', (e) => visuals.burst(e.clientX, e.clientY));
}

init();
