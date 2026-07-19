// Procedural texture toolkit (`tex.*` in the build context).
//
// Low-poly models carry their read in silhouette and facets, so textures here
// are a supporting act: broad material identity (wood grain, concrete tone,
// brushed metal) rather than fine surface detail. Reach for a texture when a
// flat color would look inert across a large plane; otherwise a plain color
// plus H.vertexPaint usually does more with less.
//
// Textures are 256px squares by default, mipmapped and linearly filtered so
// they stay clean at any render size, sRGB, repeat-wrapped, and deterministic
// (seeded PRNG — renders are reproducible).
//
// Wear and grime are OPT-IN, not baked in: pass { dirty: 0.2 } on the
// patterned generators, or multiply tex.grunge over a color, when a surface
// should read as used. Clean is the default.
//
// Escape hatches: `tex.pixel` (pixel art from strings — screens, signs and
// decals; always nearest-filtered) and `tex.canvas` (raw 2D drawing).
import * as THREE from 'three';

const css = (c) => '#' + new THREE.Color(c).getHexString();

// Deterministic PRNG so textures render identically every time.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tileable value-noise engine (the "photo grain" core)
// ---------------------------------------------------------------------------
// Lattice noise wrapping at (px, py) cells — anisotropic periods let wood
// grain and metal streaks stretch along one axis and still tile.
function latticeNoise(seed, px, py = px) {
  const rnd = mulberry32(seed);
  const vals = new Float32Array(px * py);
  for (let i = 0; i < vals.length; i++) vals[i] = rnd();
  const at = (ix, iy) => vals[(((iy % py) + py) % py) * px + (((ix % px) + px) % px)];
  return (x, y) => { // x in 0..px, y in 0..py (cell units)
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return at(x0, y0) * (1 - sx) * (1 - sy) + at(x0 + 1, y0) * sx * (1 - sy) +
           at(x0, y0 + 1) * (1 - sx) * sy + at(x0 + 1, y0 + 1) * sx * sy;
  };
}

// Fractal (multi-octave) tileable noise, u/v in 0..1. px/py = base periods.
function fbm(seed, { octaves = 4, px = 4, py = 4 } = {}) {
  const layers = [];
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const sx = px << o, sy = py << o;
    layers.push({ n: latticeNoise(seed + o * 1013, sx, sy), sx, sy, amp });
    total += amp;
    amp *= 0.55;
  }
  return (u, v) => {
    let s = 0;
    for (const L of layers) s += L.n(u * L.sx, v * L.sy) * L.amp;
    return s / total; // ~0..1
  };
}

// pixelated:true keeps hard texel edges (pixel art); everything else gets
// trilinear filtering + mipmaps so it holds up when the model is far away or
// rendered large.
function finalize(canvas, { repeat = [1, 1], pixelated = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixelated) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else {
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// Per-pixel generator: fn(u, v) -> luminance multiplier OR [r,g,b] 0..255.
function perPixel(size, baseColor, fn, opts = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const base = new THREE.Color(baseColor);
  const br = base.r * 255, bg = base.g * 255, bb = base.b * 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const out = fn((x + 0.5) / size, (y + 0.5) / size, x, y);
      const i = (y * size + x) * 4;
      if (Array.isArray(out)) {
        img.data[i] = out[0]; img.data[i + 1] = out[1]; img.data[i + 2] = out[2];
      } else {
        img.data[i] = Math.max(0, Math.min(255, br * out));
        img.data[i + 1] = Math.max(0, Math.min(255, bg * out));
        img.data[i + 2] = Math.max(0, Math.min(255, bb * out));
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finalize(c, opts);
}

// Multiply an already-drawn pattern by fractal grime — this is what keeps
// checker/bricks/stripes from reading as cartoon vector fills.
function applyDirt(ctx, size, seed, amount) {
  if (!amount) return;
  const n = fbm(seed, { octaves: 4, px: 4, py: 4 });
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = 1 - amount / 2 + amount * n((x + 0.5) / size, (y + 0.5) / size);
      const i = (y * size + x) * 4;
      img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export const tex = {
  /**
   * Raw canvas escape hatch: tex.canvas(64, (ctx, w, h) => { ...draw... }).
   * size may be a number (square) or [w, h].
   */
  canvas(size, draw, opts = {}) {
    const [w, h] = Array.isArray(size) ? size : [size, size];
    const [c, ctx] = makeCanvas(w, h);
    draw(ctx, w, h);
    return finalize(c, opts);
  },

  /**
   * Pixel art from strings — one string per row, one char per texel, palette
   * maps chars to colors. '.' and ' ' are transparent. Always nearest-filtered
   * so the texels stay crisp. For screens, signs, dials and decals.
   */
  pixel(rows, palette, opts = {}) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const [c, ctx] = makeCanvas(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.' || ch === ' ' || palette[ch] === undefined) continue;
        ctx.fillStyle = css(palette[ch]);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return finalize(c, { ...opts, pixelated: true });
  },

  // -- Surface generators ------------------------------------------------------

  /**
   * Wood — plank tint variation, anisotropic grain streaks, knots and seams.
   * horizontal:true runs the grain along U instead of V.
   */
  wood(base = 0x8a5a2b, { size = 256, planks = 4, horizontal = false, seed = 3, ...opts } = {}) {
    const rnd = mulberry32(seed);
    const plankTint = Array.from({ length: planks }, () => 0.85 + rnd() * 0.24);
    // grain: high frequency ACROSS the grain, low frequency ALONG it
    const grain = fbm(seed + 7, { octaves: 4, px: planks * 10, py: 2 });
    const rings = fbm(seed + 31, { octaves: 3, px: planks * 3, py: 1 });
    const knots = latticeNoise(seed + 77, planks * 2, 2);
    return perPixel(size, base, (u0, v0) => {
      const across = horizontal ? v0 : u0;
      const along = horizontal ? u0 : v0;
      const p = Math.min(planks - 1, Math.floor(across * planks));
      const inPlank = across * planks - p;
      let l = plankTint[p];
      l *= 0.80 + 0.32 * grain(across, along);          // fine streaks
      l *= 0.90 + 0.18 * rings(across, along);          // broad tone bands
      const k = knots(across * planks * 2, along * 2);
      if (k > 0.88) l *= 0.55 + (0.97 - k) * 3;          // dark knots
      if (inPlank < 0.06 || inPlank > 0.94) l *= 0.62;   // plank seams
      return l;
    }, opts);
  },

  /** Concrete / plaster — blotchy fbm, fine speckle, occasional pits. */
  concrete(base = 0x8d8a84, { size = 256, seed = 9, ...opts } = {}) {
    const blotch = fbm(seed, { octaves: 4, px: 3, py: 3 });
    const speck = latticeNoise(seed + 5, 32, 32);
    return perPixel(size, base, (u, v) => {
      let l = 0.82 + 0.30 * blotch(u, v);
      const s = speck(u * 32, v * 32);
      if (s > 0.93) l *= 0.72;       // pits
      else if (s < 0.06) l *= 1.12;  // bright chips
      return l;
    }, opts);
  },

  /** Worn metal — vertical wear streaks, broad stains, bright scratches. */
  metalWorn(base = 0x9a9ea6, { size = 256, seed = 13, ...opts } = {}) {
    const streaks = fbm(seed, { octaves: 4, px: 12, py: 2 });
    const stains = fbm(seed + 3, { octaves: 3, px: 3, py: 3 });
    const scratch = latticeNoise(seed + 9, 24, 6);
    return perPixel(size, base, (u, v) => {
      let l = 0.82 + 0.22 * streaks(u, v);
      l *= 0.88 + 0.20 * stains(u, v);
      if (scratch(u * 24, v * 6) > 0.94) l *= 1.25; // glinting scratches
      return l;
    }, opts);
  },

  /** Heavy grime/stains — overlay-style blotches (white base = grayscale). */
  grunge(base = 0xffffff, { size = 256, amount = 0.3, seed = 21, ...opts } = {}) {
    const blotch = fbm(seed, { octaves: 5, px: 3, py: 3 });
    return perPixel(size, base, (u, v) => 1 - amount + amount * (0.4 + 1.1 * blotch(u, v)), opts);
  },

  /** Fractal tone noise around a base color (multi-octave, not TV static). */
  noise(base = 0x777788, { size = 256, amount = 0.18, seed = 1, ...opts } = {}) {
    const n = fbm(seed, { octaves: 4, px: 6, py: 6 });
    return perPixel(size, base, (u, v) => 1 - amount / 2 + amount * n(u, v), opts);
  },

  /** Vertical gradient — skies, glows, screen backdrops (kept clean). */
  gradient(top = 0x30306a, bottom = 0x101018, { size = 256, ...opts } = {}) {
    const [c, ctx] = makeCanvas(size, size);
    const a = new THREE.Color(top), b = new THREE.Color(bottom);
    for (let y = 0; y < size; y++) {
      ctx.fillStyle = css(a.clone().lerp(b, y / (size - 1)).getHex());
      ctx.fillRect(0, y, size, 1);
    }
    return finalize(c, opts);
  },

  // -- Patterned generators (grime baked in by default; dirty: 0 disables) ---

  /** Checkerboard with photographic grime. cells = squares per side. */
  checker(c1 = 0x8a8a9e, c2 = 0x5a5a6e, { size = 256, cells = 8, dirty = 0, seed = 17, ...opts } = {}) {
    const [c, ctx] = makeCanvas(size, size);
    const s = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = css((x + y) % 2 ? c2 : c1);
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    applyDirt(ctx, size, seed, dirty);
    return finalize(c, opts);
  },

  /** Grid lines over a background — floors, panels, tiles. */
  grid(bg = 0x44445a, line = 0x2a2a3a, { size = 256, cells = 8, lineWidth = 1, dirty = 0, seed = 18, ...opts } = {}) {
    const [c, ctx] = makeCanvas(size, size);
    ctx.fillStyle = css(bg);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = css(line);
    const s = size / cells;
    for (let i = 0; i < cells; i++) {
      ctx.fillRect(Math.round(i * s), 0, lineWidth, size);
      ctx.fillRect(0, Math.round(i * s), size, lineWidth);
    }
    applyDirt(ctx, size, seed, dirty);
    return finalize(c, opts);
  },

  /** Even stripes of the given colors. horizontal:true for row stripes. */
  stripes(colors = [0xaa3333, 0xeeeeee], { size = 256, horizontal = false, dirty = 0, seed = 19, ...opts } = {}) {
    const [c, ctx] = makeCanvas(size, size);
    const n = colors.length;
    const s = size / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = css(colors[i]);
      if (horizontal) ctx.fillRect(0, Math.round(i * s), size, Math.ceil(s));
      else ctx.fillRect(Math.round(i * s), 0, Math.ceil(s), size);
    }
    applyDirt(ctx, size, seed, dirty);
    return finalize(c, opts);
  },

  /** Running-bond bricks — per-brick tint, mortar shadow, baked grime. */
  bricks(brick = 0x9e5a44, mortar = 0x6e6660, { size = 256, rows = 4, cols = 4, gap = 2, dirty = 0, seed = 7, ...opts } = {}) {
    const [c, ctx] = makeCanvas(size, size);
    const rnd = mulberry32(seed);
    ctx.fillStyle = css(mortar);
    ctx.fillRect(0, 0, size, size);
    const bh = size / rows, bw = size / cols;
    const base = new THREE.Color(brick);
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (bw / 2);
      for (let col = -1; col < cols; col++) {
        const shade = 0.8 + rnd() * 0.38; // strong per-brick variation
        ctx.fillStyle = css(base.clone().multiplyScalar(shade).getHex());
        ctx.fillRect(Math.round(col * bw + offset + gap / 2), Math.round(r * bh + gap / 2),
          Math.round(bw - gap), Math.round(bh - gap));
      }
    }
    applyDirt(ctx, size, seed + 1, dirty);
    return finalize(c, opts);
  },
};
