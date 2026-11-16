/*
 * Polyscape core renderer.
 * Pure JavaScript, no DOM — runs inside Photoshop UXP and in a normal browser.
 * Images are {width, height, data: Uint8ClampedArray RGBA}.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const D2R = Math.PI / 180;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ---------------------------------------------------------------------------
  // Shape library — contours in unit space (radius ~1, y down)
  // ---------------------------------------------------------------------------
  function ngon(n, r = 1, rot = 0) {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rot + (i * TAU) / n;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return p;
  }
  function starPts(n, inner, rot = 0) {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? inner : 1;
      const a = -Math.PI / 2 + rot + (i * Math.PI) / n;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return p;
  }
  function ellipse(rx, ry, seg = 120, cx = 0, cy = 0) {
    const p = [];
    for (let i = 0; i < seg; i++) {
      const a = (i * TAU) / seg;
      p.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
    }
    return p;
  }
  // arc from a0 to a1 (radians, can go either direction), inclusive
  function arc(cx, cy, r, a0, a1, seg = 64, out = []) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return out;
  }
  function quad(out, x0, y0, cx, cy, x1, y1, seg = 24) {
    for (let i = 1; i <= seg; i++) {
      const t = i / seg, it = 1 - t;
      out.push(it * it * x0 + 2 * it * t * cx + t * t * x1, it * it * y0 + 2 * it * t * cy + t * t * y1);
    }
    return out;
  }
  const rect = (hw, hh) => [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
  function reverseC(c) {
    const r = [];
    for (let i = c.length - 2; i >= 0; i -= 2) r.push(c[i], c[i + 1]);
    return r;
  }
  function rotC(c, a) {
    const cs = Math.cos(a), sn = Math.sin(a), r = [];
    for (let i = 0; i < c.length; i += 2) r.push(c[i] * cs - c[i + 1] * sn, c[i] * sn + c[i + 1] * cs);
    return r;
  }
  function crossPts(t) {
    return [-t, -1, t, -1, t, -t, 1, -t, 1, t, t, t, t, 1, -t, 1, -t, t, -1, t, -1, -t, -t, -t];
  }

  const P = {
    points: (def, min = 3, max = 32) => ({ k: 'points', label: 'Points', min, max, step: 1, def }),
    inner: (def) => ({ k: 'inner', label: 'Inner radius', min: 0.05, max: 0.98, step: 0.01, def }),
    thick: (def, label = 'Thickness') => ({ k: 'thick', label, min: 0.02, max: 0.95, step: 0.01, def }),
    sweep: (def) => ({ k: 'sweep', label: 'Sweep°', min: 10, max: 360, step: 1, def }),
    bulge: (def, label = 'Curve') => ({ k: 'bulge', label, min: 0.05, max: 0.95, step: 0.01, def }),
  };

  const SHAPES = [
    // Triangles & quads
    { id: 'triangle', label: 'Triangle', build: () => [ngon(3)] },
    { id: 'triangle-down', label: 'Triangle (inverted)', build: () => [ngon(3, 1, Math.PI)] },
    { id: 'triangle-right', label: 'Right triangle', build: () => [[-0.85, -0.85, 0.85, 0.85, -0.85, 0.85]] },
    { id: 'triangle-tall', label: 'Tall triangle', build: () => [[0, -1, 0.55, 1, -0.55, 1]] },
    { id: 'square', label: 'Square', build: () => [rect(0.8, 0.8)] },
    { id: 'rectangle', label: 'Rectangle', build: () => [rect(1, 0.6)] },
    { id: 'diamond', label: 'Diamond', build: () => [ngon(4)] },
    { id: 'rhombus', label: 'Rhombus', build: () => [[0, -1, 0.6, 0, 0, 1, -0.6, 0]] },
    { id: 'parallelogram', label: 'Parallelogram', build: () => [[-0.5, -0.6, 1, -0.6, 0.5, 0.6, -1, 0.6]] },
    { id: 'trapezoid', label: 'Trapezoid', build: () => [[-0.5, -0.6, 0.5, -0.6, 1, 0.6, -1, 0.6]] },
    { id: 'kite', label: 'Kite', build: () => [[0, -1, 0.65, -0.3, 0, 1, -0.65, -0.3]] },
    // Regular polygons
    { id: 'pentagon', label: 'Pentagon', build: () => [ngon(5)] },
    { id: 'hexagon', label: 'Hexagon', build: () => [ngon(6, 1, Math.PI / 6)] },
    { id: 'hexagon-pointy', label: 'Hexagon (pointy)', build: () => [ngon(6)] },
    { id: 'heptagon', label: 'Heptagon', build: () => [ngon(7)] },
    { id: 'octagon', label: 'Octagon', build: () => [ngon(8, 1, Math.PI / 8)] },
    { id: 'polygon', label: 'Polygon (n sides)', params: [P.points(9)], build: (p) => [ngon(Math.round(p.points))] },
    // Stars
    { id: 'star', label: 'Star', params: [P.points(5), P.inner(0.45)], build: (p) => [starPts(Math.round(p.points), p.inner)] },
    { id: 'pentagram', label: 'Pentagram', build: () => [starPts(5, 0.382)] },
    { id: 'starburst', label: 'Starburst', params: [P.points(24, 6, 64), P.inner(0.8)], build: (p) => [starPts(Math.round(p.points), p.inner)] },
    { id: 'sparkle', label: 'Sparkle (4-point)', params: [P.inner(0.22)], build: (p) => [starPts(4, p.inner)] },
    { id: 'hexagram', label: 'Hexagram', build: () => [ngon(3), ngon(3, 1, Math.PI)] },
    { id: 'octagram', label: 'Octagram', build: () => [ngon(4, 0.95), ngon(4, 0.95, Math.PI / 4)] },
    { id: 'compass', label: 'Compass star', build: () => [starPts(4, 0.2), rotC(starPts(4, 0.2), Math.PI / 4).map((v) => v * 0.6)] },
    // Curves
    { id: 'circle', label: 'Circle', build: () => [ellipse(1, 1)] },
    { id: 'ellipse', label: 'Ellipse', build: () => [ellipse(1, 0.6)] },
    { id: 'ring', label: 'Ring', params: [P.thick(0.25)], build: (p) => [ellipse(1, 1), reverseC(ellipse(1 - p.thick, 1 - p.thick))] },
    { id: 'semicircle', label: 'Semicircle', build: () => [arc(0, 0.42, 1, Math.PI, TAU, 64)] },
    {
      id: 'pie', label: 'Pie / wedge', params: [P.sweep(270)],
      build: (p) => {
        const s = p.sweep * D2R;
        if (s >= TAU - 0.001) return [ellipse(1, 1)];
        const c = [0, 0];
        arc(0, 0, 1, -Math.PI / 2 - s / 2, -Math.PI / 2 + s / 2, 72, c);
        return [c];
      },
    },
    {
      id: 'crescent', label: 'Crescent', params: [P.bulge(0.45, 'Bite')],
      build: (p) => {
        const d = p.bulge, r2 = 0.88;
        const ix = (1 - r2 * r2 + d * d) / (2 * d);
        const iy = Math.sqrt(Math.max(0, 1 - ix * ix));
        const aOuter = Math.atan2(iy, ix);
        const c = arc(0, 0, 1, aOuter, TAU - aOuter, 80);
        const aInner = Math.atan2(iy, ix - d);
        arc(d, 0, r2, TAU - aInner, aInner, 80, c);
        return [c];
      },
    },
    {
      id: 'lens', label: 'Lens (vesica)', params: [P.bulge(0.6, 'Width')],
      build: (p) => {
        const d = 1 - p.bulge * 0.9;
        const r = Math.sqrt(d * d + 1);
        const a = Math.atan2(1, -d);
        const c = arc(d, 0, r, -a, a - TAU, 60).slice();
        // right arc: circle centered at (-d,0)
        const b = Math.atan2(1, d);
        arc(-d, 0, r, b, -b, 60, c);
        return [c];
      },
    },
    {
      id: 'squircle', label: 'Squircle', params: [P.bulge(0.5, 'Roundness')],
      build: (p) => {
        const n = 2 + (1 - p.bulge) * 10, c = [];
        for (let i = 0; i < 160; i++) {
          const a = (i * TAU) / 160, cs = Math.cos(a), sn = Math.sin(a);
          c.push(Math.sign(cs) * Math.pow(Math.abs(cs), 2 / n) * 0.9, Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * 0.9);
        }
        return [c];
      },
    },
    {
      id: 'flower', label: 'Flower', params: [P.points(6, 2, 24), P.inner(0.55)],
      build: (p) => {
        const k = Math.round(p.points), c = [];
        for (let i = 0; i < 240; i++) {
          const a = (i * TAU) / 240;
          const r = p.inner + (1 - p.inner) * Math.abs(Math.cos((k * a) / 2));
          c.push(Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r);
        }
        return [c];
      },
    },
    {
      id: 'heart', label: 'Heart',
      build: () => {
        const c = [];
        for (let i = 0; i < 160; i++) {
          const t = (i * TAU) / 160, s = Math.sin(t);
          c.push((16 * s * s * s) / 17, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 - 0.12);
        }
        return [c];
      },
    },
    {
      id: 'teardrop', label: 'Teardrop',
      build: () => {
        const c = [];
        for (let i = 0; i < 140; i++) {
          const t = (i * TAU) / 140;
          c.push(Math.sin(t) * Math.pow(Math.sin(t / 2), 1.2) * 0.85, -Math.cos(t));
        }
        return [c];
      },
    },
    {
      id: 'shield', label: 'Shield',
      build: () => {
        const c = [-0.8, -0.9, 0.8, -0.9, 0.8, 0];
        quad(c, 0.8, 0, 0.8, 0.65, 0, 1);
        quad(c, 0, 1, -0.8, 0.65, -0.8, 0);
        return [c];
      },
    },
    // Symbols
    { id: 'cross', label: 'Cross / plus', params: [P.thick(0.3, 'Arm width')], build: (p) => [crossPts(p.thick)] },
    { id: 'x-cross', label: 'X cross', params: [P.thick(0.25, 'Arm width')], build: (p) => [rotC(crossPts(p.thick), Math.PI / 4)] },
    { id: 'chevron', label: 'Chevron', params: [P.thick(0.45)], build: (p) => { const t = p.thick; return [[-1, 0.3, 0, -0.5, 1, 0.3, 1, 0.3 + t, 0, -0.5 + t, -1, 0.3 + t]]; } },
    { id: 'arrow', label: 'Arrow', build: () => [[-1, -0.3, 0.15, -0.3, 0.15, -0.75, 1, 0, 0.15, 0.75, 0.15, 0.3, -1, 0.3]] },
    { id: 'bolt', label: 'Lightning bolt', build: () => [[0.25, -1, -0.55, 0.12, -0.05, 0.12, -0.3, 1, 0.55, -0.18, 0.05, -0.18]] },
    { id: 'line', label: 'Line / bar', params: [P.thick(0.06)], build: (p) => [rect(1, p.thick / 2)] },
    {
      id: 'gear', label: 'Gear', params: [P.points(10, 4, 40), P.inner(0.78)],
      build: (p) => {
        const n = Math.round(p.points), c = [], step = TAU / n;
        for (let i = 0; i < n; i++) {
          const a = i * step - Math.PI / 2;
          const pts = [[p.inner, 0], [1, 0.12], [1, 0.38], [p.inner, 0.5]];
          for (const [r, f] of pts) c.push(Math.cos(a + f * step) * r, Math.sin(a + f * step) * r);
        }
        return [c];
      },
    },
  ];
  const SHAPE_BY_ID = {};
  SHAPES.forEach((s) => (SHAPE_BY_ID[s.id] = s));

  function shapeParams(node) {
    const def = SHAPE_BY_ID[node.type] || SHAPES[0];
    const p = {};
    (def.params || []).forEach((d) => {
      const v = node.params && node.params[d.k];
      p[d.k] = v == null ? d.def : v;
    });
    return p;
  }

  function unitContours(node) {
    const def = SHAPE_BY_ID[node.type] || SHAPES[0];
    return def.build(shapeParams(node));
  }

  // ---------------------------------------------------------------------------
  // Rasterization (non-zero winding, 4x vertical supersampling, exact horizontal coverage)
  // ---------------------------------------------------------------------------
  function contoursBounds(contours) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of contours)
      for (let i = 0; i < c.length; i += 2) {
        const x = c[i], y = c[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    return { minX, minY, maxX, maxY };
  }

  function rasterize(contours, W, H) {
    const b = contoursBounds(contours);
    const x0 = Math.max(0, Math.floor(b.minX)), x1 = Math.min(W, Math.ceil(b.maxX));
    const y0 = Math.max(0, Math.floor(b.minY)), y1 = Math.min(H, Math.ceil(b.maxY));
    if (!(x1 > x0 && y1 > y0)) return null;
    const w = x1 - x0, h = y1 - y0;
    const data = new Float32Array(w * h);

    const ev = [];
    for (const c of contours) {
      const n = c.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = c[i * 2], ay = c[i * 2 + 1], bx = c[j * 2], by = c[j * 2 + 1];
        if (ay === by) continue;
        ev.push(ax, ay, bx, by);
      }
    }
    const E = new Float64Array(ev);
    const ne = E.length / 4;
    const xs = new Float64Array(ne + 2), ds = new Int8Array(ne + 2);
    const SS = 4, wgt = 1 / SS;

    for (let row = 0; row < h; row++) {
      const off = row * w;
      for (let s = 0; s < SS; s++) {
        const sy = y0 + row + (s + 0.5) / SS;
        let n = 0;
        for (let e = 0; e < ne; e++) {
          const ay = E[e * 4 + 1], by = E[e * 4 + 3];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
            const ax = E[e * 4], bx = E[e * 4 + 2];
            const x = ax + ((sy - ay) * (bx - ax)) / (by - ay);
            // insertion sort
            let k = n++;
            while (k > 0 && xs[k - 1] > x) { xs[k] = xs[k - 1]; ds[k] = ds[k - 1]; k--; }
            xs[k] = x; ds[k] = by > ay ? 1 : -1;
          }
        }
        let wind = 0, start = 0;
        for (let k = 0; k < n; k++) {
          const prev = wind;
          wind += ds[k];
          if (prev === 0 && wind !== 0) start = xs[k];
          else if (prev !== 0 && wind === 0) {
            let a = start - x0, bb = xs[k] - x0;
            if (a < 0) a = 0;
            if (bb > w) bb = w;
            if (bb <= a) continue;
            const ia = Math.floor(a), ib = Math.floor(bb);
            if (ia === ib) data[off + ia] += (bb - a) * wgt;
            else {
              data[off + ia] += (ia + 1 - a) * wgt;
              for (let i = ia + 1; i < ib; i++) data[off + i] += wgt;
              if (ib < w) data[off + ib] += (bb - ib) * wgt;
            }
          }
        }
      }
    }
    for (let i = 0; i < data.length; i++) if (data[i] > 1) data[i] = 1;
    return { x0, y0, w, h, data };
  }

  function maskAt(m, x, y) {
    const lx = x - m.x0, ly = y - m.y0;
    if (lx < 0 || ly < 0 || lx >= m.w || ly >= m.h) return 0;
    return m.data[ly * m.w + lx];
  }
  // A *= B  (B==null → keep)   or A *= (1-B) when invert
  function maskMul(A, B, invert) {
    if (!A || !B) return A;
    const d = A.data;
    for (let y = 0; y < A.h; y++) {
      const gy = y + A.y0, ly = gy - B.y0;
      const rowIn = ly >= 0 && ly < B.h;
      for (let x = 0; x < A.w; x++) {
        const i = y * A.w + x;
        if (d[i] === 0) continue;
        let v = 0;
        if (rowIn) {
          const lx = x + A.x0 - B.x0;
          if (lx >= 0 && lx < B.w) v = B.data[ly * B.w + lx];
        }
        d[i] *= invert ? 1 - v : v;
      }
    }
    return A;
  }
  function maskClone(m) {
    return m && { x0: m.x0, y0: m.y0, w: m.w, h: m.h, data: new Float32Array(m.data) };
  }

  // anti-aliased polyline stroke of closed contours
  function strokeMask(contours, width, W, H) {
    if (width <= 0) return null;
    const hw = width / 2;
    const b = contoursBounds(contours);
    const x0 = Math.max(0, Math.floor(b.minX - hw - 1)), x1 = Math.min(W, Math.ceil(b.maxX + hw + 1));
    const y0 = Math.max(0, Math.floor(b.minY - hw - 1)), y1 = Math.min(H, Math.ceil(b.maxY + hw + 1));
    if (!(x1 > x0 && y1 > y0)) return null;
    const w = x1 - x0, h = y1 - y0, data = new Float32Array(w * h);
    const seg = (ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - hw - 1)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + hw + 1));
      const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - hw - 1)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + hw + 1));
      for (let y = sy0; y < sy1; y++) {
        const py = y + 0.5, row = (y - y0) * w - x0;
        for (let x = sx0; x < sx1; x++) {
          const px = x + 0.5;
          let t = ((px - ax) * dx + (py - ay) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + t * dx - px, ey = ay + t * dy - py;
          let c = hw - Math.sqrt(ex * ex + ey * ey) + 0.5;
          if (c <= 0) continue;
          if (c > 1) c = 1;
          if (c > data[row + x]) data[row + x] = c;
        }
      }
    };
    for (const c of contours) {
      const n = c.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = c[i * 2], ay = c[i * 2 + 1], bx = c[j * 2], by = c[j * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay), pieces = Math.max(1, Math.ceil(len / 48));
        for (let k = 0; k < pieces; k++) {
          const t0 = k / pieces, t1 = (k + 1) / pieces;
          seg(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1);
        }
      }
    }
    return { x0, y0, w, h, data };
  }

  // separable box blur, `passes` times. ch channels interleaved. edge: clamp.
  function boxBlur(arr, w, h, ch, r, passes = 3) {
    r = Math.max(1, Math.round(r));
    const tmp = new arr.constructor(arr.length);
    const line = new Float64Array(Math.max(w, h) * ch);
    for (let p = 0; p < passes; p++) {
      // horizontal arr->tmp
      for (let y = 0; y < h; y++) {
        const base = y * w * ch;
        for (let c = 0; c < ch; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += arr[base + Math.min(w - 1, Math.max(0, k)) * ch + c];
          for (let x = 0; x < w; x++) {
            line[x] = sum / (2 * r + 1);
            const add = Math.min(w - 1, x + r + 1), rem = Math.max(0, x - r);
            sum += arr[base + add * ch + c] - arr[base + rem * ch + c];
          }
          for (let x = 0; x < w; x++) tmp[base + x * ch + c] = line[x];
        }
      }
      // vertical tmp->arr
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < ch; c++) {
          let sum = 0;
          for (let k = -r; k <= r; k++) sum += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * ch + c];
          for (let y = 0; y < h; y++) {
            line[y] = sum / (2 * r + 1);
            const add = Math.min(h - 1, y + r + 1), rem = Math.max(0, y - r);
            sum += tmp[(add * w + x) * ch + c] - tmp[(rem * w + x) * ch + c];
          }
          for (let y = 0; y < h; y++) arr[(y * w + x) * ch + c] = line[y];
        }
      }
    }
    return arr;
  }

  function padMask(m, pad, W, H) {
    const x0 = Math.max(0, m.x0 - pad), y0 = Math.max(0, m.y0 - pad);
    const x1 = Math.min(W, m.x0 + m.w + pad), y1 = Math.min(H, m.y0 + m.h + pad);
    const w = x1 - x0, h = y1 - y0, data = new Float32Array(w * h);
    for (let y = 0; y < m.h; y++) data.set(m.data.subarray(y * m.w, (y + 1) * m.w), (y + m.y0 - y0) * w + (m.x0 - x0));
    return { x0, y0, w, h, data };
  }
  function shiftMask(m, dx, dy) {
    return { x0: m.x0 + Math.round(dx), y0: m.y0 + Math.round(dy), w: m.w, h: m.h, data: m.data };
  }
  // clip a mask's bbox to image bounds (after shifting)
  function clipMask(m, W, H) {
    const x0 = Math.max(0, m.x0), y0 = Math.max(0, m.y0);
    const x1 = Math.min(W, m.x0 + m.w), y1 = Math.min(H, m.y0 + m.h);
    if (x1 <= x0 || y1 <= y0) return null;
    if (x0 === m.x0 && y0 === m.y0 && x1 - x0 === m.w && y1 - y0 === m.h) return m;
    const w = x1 - x0, h = y1 - y0, data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = y + y0 - m.y0;
      data.set(m.data.subarray(sy * m.w + (x0 - m.x0), sy * m.w + (x0 - m.x0) + w), y * w);
    }
    return { x0, y0, w, h, data };
  }

  // ---------------------------------------------------------------------------
  // Colour helpers & blend modes
  // ---------------------------------------------------------------------------
  function hexToRgb(hex) {
    let h = String(hex || '#000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const BLEND = {
    normal: (b, s) => s,
    multiply: (b, s) => b * s,
    screen: (b, s) => b + s - b * s,
    overlay: (b, s) => (b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
    'soft-light': (b, s) =>
      s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
    'hard-light': (b, s) => (s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
    'vivid-light': (b, s) =>
      s < 0.5 ? (s <= 0 ? 0 : clamp01(1 - (1 - b) / (2 * s))) : s >= 1 ? 1 : clamp01(b / (2 * (1 - s))),
    'linear-light': (b, s) => clamp01(b + 2 * s - 1),
    'pin-light': (b, s) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
    'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
    darken: (b, s) => (b < s ? b : s),
    lighten: (b, s) => (b > s ? b : s),
    'color-dodge': (b, s) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
    'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
    'linear-burn': (b, s) => Math.max(0, b + s - 1),
    add: (b, s) => Math.min(1, b + s),
    subtract: (b, s) => Math.max(0, b - s),
    divide: (b, s) => (s <= 0 ? 1 : Math.min(1, b / s)),
    difference: (b, s) => Math.abs(b - s),
    exclusion: (b, s) => b + s - 2 * b * s,
  };
  const NONSEP = { hue: 1, saturation: 1, color: 1, luminosity: 1 };
  const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
  function clipColor(c) {
    const l = lum(c[0], c[1], c[2]), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
    if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n || 1e-9);
    if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l || 1e-9);
    return c;
  }
  function setLum(c, l) {
    const d = l - lum(c[0], c[1], c[2]);
    c[0] += d; c[1] += d; c[2] += d;
    return clipColor(c);
  }
  const sat = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  function setSat(c, s) {
    const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
    const mn = idx[0], md = idx[1], mx = idx[2];
    if (c[mx] > c[mn]) {
      c[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
      c[mx] = s;
    } else c[md] = c[mx] = 0;
    c[mn] = 0;
    return c;
  }
  function blendNonSep(mode, b, s, out) {
    let c;
    if (mode === 'hue') c = setLum(setSat([s[0], s[1], s[2]], sat(b)), lum(b[0], b[1], b[2]));
    else if (mode === 'saturation') c = setLum(setSat([b[0], b[1], b[2]], sat(s)), lum(b[0], b[1], b[2]));
    else if (mode === 'color') c = setLum([s[0], s[1], s[2]], lum(b[0], b[1], b[2]));
    else c = setLum([b[0], b[1], b[2]], lum(s[0], s[1], s[2]));
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  }

  const BLEND_MODES = [
    ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
    ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], ['vivid-light', 'Vivid Light'],
    ['linear-light', 'Linear Light'], ['pin-light', 'Pin Light'], ['hard-mix', 'Hard Mix'],
    ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
    ['linear-burn', 'Linear Burn'], ['add', 'Add (Linear Dodge)'], ['subtract', 'Subtract'], ['divide', 'Divide'],
    ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'],
    ['color', 'Color'], ['luminosity', 'Luminosity'],
  ];

  // ---------------------------------------------------------------------------
  // Node defaults
  // ---------------------------------------------------------------------------
  const NODE_DEFAULTS = {
    name: '', type: 'triangle', visible: true,
    x: 0.5, y: 0.5, size: 0.6, rotation: 0, aspect: 1,
    params: {}, hollow: false, hollowThick: 0.22,
    content: {
      source: 'current', offX: 0, offY: 0, rotate: 0, zoom: 1, flipX: false, flipY: false,
      mirror: 'none', kaleido: 0, twirl: 0, pixelate: 0, blur: 0, chroma: 0, edge: 'mirror',
    },
    filter: {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, gray: 0, sepia: 0, invert: 0,
      tint: 0, tintColor: '#3aa0ff', duo: 0, duoA: '#1d1b4a', duoB: '#ffc68a',
      posterize: 0, threshold: 0, noise: 0,
      gradColor: '#ffffff', gradFrom: 0, gradTo: 0, gradAngle: 90,
    },
    blend: { mode: 'normal', opacity: 1, clip: true },
    stroke: { enabled: false, width: 3, color: '#ffffff', opacity: 1, align: 'center' },
    shadow: { opacity: 0, color: '#000000', blur: 25, dx: 0, dy: 10 },
    repeat: { count: 1, scale: 0.8, rotate: 0, dx: 0, dy: 0 },
    children: [],
  };
  let _uid = 1;
  function uid() { return 's' + Date.now().toString(36) + (_uid++).toString(36); }

  function normalizeNode(n, isChild) {
    const out = {};
    for (const k in NODE_DEFAULTS) {
      let dv = NODE_DEFAULTS[k];
      if (isChild && (k === 'x' || k === 'y')) dv = 0; // children are positioned relative to the parent centre
      if (k === 'children') out.children = (n.children || []).map((c) => normalizeNode(c, true));
      else if (k === 'params') out.params = Object.assign({}, n.params || {});
      else if (dv && typeof dv === 'object') out[k] = Object.assign({}, dv, n[k] || {});
      else out[k] = n[k] == null ? dv : n[k];
    }
    out.id = n.id || uid();
    if (!out.name) out.name = (SHAPE_BY_ID[out.type] || SHAPES[0]).label;
    return out;
  }
  function normalizeDoc(doc) {
    return { shapes: (doc.shapes || []).map((n) => normalizeNode(n, false)) };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function nodeXf(ctx, node, parent, k) {
    let cx, cy, R, rot;
    if (!parent) {
      cx = node.x * ctx.W; cy = node.y * ctx.H; R = (node.size * ctx.S) / 2; rot = node.rotation * D2R;
    } else {
      const c = Math.cos(parent.rot), s = Math.sin(parent.rot);
      const lx = node.x * parent.R, ly = node.y * parent.R;
      cx = parent.cx + lx * c - ly * s; cy = parent.cy + lx * s + ly * c;
      R = parent.R * node.size; rot = parent.rot + node.rotation * D2R;
    }
    if (k) {
      const rp = node.repeat;
      cx += k * rp.dx * R; cy += k * rp.dy * R;
      R *= Math.pow(rp.scale, k);
      rot += k * rp.rotate * D2R;
    }
    return { cx, cy, R, rot, aspect: node.aspect };
  }
  function worldContours(unit, xf, scale = 1) {
    const c = Math.cos(xf.rot), s = Math.sin(xf.rot), R = xf.R * scale, a = xf.aspect;
    return unit.map((u) => {
      const o = new Array(u.length);
      for (let i = 0; i < u.length; i += 2) {
        const x = u[i] * a * R, y = u[i + 1] * R;
        o[i] = xf.cx + x * c - y * s;
        o[i + 1] = xf.cy + x * s + y * c;
      }
      return o;
    });
  }

  function edgeIdx(v, n, mode) {
    if (v >= 0 && v < n) return v;
    if (mode === 'wrap') return ((v % n) + n) % n;
    if (mode === 'mirror') {
      const p = 2 * n, m = ((v % p) + p) % p;
      return m < n ? m : p - 1 - m;
    }
    return v < 0 ? 0 : n - 1;
  }
  // bilinear sample of RGBA source into out[o..o+3] (0..255 floats)
  function sample(src, W, H, x, y, edge, out, o) {
    x -= 0.5; y -= 0.5;
    const fx0 = Math.floor(x), fy0 = Math.floor(y), fx = x - fx0, fy = y - fy0;
    const xa = edgeIdx(fx0, W, edge), xb = edgeIdx(fx0 + 1, W, edge);
    const ya = edgeIdx(fy0, H, edge), yb = edgeIdx(fy0 + 1, H, edge);
    const i00 = (ya * W + xa) * 4, i10 = (ya * W + xb) * 4, i01 = (yb * W + xa) * 4, i11 = (yb * W + xb) * 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    out[o] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
    out[o + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
    out[o + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
    out[o + 3] = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;
  }

  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // composite a solid colour through a mask onto the canvas
  function paintMask(ctx, m, rgb, opacity) {
    if (!m || opacity <= 0) return;
    const { canvas, W, cov } = ctx;
    const r = rgb[0] * 255, g = rgb[1] * 255, b = rgb[2] * 255;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const a = m.data[y * m.w + x] * opacity;
        if (a <= 0) continue;
        const gi = ((y + m.y0) * W + x + m.x0) * 4;
        canvas[gi] += (r - canvas[gi]) * a;
        canvas[gi + 1] += (g - canvas[gi + 1]) * a;
        canvas[gi + 2] += (b - canvas[gi + 2]) * a;
        canvas[gi + 3] += (255 - canvas[gi + 3]) * a;
        if (cov) { const cv = a * 255; if (cv > cov[gi >> 2]) cov[gi >> 2] = cv; }
      }
    }
  }

  function applyContent(ctx, node, xf, mask) {
    const { W, H, u } = ctx;
    const C = node.content, F = node.filter, Bl = node.blend;
    const opacity = Bl.opacity;
    if (opacity <= 0) return;
    const src = C.source === 'original' ? ctx.orig : ctx.canvas;
    const canvas = ctx.canvas;
    const mw = mask.w, mh = mask.h, mx0 = mask.x0, my0 = mask.y0, md = mask.data;
    const R = xf.R, cr = Math.cos(xf.rot), sr = Math.sin(xf.rot);
    const ccr = Math.cos(C.rotate * D2R), csr = Math.sin(C.rotate * D2R);
    const zoom = C.zoom || 1;
    const offX = C.offX * R, offY = C.offY * R;
    const kal = Math.round(C.kaleido), kseg = kal >= 2 ? TAU / kal : 0;
    const twirl = C.twirl * Math.PI;
    const pix = C.pixelate > 0 ? (C.pixelate * u) / R : 0;
    const chroma = C.chroma * u;
    const mirror = C.mirror, edge = C.edge;
    const blurR = C.blur * u;
    const needAll = blurR > 0.5;

    const buf = new Float32Array(mw * mh * 4);
    const tmp = new Float32Array(4);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const mi = y * mw + x;
        if (!needAll && md[mi] <= 0) continue;
        const dx = x + mx0 + 0.5 - xf.cx, dy = y + my0 + 0.5 - xf.cy;
        // to local unit frame
        let lu = (dx * cr + dy * sr) / R, lv = (-dx * sr + dy * cr) / R;
        if (C.flipX) lu = -lu;
        if (C.flipY) lv = -lv;
        if (mirror !== 'none') {
          if (mirror === 'left') lu = -Math.abs(lu);
          else if (mirror === 'right') lu = Math.abs(lu);
          else if (mirror === 'top') lv = -Math.abs(lv);
          else if (mirror === 'bottom') lv = Math.abs(lv);
          else if (mirror === 'quad') { lu = -Math.abs(lu); lv = -Math.abs(lv); }
        }
        if (kseg) {
          const r = Math.hypot(lu, lv);
          let a = Math.atan2(lv, lu) + Math.PI / 2;
          a = ((a % kseg) + kseg) % kseg;
          if (a > kseg / 2) a = kseg - a;
          a -= Math.PI / 2;
          lu = Math.cos(a) * r; lv = Math.sin(a) * r;
        }
        if (twirl) {
          const r = Math.hypot(lu, lv);
          if (r < 1) {
            const t = (1 - r) * (1 - r) * twirl, ct = Math.cos(t), st = Math.sin(t);
            const nu = lu * ct - lv * st;
            lv = lu * st + lv * ct; lu = nu;
          }
        }
        let su = (lu * ccr - lv * csr) / zoom, sv = (lu * csr + lv * ccr) / zoom;
        if (pix) { su = (Math.floor(su / pix) + 0.5) * pix; sv = (Math.floor(sv / pix) + 0.5) * pix; }
        const wx = xf.cx + R * (su * cr - sv * sr) + offX;
        const wy = xf.cy + R * (su * sr + sv * cr) + offY;
        const o = mi * 4;
        if (chroma) {
          sample(src, W, H, wx + chroma, wy, edge, tmp, 0); buf[o] = tmp[0];
          sample(src, W, H, wx, wy, edge, tmp, 0); buf[o + 1] = tmp[1]; buf[o + 3] = tmp[3];
          sample(src, W, H, wx - chroma, wy, edge, tmp, 0); buf[o + 2] = tmp[2];
        } else sample(src, W, H, wx, wy, edge, buf, o);
      }
    }
    if (needAll) boxBlur(buf, mw, mh, 4, blurR / 1.8, 3);

    // colour pipeline setup
    const br = F.brightness, ct = F.contrast, ck = ct >= 0 ? 1 + ct * 3 : 1 + ct;
    const satK = 1 + F.saturation;
    let hm = null;
    if (F.hue) {
      const a = F.hue * D2R, c = Math.cos(a), s = Math.sin(a);
      hm = [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
    }
    const tc = hexToRgb(F.tintColor), da = hexToRgb(F.duoA), db = hexToRgb(F.duoB), gc = hexToRgb(F.gradColor);
    const post = F.posterize >= 2 ? Math.round(F.posterize) - 1 : 0;
    const hasGrad = F.gradFrom > 0 || F.gradTo > 0;
    const ga = F.gradAngle * D2R, gcs = Math.cos(ga), gsn = Math.sin(ga);
    const asp = xf.aspect || 1;
    const mode = Bl.mode;
    const bf = BLEND[mode] || BLEND.normal, nonsep = !!NONSEP[mode];
    const bb = [0, 0, 0], ss = [0, 0, 0], oo = [0, 0, 0];
    const cov = ctx.cov;

    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const mi = y * mw + x;
        const m = md[mi];
        if (m <= 0) continue;
        const o = mi * 4;
        let r = buf[o] / 255, g = buf[o + 1] / 255, b = buf[o + 2] / 255;
        const sa = buf[o + 3] / 255;
        if (br) { r += br; g += br; b += br; }
        if (ct) { r = (r - 0.5) * ck + 0.5; g = (g - 0.5) * ck + 0.5; b = (b - 0.5) * ck + 0.5; }
        if (satK !== 1) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = l + (r - l) * satK; g = l + (g - l) * satK; b = l + (b - l) * satK; }
        if (hm) { const nr = r * hm[0] + g * hm[1] + b * hm[2], ng = r * hm[3] + g * hm[4] + b * hm[5]; b = r * hm[6] + g * hm[7] + b * hm[8]; r = nr; g = ng; }
        if (F.sepia) {
          const s = F.sepia;
          const sr2 = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
          r += (sr2 - r) * s; g += (sg - g) * s; b += (sb - b) * s;
        }
        if (F.gray) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, s = F.gray; r += (l - r) * s; g += (l - g) * s; b += (l - b) * s; }
        if (F.tint) {
          const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b), s = F.tint;
          const ov = (c) => (l < 0.5 ? 2 * l * c : 1 - 2 * (1 - l) * (1 - c));
          r += (ov(tc[0]) - r) * s; g += (ov(tc[1]) - g) * s; b += (ov(tc[2]) - b) * s;
        }
        if (F.duo) {
          const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b), s = F.duo;
          r += (da[0] + (db[0] - da[0]) * l - r) * s; g += (da[1] + (db[1] - da[1]) * l - g) * s; b += (da[2] + (db[2] - da[2]) * l - b) * s;
        }
        if (F.invert) { const s = F.invert; r += (1 - 2 * r) * s; g += (1 - 2 * g) * s; b += (1 - 2 * b) * s; }
        if (post) { r = Math.round(clamp01(r) * post) / post; g = Math.round(clamp01(g) * post) / post; b = Math.round(clamp01(b) * post) / post; }
        if (F.threshold > 0) { const v = 0.2126 * r + 0.7152 * g + 0.0722 * b >= F.threshold ? 1 : 0; r = g = b = v; }
        const gx = x + mx0, gy = y + my0;
        if (F.noise) { const n = (hash2(gx, gy) - 0.5) * F.noise; r += n; g += n; b += n; }
        if (hasGrad) {
          const dx = gx + 0.5 - xf.cx, dy = gy + 0.5 - xf.cy;
          const lu = (dx * cr + dy * sr) / (R * asp), lv = (-dx * sr + dy * cr) / R;
          const t = clamp01(((lu * gcs + lv * gsn) + 1) / 2);
          const ga2 = F.gradFrom + (F.gradTo - F.gradFrom) * t;
          r += (gc[0] - r) * ga2; g += (gc[1] - g) * ga2; b += (gc[2] - b) * ga2;
        }
        r = clamp01(r); g = clamp01(g); b = clamp01(b);

        const gi = (gy * W + gx) * 4;
        const br0 = canvas[gi] / 255, bg0 = canvas[gi + 1] / 255, bb0 = canvas[gi + 2] / 255;
        let rr, rg, rb;
        if (nonsep) {
          bb[0] = br0; bb[1] = bg0; bb[2] = bb0; ss[0] = r; ss[1] = g; ss[2] = b;
          blendNonSep(mode, bb, ss, oo); rr = oo[0]; rg = oo[1]; rb = oo[2];
        } else { rr = bf(br0, r); rg = bf(bg0, g); rb = bf(bb0, b); }
        const a = m * opacity * (sa > 0 ? 1 : 0);
        if (a <= 0) continue;
        canvas[gi] = (br0 + (rr - br0) * a) * 255;
        canvas[gi + 1] = (bg0 + (rg - bg0) * a) * 255;
        canvas[gi + 2] = (bb0 + (rb - bb0) * a) * 255;
        canvas[gi + 3] += (sa * 255 - canvas[gi + 3]) * a;
        if (cov) { const cv = a * 255; if (cv > cov[gi >> 2]) cov[gi >> 2] = cv; }
      }
    }
  }

  function renderNode(ctx, node, parentXf, parentMask, depth) {
    if (!node.visible) return;
    const unit = unitContours(node);
    const count = Math.max(1, Math.round(node.repeat.count));
    for (let k = 0; k < count; k++) {
      const xf = nodeXf(ctx, node, parentXf, k);
      if (!(xf.R > 0.25)) continue;
      const contours = worldContours(unit, xf);
      ctx.guides.push({ id: node.id, contours, cx: xf.cx, cy: xf.cy, R: xf.R, rot: xf.rot, depth, copy: k });
      let outer = rasterize(contours, ctx.W, ctx.H);
      if (outer && node.blend.clip && parentMask) maskMul(outer, parentMask, false);
      let fill = outer;
      if (outer && node.hollow) {
        fill = maskClone(outer);
        const inner = rasterize(worldContours(unit, xf, 1 - node.hollowThick), ctx.W, ctx.H);
        if (inner) maskMul(fill, inner, true);
      }
      // shadow / glow
      const Sh = node.shadow;
      if (fill && Sh.opacity > 0) {
        const pad = Math.ceil(Sh.blur * ctx.u * 1.6) + 2;
        let sm = padMask(fill, pad, ctx.W, ctx.H);
        sm = { x0: sm.x0, y0: sm.y0, w: sm.w, h: sm.h, data: sm.data };
        if (Sh.blur > 0) boxBlur(sm.data, sm.w, sm.h, 1, (Sh.blur * ctx.u) / 1.8, 3);
        sm = clipMask(shiftMask(sm, Sh.dx * ctx.u, Sh.dy * ctx.u), ctx.W, ctx.H);
        if (sm && node.blend.clip && parentMask) maskMul(sm, parentMask, false);
        paintMask(ctx, sm, hexToRgb(Sh.color), Sh.opacity);
      }
      if (fill) applyContent(ctx, node, xf, fill);
      // stroke
      const St = node.stroke;
      if (St.enabled && St.width > 0 && St.opacity > 0) {
        const w = St.width * ctx.u;
        let sc = contours;
        if (node.hollow) sc = sc.concat(worldContours(unit, xf, 1 - node.hollowThick));
        const align = St.align;
        let sm = strokeMask(sc, align === 'center' ? w : w * 2, ctx.W, ctx.H);
        if (sm && align !== 'center') {
          const ref = node.hollow ? fill : outer || rasterize(contours, ctx.W, ctx.H);
          if (ref) maskMul(sm, ref, align === 'outside');
          else if (align === 'inside') sm = null;
        }
        if (sm && node.blend.clip && parentMask) maskMul(sm, parentMask, false);
        paintMask(ctx, sm, hexToRgb(St.color), St.opacity);
      }
      for (const ch of node.children) renderNode(ctx, ch, xf, outer, depth + 1);
    }
  }

  function render(src, doc, opts = {}) {
    const W = src.width, H = src.height;
    const orig = src.data;
    const ctx = {
      W, H, S: Math.min(W, H), u: Math.min(W, H) / 1000,
      orig, canvas: new Uint8ClampedArray(orig),
      cov: opts.effectOnly ? new Uint8Array(W * H) : null,
      guides: [],
    };
    for (const n of doc.shapes) renderNode(ctx, n, null, null, 0);
    let out = ctx.canvas;
    if (opts.effectOnly) {
      const cov = ctx.cov;
      for (let p = 0, i = 0; p < cov.length; p++, i += 4) {
        const a = cov[p] / 255;
        if (a <= 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
        const ia = 1 - a;
        out[i] = (out[i] - ia * orig[i]) / a;
        out[i + 1] = (out[i + 1] - ia * orig[i + 1]) / a;
        out[i + 2] = (out[i + 2] - ia * orig[i + 2]) / a;
        out[i + 3] = cov[p];
      }
    }
    return { width: W, height: H, data: out, guides: ctx.guides };
  }

  // ---------------------------------------------------------------------------
  // Preview helpers
  // ---------------------------------------------------------------------------
  function drawGuides(img, guides, selectedId) {
    const W = img.width, H = img.height;
    const ctx = { canvas: img.data, W, cov: null };
    const s = Math.max(1, Math.min(W, H) / 400);
    for (const g of guides) {
      if (g.id === selectedId) continue;
      paintMask(ctx, strokeMask(g.contours, 1 * s, W, H), [1, 1, 1], g.copy ? 0.25 : 0.5);
    }
    for (const g of guides) {
      if (g.id !== selectedId) continue;
      paintMask(ctx, strokeMask(g.contours, 2.4 * s, W, H), [0, 0, 0], 0.5);
      paintMask(ctx, strokeMask(g.contours, 1.4 * s, W, H), [0.1, 0.85, 1], g.copy ? 0.5 : 1);
      if (!g.copy) {
        paintMask(ctx, rasterize([ellipse(4.5 * s, 4.5 * s, 24, g.cx, g.cy)], W, H), [0, 0, 0], 0.6);
        paintMask(ctx, rasterize([ellipse(3 * s, 3 * s, 24, g.cx, g.cy)], W, H), [0.1, 0.85, 1], 1);
        // rotation handle
        const hx = g.cx + Math.sin(g.rot) * g.R, hy = g.cy - Math.cos(g.rot) * g.R;
        paintMask(ctx, rasterize([ellipse(4 * s, 4 * s, 24, hx, hy)], W, H), [1, 1, 1], 0.95);
      }
    }
    return img;
  }

  function pointInContours(contours, x, y) {
    let wind = 0;
    for (const c of contours) {
      const n = c.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = c[i * 2], ay = c[i * 2 + 1], bx = c[j * 2], by = c[j * 2 + 1];
        if (ay <= y) {
          if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) wind++;
        } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) wind--;
      }
    }
    return wind !== 0;
  }
  // returns guide entry (topmost & smallest preference) under point
  function hitTest(guides, x, y) {
    let best = null;
    for (const g of guides) {
      if (g.copy) continue;
      if (pointInContours(g.contours, x, y)) {
        if (!best || g.depth > best.depth || (g.depth === best.depth && g.R <= best.R)) best = g;
      }
    }
    return best;
  }

  const api = {
    SHAPES, SHAPE_BY_ID, BLEND_MODES, NODE_DEFAULTS,
    render, drawGuides, hitTest, normalizeNode, normalizeDoc, uid, shapeParams, unitContours,
    rasterize, ellipse,
  };
  root.Polyscape = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
