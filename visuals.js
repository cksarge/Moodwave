/**
 * visuals.js — full-screen canvas animation that reacts to the music.
 *
 * Each mood lists several `visual.shapes`; each name picks a renderer below.
 * The visuals cycle through that list (switching on a beat), and the user can
 * skip ahead with nextShape(). Renderers read the analyser levels
 * ({ volume, bass, mid, treble, bassHit, spectrum }) every frame, so the
 * motion follows the actual sound rather than a timer.
 *
 * Every change (new mood or next shape set) creates a new layer that fades in
 * while the old layer fades out, so transitions are smooth crossfades.
 */
import { MOODS } from './audio.js';

const FADE_SECONDS = 1.2;
const CYCLE_SECONDS = 20;     // default time on one shape set before moving on
const CYCLE_GRACE = 4;        // wait up to this long for a beat to switch on
const MAX_BURST_PARTICLES = 400;
const TAU = Math.PI * 2;

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** Movement speed for a layer: the mood's base speed scaled by intensity. */
const speedOf = (layer, k) => layer.cfg.speed * (0.5 + 0.5 * k);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** rgb() string, brightened toward white by `boost` (0–1). Used to tie color intensity to the music. */
function rgbBoost([r, g, b], boost) {
  const t = clamp01(boost);
  return `rgb(${(r + (255 - r) * t) | 0},${(g + (255 - g) * t) | 0},${(b + (255 - b) * t) | 0})`;
}

// ---------------------------------------------------------------------------
// Soft glow sprites: a radial gradient is pre-rendered once per color, then
// drawn with drawImage, which is much faster than a gradient per shape.
// ---------------------------------------------------------------------------

const spriteCache = new Map();

function glowSprite(hex) {
  let sprite = spriteCache.get(hex);
  if (!sprite) {
    const size = 128;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const g = sprite.getContext('2d');
    const [r, gr, b] = hexToRgb(hex);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${gr},${b},1)`);
    grad.addColorStop(0.35, `rgba(${r},${gr},${b},0.45)`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    spriteCache.set(hex, sprite);
  }
  return sprite;
}

function drawGlow(c, hex, x, y, radius) {
  c.drawImage(glowSprite(hex), x - radius, y - radius, radius * 2, radius * 2);
}

// ---------------------------------------------------------------------------
// Bursts: small glowing particles that fly out on bass hits (shared by all shapes).
// ---------------------------------------------------------------------------

function spawnBurst(layer, x, y, count, power = 1) {
  for (let i = 0; i < count; i++) {
    const angle = rand(0, TAU);
    const speed = rand(60, 260) * power;
    layer.bursts.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: rand(0.8, 1.6),
      size: rand(1.5, 4),
      color: pick(layer.cfg.palette),
    });
  }
  if (layer.bursts.length > MAX_BURST_PARTICLES) {
    layer.bursts.splice(0, layer.bursts.length - MAX_BURST_PARTICLES);
  }
}

function drawBursts(c, layer, { dt, alpha }) {
  const damp = Math.pow(0.15, dt);
  c.globalCompositeOperation = 'lighter';
  for (let i = layer.bursts.length - 1; i >= 0; i--) {
    const b = layer.bursts[i];
    b.life -= b.decay * dt;
    if (b.life <= 0) {
      layer.bursts[i] = layer.bursts[layer.bursts.length - 1];
      layer.bursts.pop();
      continue;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= damp;
    b.vy *= damp;
    c.globalAlpha = alpha * b.life;
    drawGlow(c, b.color, b.x, b.y, b.size * 4 * b.life + 1);
  }
}

/** Adds a regular polygon path to the context (caller strokes or fills). */
function polygon(c, x, y, radius, sides, rotation) {
  c.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = rotation + (i / sides) * TAU;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}

// ---------------------------------------------------------------------------
// Shape renderers. Each has init(layer, W, H) and draw(c, layer, env), where
// env = { W, H, dt, t, L (levels), k (intensity multiplier), alpha (layer fade) }.
// Optional minTrail raises the mood's trail value for shapes that would smear.
// ---------------------------------------------------------------------------

const SHAPES = {
  /** Soft circles drifting slowly, breathing with the bass. */
  circles: {
    init(layer, W, H) {
      layer.items = Array.from({ length: 34 }, () => ({
        x: rand(0, W), y: rand(0, H),
        r: rand(20, 90),
        vx: rand(-15, 15), vy: rand(-14, 6),
        color: pick(layer.cfg.palette),
        ring: Math.random() < 0.3,
        phase: rand(0, TAU),
      }));
    },
    draw(c, layer, { W, H, dt, t, L, k, alpha }) {
      const speed = speedOf(layer, k) * (1 + L.volume);
      c.globalCompositeOperation = 'lighter';
      for (const p of layer.items) {
        p.x += p.vx * dt * speed;
        p.y += p.vy * dt * speed;
        if (p.x < -p.r) p.x = W + p.r; else if (p.x > W + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = H + p.r; else if (p.y > H + p.r) p.y = -p.r;

        const radius = p.r * (1 + L.bass * 0.5 * k + 0.08 * Math.sin(t * 0.6 + p.phase));
        c.globalAlpha = alpha * clamp01(0.3 + L.mid * 0.5 * k);
        drawGlow(c, p.color, p.x, p.y, radius);

        if (p.ring) {
          c.globalAlpha = alpha * clamp01(0.15 + L.treble * 0.6 * k);
          c.strokeStyle = p.color;
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(p.x, p.y, radius * 0.75, 0, TAU);
          c.stroke();
        }
      }
      if (L.bassHit) {
        const p = pick(layer.items);
        spawnBurst(layer, p.x, p.y, Math.round(6 * k), 0.5);
      }
    },
  },

  /** Concentric rings spreading out like drops on water, one set per beat. */
  ripples: {
    init(layer) {
      layer.items = [];
      layer.nextAmbient = 0;
      layer.rgb = layer.cfg.palette.map(hexToRgb);
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      const speed = speedOf(layer, k);
      layer.nextAmbient -= dt;

      // A beat (or a quiet stretch) drops three rings at a random spot.
      if ((L.bassHit || layer.nextAmbient <= 0) && layer.items.length < 60) {
        const x = rand(0.15, 0.85) * W;
        const y = rand(0.15, 0.85) * H;
        const rgb = pick(layer.rgb);
        for (let i = 0; i < 3; i++) layer.items.push({ x, y, r: -i * 28, life: 1, rgb });
        if (L.bassHit) spawnBurst(layer, x, y, Math.round(5 * k), 0.4);
        layer.nextAmbient = rand(1.2, 2.5);
      }

      c.globalCompositeOperation = 'lighter';
      for (let i = layer.items.length - 1; i >= 0; i--) {
        const ring = layer.items[i];
        ring.r += (40 + 80 * speed) * dt * (1 + L.volume * k);
        ring.life -= dt * 0.3;
        if (ring.life <= 0) {
          layer.items[i] = layer.items[layer.items.length - 1];
          layer.items.pop();
          continue;
        }
        if (ring.r <= 0) continue;
        c.globalAlpha = alpha * ring.life * clamp01(0.4 + L.mid * 0.8 * k);
        c.strokeStyle = rgbBoost(ring.rgb, L.treble * 0.5 * k);
        c.lineWidth = 1 + 3 * ring.life;
        c.beginPath();
        c.arc(ring.x, ring.y, ring.r, 0, TAU);
        c.stroke();
      }
    },
  },

  /** Flowing horizontal wave lines; bass raises the swell, treble adds shimmer. */
  waves: {
    init(layer) {
      const palette = layer.cfg.palette;
      layer.items = Array.from({ length: 6 }, (_, i) => ({
        y: 0.25 + i * 0.1,
        freq: rand(0.8, 2.2),
        amp: rand(0.03, 0.08),
        phase: rand(0, TAU),
        drift: rand(0.6, 1.4) * (i % 2 ? 1 : -1),
        rgb: hexToRgb(palette[i % palette.length]),
      }));
      layer.time = 0;
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      layer.time += dt * speedOf(layer, k) * (1 + L.volume * k) * 1.5;
      const swell = 1 + L.bass * 1.8 * k;
      const shimmer = L.treble * 14 * k;

      c.globalCompositeOperation = 'lighter';
      c.lineJoin = 'round';
      c.lineWidth = 2 + L.mid * 4 * k;
      for (const line of layer.items) {
        c.globalAlpha = alpha * clamp01(0.4 + L.mid * 0.6);
        c.strokeStyle = rgbBoost(line.rgb, L.treble * 0.4 * k);
        c.beginPath();
        for (let x = 0; x <= W + 14; x += 14) {
          const u = x / W;
          const y = line.y * H
            + Math.sin(u * TAU * line.freq + layer.time * line.drift + line.phase) * line.amp * H * swell
            + Math.sin(u * 40 + layer.time * 5) * shimmer;
          if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
      if (L.bassHit) spawnBurst(layer, rand(0, W), pick(layer.items).y * H, Math.round(8 * k), 0.6);
    },
  },

  /** Sharp spinning polygons that punch outward on every kick. */
  geometric: {
    init(layer, W, H) {
      layer.items = Array.from({ length: 18 }, () => ({
        x: rand(0, W), y: rand(0, H),
        vx: rand(-30, 30), vy: rand(-30, 30),
        sides: pick([3, 4, 6]),
        size: rand(30, 110),
        rot: rand(0, TAU), vr: rand(-1.2, 1.2),
        rgb: hexToRgb(pick(layer.cfg.palette)),
        kick: 0,
      }));
      layer.rings = [0, 1, 2].map((i) => ({ rot: i, sides: [3, 6, 4][i], rgb: hexToRgb(layer.cfg.palette[i % layer.cfg.palette.length]) }));
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      const speed = speedOf(layer, k);
      const kickDecay = Math.pow(0.02, dt);
      const boost = L.treble * 0.6 * k;
      c.globalCompositeOperation = 'lighter';
      c.lineJoin = 'round';

      if (L.bassHit) {
        for (const p of layer.items) if (Math.random() < 0.7) p.kick = 1;
        spawnBurst(layer, W / 2, H / 2, Math.round(18 * k), 1.2);
      }

      for (const p of layer.items) {
        p.x = (p.x + p.vx * dt * speed + W) % W;
        p.y = (p.y + p.vy * dt * speed + H) % H;
        p.rot += p.vr * dt * speed * (1 + L.treble * 3 * k);
        p.kick *= kickDecay;
        const size = p.size * (1 + p.kick * 0.45 * k + L.bass * 0.3);
        c.globalAlpha = alpha * clamp01(0.45 + L.mid * 0.6);
        c.strokeStyle = rgbBoost(p.rgb, boost + p.kick * 0.3);
        c.lineWidth = 2 + p.kick * 4;
        polygon(c, p.x, p.y, size, p.sides, p.rot);
        c.stroke();
      }

      // Pulsing rings of polygons in the center.
      const base = Math.min(W, H);
      layer.rings.forEach((ring, i) => {
        ring.rot += dt * speed * (i % 2 ? -0.6 : 0.8) * (1 + L.volume * 2 * k);
        const radius = base * (0.12 + i * 0.08) * (1 + L.bass * 0.4 * k);
        c.globalAlpha = alpha * clamp01(0.35 + L.bass * 0.8);
        c.strokeStyle = rgbBoost(ring.rgb, boost);
        c.lineWidth = 3;
        polygon(c, W / 2, H / 2, radius, ring.sides, ring.rot);
        c.stroke();
      });
    },
  },

  /** Starfield flying toward the viewer; each kick punches it into hyperspeed. */
  warp: {
    minTrail: 0.3,
    init(layer) {
      layer.items = Array.from({ length: 220 }, () => resetStar({}, layer, true));
      layer.rgb = layer.cfg.palette.map(hexToRgb);
      layer.kick = 0;
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      const cx = W / 2, cy = H / 2;
      const scale = Math.max(W, H) * 0.3;
      if (L.bassHit) layer.kick = 1;
      layer.kick *= Math.pow(0.05, dt);
      const move = dt * (0.12 + speedOf(layer, k) * 0.45 + L.bass * 0.6 * k + layer.kick * 1.2 * k);

      for (const p of layer.items) {
        const prevZ = p.z;
        p.z -= move;
        p.visible = false;
        if (p.z <= 0.03) { resetStar(p, layer, false); continue; }
        p.bx = cx + (p.x / p.z) * scale;
        p.by = cy + (p.y / p.z) * scale;
        if (p.bx < 0 || p.bx > W || p.by < 0 || p.by > H) { resetStar(p, layer, false); continue; }
        p.ax = cx + (p.x / prevZ) * scale;
        p.ay = cy + (p.y / prevZ) * scale;
        p.visible = true;
      }

      // One stroke per palette color keeps draw calls low.
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';
      c.lineWidth = 1.5 + L.bass * 1.5 * k;
      c.globalAlpha = alpha * clamp01(0.6 + L.volume * 0.4);
      layer.rgb.forEach((rgb, ci) => {
        c.strokeStyle = rgbBoost(rgb, L.treble * 0.5 * k + layer.kick * 0.3);
        c.beginPath();
        for (const p of layer.items) {
          if (!p.visible || p.colorIndex !== ci) continue;
          c.moveTo(p.ax, p.ay);
          c.lineTo(p.bx, p.by);
        }
        c.stroke();
      });

      if (L.bassHit) spawnBurst(layer, cx, cy, Math.round(10 * k), 1.2);
    },
  },

  /** Retro synthwave floor rolling toward a glowing sun that pulses with the bass. */
  grid: {
    minTrail: 0.35,
    init(layer) {
      layer.offset = 0;
      layer.flash = 0;
      layer.rgb = layer.cfg.palette.map(hexToRgb);
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      layer.offset = (layer.offset + dt * speedOf(layer, k) * 1.2 * (1 + L.volume * 1.5 * k)) % 1;
      if (L.bassHit) layer.flash = 1;
      layer.flash *= Math.pow(0.03, dt);

      const horizon = H * 0.58;
      const cx = W / 2;
      c.globalCompositeOperation = 'lighter';

      // Sun
      c.globalAlpha = alpha * clamp01(0.35 + L.bass * 0.6);
      drawGlow(c, layer.cfg.palette[1], cx, horizon, Math.min(W, H) * 0.28 * (1 + L.bass * 0.35 * k));

      // Floor: horizontal lines bunch up toward the horizon for perspective.
      c.strokeStyle = rgbBoost(layer.rgb[0], L.treble * 0.5 * k + layer.flash * 0.4);
      c.lineWidth = 1.5 + L.bass * 2 * k;
      c.globalAlpha = alpha * clamp01(0.45 + layer.flash * 0.5);
      c.beginPath();
      const rows = 16;
      for (let j = 0; j < rows; j++) {
        const z = (j + layer.offset) / rows;
        const y = horizon + (H - horizon) * z * z;
        c.moveTo(0, y);
        c.lineTo(W, y);
      }
      for (let i = -14; i <= 14; i++) {
        c.moveTo(cx + i * W * 0.025, horizon);
        c.lineTo(cx + i * W * 0.16, H);
      }
      c.stroke();

      // Horizon line flashes on each kick.
      c.globalAlpha = alpha * clamp01(0.6 + layer.flash * 0.4);
      c.strokeStyle = rgbBoost(layer.rgb[2 % layer.rgb.length], 0.3 + layer.flash * 0.5);
      c.lineWidth = 2 + layer.flash * 3;
      c.beginPath();
      c.moveTo(0, horizon);
      c.lineTo(W, horizon);
      c.stroke();

      if (L.bassHit) spawnBurst(layer, cx, horizon, Math.round(12 * k), 1);
    },
  },

  /** Circular spectrum: every bar is a slice of the analyser's frequency data. */
  spectrum: {
    minTrail: 0.3,
    init(layer) {
      layer.rot = 0;
      layer.rgb = layer.cfg.palette.map(hexToRgb);
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      const bars = 72;
      const bins = L.spectrum;
      const usable = Math.min(bins.length, 200); // ~0–9 kHz, where the music lives
      const base = Math.min(W, H);
      const cx = W / 2, cy = H / 2;
      layer.rot += dt * speedOf(layer, k) * 0.25;
      const inner = base * 0.16 * (1 + L.bass * 0.3 * k);
      const maxLen = base * 0.28 * (0.6 + 0.4 * k);

      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = alpha * clamp01(0.15 + L.bass * 0.5);
      drawGlow(c, layer.cfg.palette[0], cx, cy, inner * 1.6);

      c.lineCap = 'round';
      c.lineWidth = Math.max(2, ((TAU * inner) / (bars * 2)) * 0.55);
      c.globalAlpha = alpha * clamp01(0.6 + L.volume * 0.4);
      const colors = layer.rgb.length;
      for (let g = 0; g < colors; g++) {
        c.strokeStyle = rgbBoost(layer.rgb[g], L.treble * 0.5 * k);
        c.beginPath();
        for (let i = g; i < bars; i += colors) {
          // Log-ish mapping gives the bass more bars than the treble.
          const value = usable > 2 ? bins[1 + Math.floor(Math.pow(i / bars, 1.6) * (usable - 2))] / 255 : 0;
          const len = 3 + value * maxLen;
          for (let side = -1; side <= 1; side += 2) { // mirrored halves
            const a = layer.rot + side * ((i + 0.5) / bars) * Math.PI;
            const cos = Math.cos(a), sin = Math.sin(a);
            c.moveTo(cx + cos * inner, cy + sin * inner);
            c.lineTo(cx + cos * (inner + len), cy + sin * (inner + len));
          }
        }
        c.stroke();
      }

      if (L.bassHit) spawnBurst(layer, cx, cy, Math.round(10 * k), 1);
    },
  },

  /** Big pastel glows floating on slow sine paths, with twinkling stars. */
  glow: {
    init(layer) {
      layer.items = Array.from({ length: 14 }, () => ({
        cx: rand(0.1, 0.9), cy: rand(0.1, 0.9),          // stored as fractions so resizing just works
        ax: rand(0.05, 0.2), ay: rand(0.05, 0.2),
        fx: rand(0.1, 0.35), fy: rand(0.1, 0.35),
        r: rand(80, 220),
        phase: rand(0, TAU),
        color: pick(layer.cfg.palette),
        x: 0, y: 0,
      }));
      layer.stars = Array.from({ length: 70 }, () => ({ x: rand(0, 1), y: rand(0, 1), phase: rand(0, TAU), color: pick(layer.cfg.palette) }));
    },
    draw(c, layer, { W, H, t, L, k, alpha }) {
      const time = t * layer.cfg.speed * (0.6 + 0.4 * k) * 4;
      c.globalCompositeOperation = 'lighter';

      for (const p of layer.items) {
        p.x = (p.cx + Math.sin(time * p.fx + p.phase) * p.ax) * W;
        p.y = (p.cy + Math.cos(time * p.fy + p.phase) * p.ay) * H;
        c.globalAlpha = alpha * clamp01(0.16 + L.mid * 0.35 * k);
        drawGlow(c, p.color, p.x, p.y, p.r * (1 + L.volume * 0.4 * k));
      }

      for (const s of layer.stars) {
        c.globalAlpha = alpha * clamp01(0.2 + 0.3 * Math.sin(t * 2 + s.phase) + L.treble * 1.5 * k);
        drawGlow(c, s.color, s.x * W, s.y * H, 3 + L.treble * 6 * k);
      }

      if (L.bassHit) {
        const p = pick(layer.items);
        spawnBurst(layer, p.x, p.y, Math.round(10 * k), 0.4);
      }
    },
  },

  /** Bubbles rising and wobbling; a few pop into sparkles on each beat. */
  bubbles: {
    init(layer, W, H) {
      layer.items = Array.from({ length: 36 }, () => ({
        x: rand(0, W), y: rand(0, H),
        r: rand(8, 36),
        vy: rand(60, 140),
        phase: rand(0, TAU),
        color: pick(layer.cfg.palette),
      }));
    },
    draw(c, layer, { W, H, dt, t, L, k, alpha }) {
      const speed = speedOf(layer, k) * (1 + L.volume * 0.8);
      const grow = 1 + L.bass * 0.3 * k;
      const respawn = (p) => { p.x = rand(0, W); p.y = H + p.r * 2 + rand(0, 40); };
      c.globalCompositeOperation = 'lighter';
      c.lineWidth = 1.5;

      for (const p of layer.items) {
        p.y -= p.vy * dt * speed;
        p.x += Math.sin(t * 1.2 + p.phase) * 20 * dt;
        if (p.y < -p.r * 2) respawn(p);
        const r = p.r * grow;

        c.globalAlpha = alpha * clamp01(0.18 + L.mid * 0.3);
        drawGlow(c, p.color, p.x, p.y, r * 1.4);
        c.globalAlpha = alpha * clamp01(0.5 + L.mid * 0.5);
        c.strokeStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, TAU);
        c.stroke();
        c.globalAlpha = alpha * 0.6;
        drawGlow(c, '#ffffff', p.x - r * 0.35, p.y - r * 0.35, r * 0.25);
      }

      if (L.bassHit) {
        const pops = Math.round(1 + 2 * k);
        for (let i = 0; i < pops; i++) {
          const p = pick(layer.items);
          spawnBurst(layer, p.x, p.y, 8, 0.6);
          respawn(p);
        }
      }
    },
  },

  /** Particles orbiting the center, leaving long swirling trails. */
  swirl: {
    init(layer) {
      layer.items = Array.from({ length: 120 }, (_, i) => ({
        angle: rand(0, TAU),
        radius: rand(0.04, 0.55),                         // fraction of the smaller screen side
        speed: rand(0.15, 0.45) * (i % 5 === 0 ? -1 : 1),
        size: rand(1, 3),
        colorIndex: i % layer.cfg.palette.length,
        phase: rand(0, TAU),
        px: null, py: null,
      }));
      layer.rgb = layer.cfg.palette.map(hexToRgb);
    },
    draw(c, layer, { W, H, dt, t, L, k, alpha }) {
      const base = Math.min(W, H);
      const cx = W / 2 + Math.sin(t * 0.13) * W * 0.05;
      const cy = H / 2 + Math.cos(t * 0.11) * H * 0.05;
      const speed = speedOf(layer, k) * (1 + L.bass * k);
      const push = 1 + L.bass * 0.35 * k;

      // Dark pulsing core.
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = alpha * clamp01(0.12 + L.bass * 0.4);
      drawGlow(c, layer.cfg.palette[1], cx, cy, base * 0.18 * push);

      for (const p of layer.items) {
        p.angle += p.speed * dt * speed;
        const r = p.radius * base * (1 + 0.12 * Math.sin(t * 0.5 + p.phase)) * push;
        const x = cx + Math.cos(p.angle) * r;
        const y = cy + Math.sin(p.angle) * r;
        if (p.px === null) { p.px = x; p.py = y; }
        p.nx = x; p.ny = y;
      }

      // Batch strokes per color to keep draw calls low.
      c.lineCap = 'round';
      layer.rgb.forEach((rgb, ci) => {
        c.strokeStyle = rgbBoost(rgb, L.mid * 0.5 * k);
        c.globalAlpha = alpha * clamp01(0.5 + L.volume * 0.5);
        c.lineWidth = 1.5 + L.bass * 2 * k;
        c.beginPath();
        for (const p of layer.items) {
          if (p.colorIndex !== ci) continue;
          c.moveTo(p.px, p.py);
          c.lineTo(p.nx, p.ny);
        }
        c.stroke();
      });
      for (const p of layer.items) { p.px = p.nx; p.py = p.ny; }

      if (L.bassHit) spawnBurst(layer, cx, cy, Math.round(8 * k), 0.8);
    },
  },

  /** A slowly turning spiral galaxy whose arms swell with the bass. */
  galaxy: {
    init(layer) {
      const arms = 4;
      layer.rot = 0;
      layer.items = Array.from({ length: 260 }, (_, i) => ({
        arm: i % arms,
        arms,
        dist: Math.pow(Math.random(), 0.7),
        spread: rand(-0.35, 0.35),
        size: rand(1.5, 4),
        phase: rand(0, TAU),
        color: pick(layer.cfg.palette),
      }));
    },
    draw(c, layer, { W, H, dt, t, L, k, alpha }) {
      const base = Math.min(W, H);
      const cx = W / 2, cy = H / 2;
      layer.rot += dt * speedOf(layer, k) * 0.4 * (1 + L.bass * k);
      const reach = base * 0.48 * (1 + L.bass * 0.25 * k);
      c.globalCompositeOperation = 'lighter';

      c.globalAlpha = alpha * clamp01(0.3 + L.bass * 0.5);
      drawGlow(c, layer.cfg.palette[1], cx, cy, base * 0.14 * (1 + L.bass * 0.5 * k));

      for (const p of layer.items) {
        // Angle grows with distance, which curls each arm into a spiral.
        const a = (p.arm / p.arms) * TAU + p.dist * 5 + layer.rot + p.spread * (1 - p.dist * 0.5);
        const r = p.dist * reach;
        c.globalAlpha = alpha * clamp01(0.35 + 0.25 * Math.sin(t * 3 + p.phase) + L.treble * k);
        drawGlow(c, p.color, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85, p.size * (2 + L.mid * 2 * k));
      }

      if (L.bassHit) spawnBurst(layer, cx, cy, Math.round(10 * k), 0.8);
    },
  },

  /** Confetti pieces that bounce off the floor and jump on each beat. */
  confetti: {
    init(layer, W, H) {
      layer.items = Array.from({ length: 70 }, () => ({
        x: rand(0, W), y: rand(-H, H),
        vx: rand(-60, 60), vy: rand(-100, 100),
        rot: rand(0, TAU), vr: rand(-4, 4),
        w: rand(8, 18), h: rand(6, 12),
        kind: pick(['rect', 'circle', 'tri']),
        rgb: hexToRgb(pick(layer.cfg.palette)),
      }));
    },
    draw(c, layer, { W, H, dt, L, k, alpha }) {
      const speed = layer.cfg.speed * (0.6 + 0.4 * k);
      const gravity = 520 * speed;
      c.globalCompositeOperation = 'source-over';

      for (const p of layer.items) {
        if (L.bassHit && Math.random() < 0.35 + 0.25 * k) p.vy = -rand(260, 620) * (0.6 + 0.4 * k);

        p.vy += gravity * dt;
        p.x += p.vx * dt * speed;
        p.y += p.vy * dt;
        p.rot += p.vr * dt * (1 + L.treble * 2 * k);

        const floor = H - p.h;
        if (p.y > floor) {
          p.y = floor;
          p.vy = -Math.abs(p.vy) * 0.72;
          // Keep a gentle bounce going even when the music is quiet.
          if (Math.abs(p.vy) < 40 && Math.random() < dt * 0.8) p.vy = -rand(150, 350);
        }
        if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;

        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.globalAlpha = alpha * clamp01(0.75 + L.mid * 0.3);
        c.fillStyle = rgbBoost(p.rgb, L.treble * 0.5 * k);
        const s = 1 + L.bass * 0.5 * k;
        c.beginPath();
        if (p.kind === 'rect') c.rect((-p.w / 2) * s, (-p.h / 2) * s, p.w * s, p.h * s);
        else if (p.kind === 'circle') c.arc(0, 0, (p.h / 1.4) * s, 0, TAU);
        else polygon(c, 0, 0, p.w * 0.6 * s, 3, 0);
        c.fill();
        c.restore();
      }

      if (L.bassHit) spawnBurst(layer, rand(0, W), H * rand(0.3, 0.7), Math.round(12 * k), 1);
    },
  },
};

/** Places a warp star at a random spot, far away (or anywhere in depth on first spawn). */
function resetStar(p, layer, anyDepth) {
  p.x = rand(-1, 1);
  p.y = rand(-1, 1);
  p.z = anyDepth ? rand(0.1, 1) : 1;
  p.colorIndex = randInt(layer.cfg.palette.length);
  p.visible = false;
  return p;
}

function createLayer(key, shape, W, H) {
  const cfg = MOODS[key].visual;
  const layer = { key, shape, cfg, alpha: 0, target: 1, items: [], bursts: [], bg: hexToRgb(cfg.background) };
  SHAPES[shape].init(layer, W, H);
  return layer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {HTMLCanvasElement} canvas
 * @param {() => {volume:number,bass:number,mid:number,treble:number,bassHit:boolean,spectrum:Uint8Array}} getLevels
 */
export function createVisuals(canvas, getLevels) {
  const c = canvas.getContext('2d');
  let W = 0, H = 0;
  let layers = [];
  let moodKey = null;
  let shapeIndex = 0;
  let shapeTime = 0;          // seconds on the current shape set
  let intensity = 0.5;
  let rafId = 0;
  let last = 0;
  let t = 0;
  const bg = [7, 7, 13];      // current background color, eased toward the active mood
  let trail = 0.1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = `rgb(${bg})`;
    c.fillRect(0, 0, W, H);
  }

  /** Crossfades to shape set `index` (wraps around) of the current mood. */
  function showShape(index) {
    const shapes = MOODS[moodKey].visual.shapes;
    shapeIndex = index % shapes.length;
    shapeTime = 0;
    for (const layer of layers) layer.target = 0;
    layers.push(createLayer(moodKey, shapes[shapeIndex], W, H));
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;

    const L = getLevels();
    const k = 0.4 + intensity * 1.6;   // intensity 0–1 → multiplier 0.4–2.0

    // Auto-cycle: once the time is up, switch on the next beat (or after a grace period).
    const visual = MOODS[moodKey].visual;
    const cycle = visual.cycle ?? CYCLE_SECONDS;
    shapeTime += dt;
    if (visual.shapes.length > 1 && shapeTime > cycle && (L.bassHit || shapeTime > cycle + CYCLE_GRACE)) {
      showShape(shapeIndex + 1);
    }

    // Ease the background color and trail length toward the active layer.
    const active = layers[layers.length - 1];
    if (active) {
      const ease = 1 - Math.pow(0.1, dt);
      const targetTrail = Math.max(active.cfg.trail, SHAPES[active.shape].minTrail || 0);
      for (let i = 0; i < 3; i++) bg[i] += (active.bg[i] - bg[i]) * ease;
      trail += (targetTrail - trail) * ease;
    }

    // Translucent fill instead of clearing leaves motion trails.
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = `rgba(${bg[0] | 0},${bg[1] | 0},${bg[2] | 0},${trail})`;
    c.fillRect(0, 0, W, H);

    // Crossfade layers and remove fully faded ones.
    for (const layer of layers) {
      const step = dt / FADE_SECONDS;
      layer.alpha = layer.target > layer.alpha ? Math.min(1, layer.alpha + step) : Math.max(0, layer.alpha - step);
    }
    layers = layers.filter((l) => l.target > 0 || l.alpha > 0);

    for (const layer of layers) {
      const alpha = layer.alpha * layer.alpha * (3 - 2 * layer.alpha); // smoothstep
      const env = { W, H, dt, t, L, k, alpha };
      SHAPES[layer.shape].draw(c, layer, env);
      drawBursts(c, layer, env);
    }

    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    /** Crossfades to a mood's visuals, starting at its first shape set. */
    setMood(key) {
      if (key === moodKey || !MOODS[key]) return;
      moodKey = key;
      showShape(0);
    },
    /** Skips to the mood's next shape set. */
    nextShape() {
      if (moodKey) showShape(shapeIndex + 1);
    },
    /** 0 = calm, 1 = wild. */
    setIntensity(value) {
      intensity = clamp01(value);
    },
    /** Burst of particles at a screen position (used for taps/clicks). */
    burst(x, y) {
      const layer = layers[layers.length - 1];
      if (layer) spawnBurst(layer, x, y, Math.round(14 + 20 * intensity), 1);
    },
    start() {
      if (!rafId) rafId = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      last = 0;
    },
    /**
     * Resolves with a PNG of the current frame (null if the browser can't encode it).
     * @returns {Promise<Blob | null>}
     */
    snapshot() {
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    },
  };
}
