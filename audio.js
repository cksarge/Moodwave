/**
 * audio.js — live music generation with the Web Audio API.
 *
 * Everything you hear is synthesized in the browser: oscillators, filters,
 * gain envelopes and noise-based drums. No audio files are loaded.
 *
 * This module also owns MOODS, the single config object that describes every
 * mood (both its music and its look). visuals.js and main.js import it.
 */

// ---------------------------------------------------------------------------
// Mood configuration
// ---------------------------------------------------------------------------

// Scales as semitone offsets from the root note.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/*
 * Each mood has two parts:
 *
 * music:
 *   bpm          tempo
 *   root         MIDI note of the key's tonic (60 = middle C)
 *   scale        semitone offsets (see above)
 *   progression  chord roots as scale degrees (0 = I, 3 = IV, 4 = V, 5 = vi ...), one per bar
 *   seventh      add the 7th to every chord
 *   swing        0–0.3, delays every other 16th note
 *   reverb       0–1, reverb send amount
 *   fills        play a snare fill every 4th bar
 *   pad / bass / lead / arp   instrument settings (null = not used)
 *     type        oscillator waveform
 *     octave      octave offset from the root
 *     gain        loudness
 *     pattern     16 steps per bar. pad: 'x' = play chord. bass: '1' root, '3' third, '5' fifth, '8' octave
 *     dur         note length in 16th-note steps
 *     every       (lead/arp) only play on steps divisible by this
 *     density     (lead) 0–1 chance a melody slot gets a note
 *   drums        16-step strings: 'x' = hit, '-' = quiet ghost note (sometimes skipped), '.' = rest
 *
 * visual:
 *   shapes       renderers in visuals.js to cycle through, in order. Available:
 *                circles, ripples, waves, geometric, warp, grid, spectrum,
 *                glow, bubbles, swirl, galaxy, confetti
 *   cycle        (optional) seconds before switching to the next shape set (default 20)
 *   palette      colors for shapes (the first two also tint the UI)
 *   background   canvas background color
 *   trail        0–1, how fast old frames fade (lower = longer trails)
 *   speed        base movement speed
 */
export const MOODS = {
  calm: {
    label: 'Calm',
    music: {
      bpm: 64, root: 62, scale: MAJOR, progression: [0, 3, 5, 4], seventh: false, swing: 0, reverb: 0.55, fills: false,
      pad: { type: 'sine', octave: -1, gain: 0.16, pattern: 'x', dur: 16, attack: 1.6, release: 2.5, cutoff: 1800, detune: 6, voices: 2 },
      bass: { type: 'sine', octave: -2, gain: 0.24, pattern: '1.......5.......', dur: 6, cutoff: 600 },
      lead: { type: 'sine', octave: 0, gain: 0.07, every: 4, density: 0.45, dur: 3, attack: 0.08, release: 1.2, cutoff: 3000 },
      arp: null,
      drums: { kick: 'x...............', snare: '', hat: '', gain: 0.5 },
    },
    visual: { shapes: ['circles', 'ripples', 'waves'], palette: ['#7fb3ff', '#a99cff', '#5ee0e6', '#c9d6ff'], background: '#060b1c', trail: 0.08, speed: 0.35 },
  },

  energetic: {
    label: 'Energetic',
    music: {
      bpm: 128, root: 57, scale: MAJOR, progression: [5, 3, 0, 4], seventh: false, swing: 0, reverb: 0.18, fills: true,
      pad: { type: 'sawtooth', octave: 0, gain: 0.07, pattern: 'x.....x...x.....', dur: 1.2, attack: 0.01, release: 0.25, cutoff: 1600, detune: 12, voices: 2 },
      bass: { type: 'sawtooth', octave: -2, gain: 0.2, pattern: '1.1.1.1.1.1.5.8.', dur: 0.9, cutoff: 700 },
      lead: { type: 'square', octave: 1, gain: 0.035, every: 2, density: 0.35, dur: 1.5, attack: 0.005, release: 0.12, cutoff: 4000 },
      arp: { type: 'square', octave: 0, gain: 0.04, every: 1, pattern: 'updown', dur: 0.8, cutoff: 3200 },
      drums: { kick: 'x...x...x...x...', snare: '....x.......x..-', hat: '--x---x---x---x-', gain: 0.9 },
    },
    visual: { shapes: ['geometric', 'warp', 'grid', 'spectrum'], palette: ['#ff2e88', '#ff7a1a', '#ffe500', '#ff4fd8'], background: '#0d0410', trail: 0.22, speed: 1 },
  },

  dreamy: {
    label: 'Dreamy',
    music: {
      bpm: 76, root: 65, scale: LYDIAN, progression: [0, 1, 5, 3], seventh: true, swing: 0, reverb: 0.8, fills: false,
      pad: { type: 'triangle', octave: -1, gain: 0.14, pattern: 'x', dur: 16, attack: 2.2, release: 3, cutoff: 2200, detune: 10, voices: 2 },
      bass: { type: 'triangle', octave: -2, gain: 0.18, pattern: '1...............', dur: 10, cutoff: 500 },
      lead: { type: 'sine', octave: 1, gain: 0.06, every: 2, density: 0.3, dur: 4, attack: 0.01, release: 2, cutoff: 6000 },
      arp: { type: 'sine', octave: 1, gain: 0.025, every: 4, pattern: 'up', dur: 3, cutoff: 5000 },
      drums: { kick: 'x.........x.....', snare: '', hat: '....-.......-...', gain: 0.35 },
    },
    visual: { shapes: ['glow', 'bubbles', 'ripples'], palette: ['#ffc8dd', '#bde0fe', '#cdb4db', '#a2d2ff', '#fff1c1'], background: '#120e1f', trail: 0.08, speed: 0.25 },
  },

  moody: {
    label: 'Moody',
    music: {
      bpm: 70, root: 50, scale: MINOR, progression: [0, 5, 3, 4], seventh: true, swing: 0.05, reverb: 0.45, fills: false,
      pad: { type: 'sawtooth', octave: 0, gain: 0.08, pattern: 'x', dur: 16, attack: 1.2, release: 2, cutoff: 650, detune: 14, voices: 2 },
      bass: { type: 'sawtooth', octave: -1, gain: 0.3, pattern: '1.....1...5.....', dur: 3, cutoff: 280 },
      lead: { type: 'triangle', octave: 1, gain: 0.05, every: 4, density: 0.3, dur: 3, attack: 0.02, release: 1, cutoff: 1800 },
      arp: null,
      drums: { kick: 'x.........x.....', snare: '........x.......', hat: '..-...-...-...-.', gain: 0.75 },
    },
    visual: { shapes: ['swirl', 'galaxy', 'waves'], palette: ['#7b2cbf', '#2ec4b6', '#5b2a86', '#3a0ca3', '#1b998b'], background: '#05030a', trail: 0.08, speed: 0.5 },
  },

  happy: {
    label: 'Happy',
    music: {
      bpm: 116, root: 60, scale: MAJOR, progression: [0, 4, 5, 3], seventh: false, swing: 0.1, reverb: 0.2, fills: true,
      pad: { type: 'triangle', octave: 0, gain: 0.08, pattern: '..x...x...x...x.', dur: 1.5, attack: 0.01, release: 0.2, cutoff: 2500, detune: 6, voices: 1 },
      bass: { type: 'square', octave: -1, gain: 0.12, pattern: '1...5.8.1...5.3.', dur: 1.5, cutoff: 900 },
      lead: { type: 'square', octave: 1, gain: 0.04, every: 2, density: 0.65, dur: 1.5, attack: 0.005, release: 0.15, cutoff: 3500 },
      arp: null,
      drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', gain: 0.85 },
    },
    visual: { shapes: ['confetti', 'bubbles', 'spectrum'], palette: ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff924c'], background: '#1a0b14', trail: 0.25, speed: 1 },
  },
};

// ---------------------------------------------------------------------------
// Music helpers
// ---------------------------------------------------------------------------

const LOOKAHEAD = 0.12;   // seconds of audio scheduled ahead of time
const TICK_MS = 25;       // how often the scheduler wakes up
const CROSSFADE = 1.5;    // seconds to fade between moods
const MOTIF_STEPS = 32;   // melody motifs are two bars long

// Bass pattern characters → scale-degree offset from the chord root.
const BASS_OFFSETS = { 1: 0, 3: 2, 5: 4, 8: 7 };
// Melody notes are picked relative to the chord root; chord tones are weighted heavier.
const MELODY_OFFSETS = [0, 0, 2, 2, 4, 4, 7, 1, 3, 5, -1, -3];
const ARP_SEQUENCES = { up: [0, 2, 4, 7], updown: [0, 2, 4, 7, 4, 2] };

const midiToFreq = (note) => 440 * Math.pow(2, (note - 69) / 12);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Converts a scale degree (can be negative or past the octave) to a MIDI note. */
function degreeToMidi(music, degree, octave = 0) {
  const len = music.scale.length;
  const oct = Math.floor(degree / len);
  return music.root + music.scale[degree - oct * len] + 12 * (oct + octave);
}

/** A 2-bar melody made of offsets from the current chord root (null = rest). */
function makeMotif(lead) {
  const motif = new Array(MOTIF_STEPS).fill(null);
  if (!lead) return motif;
  for (let i = 0; i < MOTIF_STEPS; i += lead.every) {
    if (Math.random() < lead.density) motif[i] = pick(MELODY_OFFSETS);
  }
  motif[0] = motif[0] ?? 0; // always start the phrase on a note
  return motif;
}

/** Changes a couple of notes so the melody stays recognizable but never loops exactly. */
function mutateMotif(motif, lead) {
  if (!lead) return;
  const slots = MOTIF_STEPS / lead.every;
  for (let n = 0; n < 2; n++) {
    const i = Math.floor(Math.random() * slots) * lead.every;
    motif[i] = Math.random() < lead.density ? pick(MELODY_OFFSETS) : null;
  }
}

/** Drum pattern character → gain multiplier (0 = no hit). */
function drumHit(pattern, step) {
  const ch = pattern && pattern[step];
  if (ch === 'x') return 1;
  if (ch === '-') return Math.random() < 0.7 ? 0.35 : 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Creates the audio engine. Nothing touches the AudioContext until start()
 * is called from a user gesture (browsers block autoplay otherwise).
 */
export function createEngine() {
  let ctx = null;
  let master, analyser, reverb, noise, freqData;
  let players = [];        // one per mood; more than one only during a crossfade
  let currentKey = Object.keys(MOODS)[0];
  let volume = 0.7;
  let paused = true;
  let suspendTimer = 0;

  // Analysis state, reused every frame to avoid garbage.
  const levels = { volume: 0, bass: 0, mid: 0, treble: 0, bassHit: false, spectrum: new Uint8Array(0) };
  let bassAvg = 0;
  let lastHit = 0;

  // ---- Audio graph -------------------------------------------------------

  // players → master → compressor → analyser → speakers
  //        ↘ reverb ↗
  function buildGraph() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();

    master = ctx.createGain();
    master.gain.value = 0;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    levels.spectrum = freqData; // raw 0–255 bins, refreshed by getLevels()

    master.connect(compressor).connect(analyser).connect(ctx.destination);

    reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(3.2, 2.5);
    reverb.connect(master);

    noise = makeNoise(1);
  }

  /** A synthetic reverb impulse: stereo noise with an exponential decay. */
  function makeImpulse(seconds, decay) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function makeNoise(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // ---- Instruments -------------------------------------------------------

  /** Generic synth voice: oscillator(s) → lowpass → gain envelope → player bus. */
  function tone(p, { freq, time, dur, type = 'sine', gain = 0.1, attack = 0.01, release = 0.2, cutoff = 8000, detune = 0, voices = 1 }) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;

    const env = ctx.createGain();
    const peakAt = time + attack;
    const holdUntil = Math.max(peakAt, time + dur);
    const end = holdUntil + release;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain / voices, peakAt);
    env.gain.setValueAtTime(gain / voices, holdUntil);
    env.gain.linearRampToValueAtTime(0, end);

    filter.connect(env).connect(p.bus);

    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      // Spread voices evenly across ±detune cents for a wider sound.
      if (voices > 1) osc.detune.value = (i / (voices - 1) - 0.5) * 2 * detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(end + 0.05);
      if (i === 0) osc.onended = () => env.disconnect();
    }
  }

  /** Kick: a sine wave with a fast downward pitch sweep. */
  function kick(p, time, gain) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    osc.connect(env).connect(p.bus);
    osc.start(time);
    osc.stop(time + 0.45);
    osc.onended = () => env.disconnect();
  }

  /** Filtered noise burst, used for snares and hi-hats. */
  function noiseHit(p, time, gain, highpass, length) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + length);
    src.connect(filter).connect(env).connect(p.bus);
    src.start(time, Math.random() * 0.5, length + 0.02);
    src.onended = () => env.disconnect();
  }

  function snare(p, time, gain) {
    noiseHit(p, time, gain * 0.6, 1200, 0.18);
    tone(p, { freq: 185, time, dur: 0.02, type: 'triangle', gain: gain * 0.3, attack: 0.001, release: 0.08 });
  }

  function hat(p, time, gain) {
    noiseHit(p, time, gain * 0.25, 7000, 0.05);
  }

  // ---- Sequencer ---------------------------------------------------------

  /** A player plays one mood on its own gain bus so moods can crossfade. */
  function createPlayer(key) {
    const music = MOODS[key].music;
    const now = ctx.currentTime;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(1, now + CROSSFADE);
    const wet = ctx.createGain();
    wet.gain.value = music.reverb;
    bus.connect(master);
    bus.connect(wet).connect(reverb);

    return { key, music, bus, wet, step: 0, bar: -1, chord: 0, inversion: false, motif: makeMotif(music.lead), nextTime: now + 0.05, retireAt: Infinity };
  }

  function startBar(p) {
    const m = p.music;
    p.bar++;
    p.chord = m.progression[p.bar % m.progression.length];
    // Small variations so the loop doesn't feel mechanical:
    // sometimes swap the last chord for its relative (a third up)...
    if (p.bar % m.progression.length === m.progression.length - 1 && Math.random() < 0.25) p.chord += 2;
    // ...sometimes revoice the pad with the root moved up an octave...
    p.inversion = Math.random() < 0.25;
    // ...and every 4 bars rewrite a couple of melody notes.
    if (p.bar > 0 && p.bar % 4 === 0) mutateMotif(p.motif, m.lead);
  }

  function scheduleStep(p, t) {
    const m = p.music;
    const s = p.step % 16;
    const stepDur = 60 / m.bpm / 4;
    if (s === 0) startBar(p);

    // Drums
    const d = m.drums;
    const fill = m.fills && p.bar % 4 === 3 && s >= 12;
    const k = drumHit(d.kick, s);
    const sn = fill ? 0.3 + (s - 12) * 0.15 : drumHit(d.snare, s);
    const h = drumHit(d.hat, s);
    if (k) kick(p, t, k * d.gain);
    if (sn) snare(p, t, sn * d.gain);
    if (h) hat(p, t, h * d.gain);

    // Pad chord
    const pad = m.pad;
    if (pad && pad.pattern[s] === 'x') {
      const intervals = m.seventh ? [0, 2, 4, 6] : [0, 2, 4];
      for (const [i, interval] of intervals.entries()) {
        const degree = p.chord + interval + (i === 0 && p.inversion ? 7 : 0);
        tone(p, { ...pad, freq: midiToFreq(degreeToMidi(m, degree, pad.octave)), time: t, dur: pad.dur * stepDur, gain: pad.gain / intervals.length });
      }
    }

    // Bass
    const bassCh = m.bass && m.bass.pattern[s];
    if (bassCh in BASS_OFFSETS) {
      const b = m.bass;
      tone(p, { type: b.type, gain: b.gain, cutoff: b.cutoff, freq: midiToFreq(degreeToMidi(m, p.chord + BASS_OFFSETS[bassCh], b.octave)), time: t, dur: b.dur * stepDur, attack: 0.01, release: 0.15 });
    }

    // Arpeggio
    const arp = m.arp;
    if (arp && s % arp.every === 0) {
      const seq = ARP_SEQUENCES[arp.pattern];
      const degree = p.chord + seq[(s / arp.every) % seq.length];
      tone(p, { type: arp.type, gain: arp.gain, cutoff: arp.cutoff, freq: midiToFreq(degreeToMidi(m, degree, arp.octave)), time: t, dur: arp.dur * stepDur, attack: 0.005, release: 0.1 });
    }

    // Melody
    const lead = m.lead;
    const offset = lead && p.motif[(p.bar % 2) * 16 + s];
    if (offset !== null && offset !== undefined) {
      tone(p, { ...lead, freq: midiToFreq(degreeToMidi(m, p.chord + offset, lead.octave)), time: t, dur: lead.dur * stepDur });
    }
  }

  function advance(p) {
    const m = p.music;
    const stepDur = 60 / m.bpm / 4;
    const swing = m.swing || 0;
    p.nextTime += stepDur * (p.step % 2 === 0 ? 1 + swing : 1 - swing);
    p.step++;
  }

  /** Lookahead scheduler: queues notes slightly ahead so timing stays tight. */
  function tick() {
    const now = ctx.currentTime;

    // Drop players whose fade-out has finished.
    players = players.filter((p) => {
      if (now < p.retireAt + 0.1) return true;
      p.bus.disconnect();
      p.wet.disconnect();
      return false;
    });

    for (const p of players) {
      // If the tab was throttled we fell behind; resync instead of dumping a burst of notes.
      if (p.nextTime < now - 0.2) p.nextTime = now + 0.02;
      while (p.nextTime < now + LOOKAHEAD) {
        if (p.nextTime < p.retireAt) scheduleStep(p, p.nextTime);
        advance(p);
      }
    }
  }

  // ---- Public API --------------------------------------------------------

  /** Switches mood with a crossfade. Safe to call before start(). */
  function setMood(key) {
    if (!MOODS[key]) return;
    currentKey = key;
    if (!ctx) return;

    const active = players.find((p) => p.retireAt === Infinity);
    if (active && active.key === key) return;

    const now = ctx.currentTime;

    // While paused the audio clock is frozen, so a crossfade would only start
    // on resume and both moods would be heard. Nothing is audible, so swap instantly.
    if (paused) {
      for (const p of players) {
        p.bus.disconnect();
        p.wet.disconnect();
      }
      const fresh = createPlayer(key);
      fresh.bus.gain.cancelScheduledValues(now);
      fresh.bus.gain.setValueAtTime(1, now);
      players = [fresh];
      return;
    }

    for (const p of players) {
      if (p.retireAt !== Infinity) continue;
      p.bus.gain.cancelScheduledValues(now);
      p.bus.gain.setValueAtTime(p.bus.gain.value, now);
      p.bus.gain.linearRampToValueAtTime(0, now + CROSSFADE);
      p.retireAt = now + CROSSFADE;
    }
    players.push(createPlayer(key));
  }

  /** Must be called from a click/tap handler. Returns a promise. */
  function start(key = currentKey) {
    if (!ctx) {
      buildGraph();
      setInterval(tick, TICK_MS);
    }
    setMood(key);
    return play();
  }

  function play() {
    if (!ctx) return Promise.resolve();
    paused = false;
    clearTimeout(suspendTimer);
    return ctx.resume().then(() => {
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    });
  }

  function pause() {
    if (!ctx) return;
    paused = true;
    // Fade out quickly before suspending to avoid a click.
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => ctx.suspend(), 150);
  }

  function setVolume(value) {
    volume = value;
    if (ctx && !paused) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  }

  /**
   * Reads the analyser and returns { volume, bass, mid, treble } (0–1),
   * bassHit (true on the frame a bass onset is detected) and spectrum
   * (the raw frequency bins, 0–255).
   * Called once per animation frame by visuals.js.
   */
  function getLevels() {
    if (!analyser || ctx.state !== 'running') {
      levels.bass *= 0.9;
      levels.mid *= 0.9;
      levels.treble *= 0.9;
      levels.volume *= 0.9;
      levels.bassHit = false;
      for (let i = 0; i < levels.spectrum.length; i++) levels.spectrum[i] *= 0.9;
      return levels;
    }

    analyser.getByteFrequencyData(freqData);
    const hzPerBin = ctx.sampleRate / analyser.fftSize;
    const band = (lo, hi) => {
      const from = Math.max(1, Math.floor(lo / hzPerBin));
      const to = Math.min(freqData.length - 1, Math.ceil(hi / hzPerBin));
      let sum = 0;
      for (let i = from; i <= to; i++) sum += freqData[i];
      return sum / ((to - from + 1) * 255);
    };

    levels.bass = band(20, 160);
    levels.mid = band(160, 2000);
    levels.treble = band(2000, 10000);
    levels.volume = Math.min(1, (levels.bass * 0.5 + levels.mid * 0.35 + levels.treble * 0.15) * 1.6);

    // Onset detection: bass jumps clearly above its recent average.
    const now = ctx.currentTime;
    levels.bassHit = levels.bass > bassAvg * 1.18 + 0.04 && levels.bass > 0.25 && now - lastHit > 0.18;
    if (levels.bassHit) lastHit = now;
    bassAvg += (levels.bass - bassAvg) * 0.08;

    return levels;
  }

  return {
    start,
    play,
    pause,
    setMood,
    setVolume,
    getLevels,
    get isPlaying() { return !!ctx && !paused; },
    get analyser() { return analyser; },
  };
}
