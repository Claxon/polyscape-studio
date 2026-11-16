/* Polyscape Studio — dialog UI + host bridges (Photoshop UXP, or a plain browser for testing). */
(function () {
  'use strict';
  const PS = window.Polyscape;
  const PRESETS = window.POLYSCAPE_PRESETS;
  const $ = (id) => document.getElementById(id);

  let IS_UXP = false;
  try { IS_UXP = typeof require === 'function' && !!require('uxp'); } catch (e) { IS_UXP = false; }

  // ---------------------------------------------------------------------------
  // Diagnostics log (UXP: written to the plugin data folder as polyscape-log.txt)
  // ---------------------------------------------------------------------------
  let logBuf = '', logTimer = null;
  function log(...args) {
    const line = new Date().toISOString() + ' ' + args.map((a) => {
      if (a instanceof Error) return (a.message || '') + '\n' + (a.stack || '');
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
    try { console.log(line); } catch (e) { /* ignore */ }
    logBuf = (logBuf + line + '\n').slice(-60000);
    if (!IS_UXP) return;
    clearTimeout(logTimer);
    logTimer = setTimeout(async () => {
      try {
        const fs = require('uxp').storage.localFileSystem;
        const folder = await fs.getDataFolder();
        const f = await folder.createFile('polyscape-log.txt', { overwrite: true });
        await f.write(logBuf);
      } catch (e) { /* ignore */ }
    }, 200);
  }

  // ---------------------------------------------------------------------------
  // Minimal PNG (stored deflate) + base64 — preview fallback that needs no host encoder
  // ---------------------------------------------------------------------------
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(buf, start, end) { let c = 0xffffffff; for (let i = start; i < end; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function encodePng(rgb, w, h) {
    const rowLen = w * 3 + 1, rawLen = rowLen * h;
    const nBlocks = Math.ceil(rawLen / 65535) || 1;
    const zLen = 2 + rawLen + nBlocks * 5 + 4;
    const total = 8 + 25 + (12 + zLen) + 12;
    const out = new Uint8Array(total);
    let p = 0;
    const u32 = (v) => { out[p++] = (v >>> 24) & 255; out[p++] = (v >>> 16) & 255; out[p++] = (v >>> 8) & 255; out[p++] = v & 255; };
    [137, 80, 78, 71, 13, 10, 26, 10].forEach((b) => (out[p++] = b));
    u32(13); let cs = p; [73, 72, 68, 82].forEach((b) => (out[p++] = b)); u32(w); u32(h); out[p++] = 8; out[p++] = 2; out[p++] = 0; out[p++] = 0; out[p++] = 0; u32(crc32(out, cs, p));
    u32(zLen); cs = p; [73, 68, 65, 84].forEach((b) => (out[p++] = b));
    out[p++] = 0x78; out[p++] = 0x01;
    let a1 = 1, a2 = 0, remaining = rawLen, ri = 0;
    const rawByte = (i) => { const y = (i / rowLen) | 0, x = i - y * rowLen; return x === 0 ? 0 : rgb[y * w * 3 + x - 1]; };
    while (remaining > 0 || nBlocks === 0) {
      const len = Math.min(65535, remaining);
      remaining -= len;
      out[p++] = remaining === 0 ? 1 : 0; out[p++] = len & 255; out[p++] = len >>> 8; out[p++] = ~len & 255; out[p++] = (~len >>> 8) & 255;
      for (let k = 0; k < len; k++, ri++) { const b = rawByte(ri); out[p++] = b; a1 = (a1 + b) % 65521; a2 = (a2 + a1) % 65521; }
      if (remaining === 0) break;
    }
    u32(((a2 << 16) | a1) >>> 0);
    u32(crc32(out, cs, p));
    u32(0); cs = p; [73, 69, 78, 68].forEach((b) => (out[p++] = b)); u32(crc32(out, cs, p));
    return out;
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toBase64(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 30000) {
      let s = '';
      const end = Math.min(bytes.length, i + 30000);
      for (let j = i; j < end; j += 3) {
        const b0 = bytes[j], b1 = j + 1 < end ? bytes[j + 1] : 0, b2 = j + 2 < end ? bytes[j + 2] : 0;
        s += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)] + (j + 1 < end ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=') + (j + 2 < end ? B64[b2 & 63] : '=');
      }
      parts.push(s);
    }
    return parts.join('');
  }
  // ---------------------------------------------------------------------------
  // Preview view — the large preview in the dialog. Zooms (wheel / buttons) and pans (drag empty area).
  // ---------------------------------------------------------------------------
  const views = [];
  let previewUrl = null, previewW = 0, previewH = 0, docW = 0;
  const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
  const MIN_ZOOM = 0.2; // relative to Fit: zooming out below Fit is allowed, so the whole image is always reachable
  function makeView(prefix) {
    const v = { name: prefix, wrap: $(prefix + 'Wrap'), img: $(prefix + 'Img'), empty: $(prefix + 'Empty'), label: $(prefix + 'Zoom'), zoom: 1, cx: null, cy: null, lastUrl: null };
    v.metrics = () => {
      const r = v.wrap.getBoundingClientRect();
      const fit = Math.min(r.width / previewW, r.height / previewH) || 1;
      return { r, fit, s: fit * v.zoom };
    };
    v.layout = () => {
      if (!previewW) return;
      const { r, s } = v.metrics();
      if (!r.width || !r.height) return;
      if (v.cx == null) { v.cx = previewW / 2; v.cy = previewH / 2; }
      const hw = r.width / 2 / s, hh = r.height / 2 / s;
      v.cx = previewW * s <= r.width ? previewW / 2 : clampN(v.cx, hw, previewW - hw);
      v.cy = previewH * s <= r.height ? previewH / 2 : clampN(v.cy, hh, previewH - hh);
      const st = v.img.style;
      st.left = Math.round(r.width / 2 - v.cx * s) + 'px';
      st.top = Math.round(r.height / 2 - v.cy * s) + 'px';
      st.width = Math.round(previewW * s) + 'px';
      st.height = Math.round(previewH * s) + 'px';
      if (v.label) v.label.textContent = docW ? Math.round((s * previewW * 100) / docW) + '%' : Math.round(v.zoom * 100) + '%';
    };
    v.show = () => {
      if (previewUrl && v.lastUrl !== previewUrl) { v.img.src = previewUrl; v.lastUrl = previewUrl; }
      v.empty.style.display = previewUrl ? 'none' : '';
      v.img.style.display = previewUrl ? '' : 'none';
      v.layout();
    };
    v.point = (e) => {
      const ir = v.img.getBoundingClientRect();
      if (!srcPreview || !ir.width) return null;
      return { x: ((e.clientX - ir.left) / ir.width) * previewW, y: ((e.clientY - ir.top) / ir.height) * previewH, k: previewW / ir.width };
    };
    v.zoomBy = (factor, clientX, clientY) => {
      if (!previewW) return;
      const { r, s } = v.metrics();
      if (v.cx == null) { v.cx = previewW / 2; v.cy = previewH / 2; }
      const mx = clientX == null ? r.width / 2 : clientX - r.left, my = clientY == null ? r.height / 2 : clientY - r.top;
      const px = v.cx + (mx - r.width / 2) / s, py = v.cy + (my - r.height / 2) / s;
      v.zoom = clampN(v.zoom * factor, MIN_ZOOM, 40);
      const s2 = v.metrics().s;
      v.cx = px - (mx - r.width / 2) / s2; v.cy = py - (my - r.height / 2) / s2;
      v.layout();
    };
    v.fit = () => { v.zoom = 1; v.cx = null; v.layout(); };
    v.actual = () => { const { fit } = v.metrics(); v.zoom = clampN(docW ? docW / previewW / fit : 1 / fit, MIN_ZOOM, 40); v.layout(); };
    const btn = (id, fn) => { const b = $(prefix + id); if (b) b.addEventListener('click', fn); };
    btn('ZoomIn', () => v.zoomBy(1.4));
    btn('ZoomOut', () => v.zoomBy(1 / 1.4));
    btn('Fit', () => v.fit());
    btn('Actual', () => v.actual());
    v.wrap.addEventListener('mousedown', (e) => onDown(v, e));
    v.wrap.addEventListener('mousemove', onMove);
    v.wrap.addEventListener('mouseup', onUp);
    v.wrap.addEventListener('contextmenu', (e) => e.preventDefault && e.preventDefault());
    views.push(v);
    return v;
  }
  // size the dialog's columns explicitly (UXP doesn't always honour percentage heights)
  let lastLayoutKey = '';
  // Size requested for the open dialog and the first size measured after it appeared. Only a
  // change from that baseline (the user dragging the dialog edge) is remembered, so the saved
  // size can never creep upwards on its own.
  let dlgReq = null, dlgBase = null;
  function layoutAll(force) {
    const dlg = $('studio');
    const R = dlg.getBoundingClientRect();
    if (!R.width || !R.height) return;
    // the content box, in case the reported rect includes the dialog's own chrome
    const W = Math.min(R.width, dlg.clientWidth > 0 ? dlg.clientWidth : R.width);
    const H0 = Math.min(R.height, dlg.clientHeight > 0 ? dlg.clientHeight : R.height);
    const key = [W, H0, previewW, previewH].join(',');
    if (!force && key === lastLayoutKey) return;
    lastLayoutKey = key;
    if (IS_UXP && studioOpen && dlgReq) {
      if (!dlgBase) dlgBase = { w: W, h: H0 };
      else if (Math.abs(W - dlgBase.w) > 4 || Math.abs(H0 - dlgBase.h) > 4) {
        ui.dlgW2 = Math.round(dlgReq.w + W - dlgBase.w);
        ui.dlgH2 = Math.round(dlgReq.h + H0 - dlgBase.h);
        store.set(LS_UI, ui);
      }
    }
    const H = Math.max(300, H0);
    const rightW = Math.max(340, Math.min(480, Math.round(W / 3.2)));
    $('dlgRoot').style.height = H + 'px';
    $('right').style.width = rightW + 'px';
    $('left').style.width = Math.max(200, W - rightW - 2) + 'px';
    const lb = $('bigBar').getBoundingClientRect().height + $('leftFoot').getBoundingClientRect().height;
    $('bigWrap').style.height = Math.max(150, H - lb - 26) + 'px';
    const rt = $('rightTop').getBoundingClientRect().height;
    $('scroll').style.height = Math.max(100, H - rt - 4) + 'px';
    views.forEach((v) => v.layout());
  }

  // Wheel: zoom only when the pointer is over the preview; over the controls, scroll them.
  // Routed by pointer position because UXP can deliver wheel events to the preview even when
  // the pointer is over the controls column.
  function inRect(node, e) {
    if (typeof e.clientX !== 'number') return false;
    const r = node.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
  }
  function onWheel(e) {
    const right = $('right');
    const big = views[0];
    const overRight = inRect(right, e) || (typeof e.clientX !== 'number' && right.contains(e.target));
    if (!overRight && big && (inRect(big.wrap, e) || (typeof e.clientX !== 'number' && big.wrap.contains(e.target)))) {
      if (e.preventDefault) e.preventDefault();
      big.zoomBy(e.deltaY > 0 ? 1 / 1.15 : 1.15, e.clientX, e.clientY);
      return;
    }
    if (!overRight) return;
    const list = $('layerList');
    const target = (inRect(list, e) && list.scrollHeight > list.clientHeight + 1) ? list : $('scroll');
    const before = target.scrollTop;
    const delta = (e.deltaY || 0) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? target.clientHeight : 1);
    // let native scrolling run; only scroll by hand if it didn't
    setTimeout(() => { if (target.scrollTop === before && delta) target.scrollTop = before + delta; }, 30);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const LS_STATE = 'polyscape.state.v1', LS_USER = 'polyscape.userPresets.v1', LS_UI = 'polyscape.ui.v1';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  let doc = PS.normalizeDoc(store.get(LS_STATE, null) || PRESETS[0]);
  let ui = Object.assign({ source: 'visible', quality: '560', guides: true, output: 'full', open: { shape: true, content: true } }, store.get(LS_UI, {}));
  if (['600', '1000', '1600', '2400'].indexOf(String(ui.quality)) < 0) ui.quality = '1000';
  // sizes saved by pre-release builds could be larger than the screen (and grew on every open): drop them
  delete ui.dlgW; delete ui.dlgH;
  let userPresets = store.get(LS_USER, []);
  let selectedId = doc.shapes[0] ? doc.shapes[0].id : null;
  let srcPreview = null;
  let lastGuides = [];
  const undoStack = [], redoStack = [];
  let lastSnapshot = JSON.stringify(doc);

  function snapshot() {
    const s = JSON.stringify(doc);
    if (s === lastSnapshot) return;
    undoStack.push(lastSnapshot);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    lastSnapshot = s;
  }
  let snapTimer = null;
  function commit(structural) {
    store.set(LS_STATE, doc);
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapshot, 350);
    if (structural) renderLayers();
    scheduleRender();
  }
  function restore(s) {
    doc = PS.normalizeDoc(JSON.parse(s));
    lastSnapshot = s;
    if (!find(selectedId)) selectedId = doc.shapes[0] ? doc.shapes[0].id : null;
    store.set(LS_STATE, doc);
    renderLayers(); renderInspector(); scheduleRender();
  }

  // ---------------------------------------------------------------------------
  // Tree helpers
  // ---------------------------------------------------------------------------
  function find(id, list = doc.shapes, parent = null, depth = 0) {
    if (!id) return null;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.id === id) return { node: n, list, index: i, parent, depth };
      const r = find(id, n.children, n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  function walk(list, fn, depth = 0) { list.forEach((n) => { fn(n, depth); walk(n.children, fn, depth + 1); }); }
  function cloneWithNewIds(n) {
    const c = JSON.parse(JSON.stringify(n));
    walk([c], (x) => (x.id = PS.uid()));
    return PS.normalizeNode(c);
  }
  const selected = () => { const f = find(selectedId); return f ? f.node : null; };

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, v) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {};
    o[ks[ks.length - 1]] = v;
  }

  // ---------------------------------------------------------------------------
  // Inspector schema
  // ---------------------------------------------------------------------------
  const pct = (min, max, step = 1) => () => ({ min, max, step, mul: 100 });
  const num = (min, max, step = 1) => () => ({ min, max, step, mul: 1 });
  const SECTIONS = [
    { id: 'shape', title: 'Shape', fields: [
      { p: 'name', t: 'text', label: 'Name' },
      { p: 'type', t: 'select', label: 'Shape', options: () => PS.SHAPES.map((s) => [s.id, s.label]), structural: true },
      { t: 'shapeParams' },
      { p: 'x', t: 'range', label: 'Position X', r: (d) => (d ? { min: -200, max: 200, step: 1, mul: 100 } : { min: -20, max: 120, step: 0.5, mul: 100 }) },
      { p: 'y', t: 'range', label: 'Position Y', r: (d) => (d ? { min: -200, max: 200, step: 1, mul: 100 } : { min: -20, max: 120, step: 0.5, mul: 100 }) },
      { p: 'size', t: 'range', label: 'Size %', r: pct(1, 250) },
      { p: 'rotation', t: 'range', label: 'Rotation°', r: num(-180, 180) },
      { p: 'aspect', t: 'range', label: 'Stretch X', r: num(0.2, 3, 0.01) },
      { p: 'hollow', t: 'check', label: 'Hollow frame' },
      { p: 'hollowThick', t: 'range', label: 'Frame width', r: pct(2, 95) },
    ] },
    { id: 'content', title: 'Content transform', fields: [
      { p: 'content.source', t: 'select', label: 'Sample from', options: () => [['current', 'Result so far'], ['original', 'Original image']] },
      { p: 'content.offX', t: 'range', label: 'Offset X', r: pct(-300, 300) },
      { p: 'content.offY', t: 'range', label: 'Offset Y', r: pct(-300, 300) },
      { p: 'content.rotate', t: 'range', label: 'Rotate°', r: num(-180, 180) },
      { p: 'content.zoom', t: 'range', label: 'Zoom', r: num(0.2, 5, 0.01) },
      { p: 'content.flipX', t: 'check', label: 'Flip horizontal' },
      { p: 'content.flipY', t: 'check', label: 'Flip vertical' },
      { p: 'content.mirror', t: 'select', label: 'Mirror half', options: () => [['none', 'None'], ['left', 'Left → right'], ['right', 'Right → left'], ['top', 'Top → bottom'], ['bottom', 'Bottom → top'], ['quad', 'Four-way']] },
      { p: 'content.kaleido', t: 'range', label: 'Kaleidoscope', r: num(0, 16) },
      { p: 'content.twirl', t: 'range', label: 'Twirl', r: num(-3, 3, 0.05) },
      { p: 'content.pixelate', t: 'range', label: 'Pixelate', r: num(0, 80, 0.5) },
      { p: 'content.blur', t: 'range', label: 'Blur', r: num(0, 80, 0.5) },
      { p: 'content.chroma', t: 'range', label: 'RGB split', r: num(0, 40, 0.5) },
      { p: 'content.edge', t: 'select', label: 'Edges', options: () => [['mirror', 'Mirror'], ['clamp', 'Stretch'], ['wrap', 'Tile']] },
    ] },
    { id: 'color', title: 'Colour filters', fields: [
      { p: 'filter.brightness', t: 'range', label: 'Brightness', r: pct(-100, 100) },
      { p: 'filter.contrast', t: 'range', label: 'Contrast', r: pct(-100, 100) },
      { p: 'filter.saturation', t: 'range', label: 'Saturation', r: pct(-100, 100) },
      { p: 'filter.hue', t: 'range', label: 'Hue shift°', r: num(-180, 180) },
      { p: 'filter.gray', t: 'range', label: 'Greyscale', r: pct(0, 100) },
      { p: 'filter.sepia', t: 'range', label: 'Sepia', r: pct(0, 100) },
      { p: 'filter.invert', t: 'range', label: 'Invert', r: pct(0, 100) },
      { p: 'filter.posterize', t: 'range', label: 'Posterize', r: num(0, 16) },
      { p: 'filter.threshold', t: 'range', label: 'Threshold', r: pct(0, 100) },
      { p: 'filter.noise', t: 'range', label: 'Grain', r: pct(0, 100) },
      { p: 'filter.tint', t: 'range', label: 'Tint', r: pct(0, 100) },
      { p: 'filter.tintColor', t: 'color', label: 'Tint colour' },
      { p: 'filter.duo', t: 'range', label: 'Duotone', r: pct(0, 100) },
      { p: 'filter.duoA', t: 'color', label: 'Duo shadows' },
      { p: 'filter.duoB', t: 'color', label: 'Duo highlights' },
    ] },
    { id: 'overlay', title: 'Gradient / glass overlay', fields: [
      { p: 'filter.gradColor', t: 'color', label: 'Colour' },
      { p: 'filter.gradFrom', t: 'range', label: 'Start opacity', r: pct(0, 100) },
      { p: 'filter.gradTo', t: 'range', label: 'End opacity', r: pct(0, 100) },
      { p: 'filter.gradAngle', t: 'range', label: 'Direction°', r: num(-180, 180) },
    ] },
    { id: 'blend', title: 'Blending', fields: [
      { p: 'blend.mode', t: 'select', label: 'Blend mode', options: () => PS.BLEND_MODES },
      { p: 'blend.opacity', t: 'range', label: 'Opacity', r: pct(0, 100) },
      { p: 'blend.clip', t: 'check', label: 'Clip to parent' },
    ] },
    { id: 'stroke', title: 'Outline', fields: [
      { p: 'stroke.enabled', t: 'check', label: 'Draw in result', structural: true },
      { p: 'stroke.width', t: 'range', label: 'Width', r: num(0, 40, 0.5) },
      { p: 'stroke.color', t: 'color', label: 'Colour' },
      { p: 'stroke.opacity', t: 'range', label: 'Opacity', r: pct(0, 100) },
      { p: 'stroke.align', t: 'select', label: 'Position', options: () => [['center', 'Centre'], ['inside', 'Inside'], ['outside', 'Outside']] },
    ] },
    { id: 'shadow', title: 'Shadow / glow', fields: [
      { p: 'shadow.opacity', t: 'range', label: 'Opacity', r: pct(0, 100) },
      { p: 'shadow.color', t: 'color', label: 'Colour' },
      { p: 'shadow.blur', t: 'range', label: 'Softness', r: num(0, 120) },
      { p: 'shadow.dx', t: 'range', label: 'Offset X', r: num(-100, 100) },
      { p: 'shadow.dy', t: 'range', label: 'Offset Y', r: num(-100, 100) },
    ] },
    { id: 'repeat', title: 'Repeat (echo)', fields: [
      { p: 'repeat.count', t: 'range', label: 'Copies', r: num(1, 30) },
      { p: 'repeat.scale', t: 'range', label: 'Scale each', r: num(0.3, 1.5, 0.01) },
      { p: 'repeat.rotate', t: 'range', label: 'Rotate each°', r: num(-90, 90) },
      { p: 'repeat.dx', t: 'range', label: 'Step X', r: pct(-300, 300) },
      { p: 'repeat.dy', t: 'range', label: 'Step Y', r: pct(-300, 300) },
    ] },
  ];

  // ---------------------------------------------------------------------------
  // DOM building helpers
  // ---------------------------------------------------------------------------
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'style') e.setAttribute('style', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach((c) => c && e.appendChild(c));
    return e;
  }
  function fillSelect(sel, options, value) {
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    options.forEach(([v, l]) => {
      const o = el('option', { value: v, text: l });
      if (v === value) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    setSelect(sel, value);
  }
  function setSelect(sel, value) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === String(value)) { sel.selectedIndex = i; break; }
    }
    try { sel.value = String(value); } catch (e) { /* UXP quirk */ }
  }
  const fmt = (v) => { const r = Math.round(v * 100) / 100; return String(r); };

  function rangeField(label, get, set, range, defVal) {
    const { min, max, step, mul } = range;
    const lbl = el('span', { class: 'lbl', text: label, title: 'Double-click to reset' });
    const slider = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const box = el('input', { type: 'number', class: 'num', step: String(step) });
    const sync = () => { const d = get() * mul; slider.value = String(d); box.value = fmt(d); };
    sync();
    slider.addEventListener('input', () => { const d = parseFloat(slider.value); box.value = fmt(d); set(d / mul); });
    slider.addEventListener('change', () => { const d = parseFloat(slider.value); box.value = fmt(d); set(d / mul); });
    box.addEventListener('change', () => { const d = parseFloat(box.value); if (isNaN(d)) return sync(); set(d / mul); sync(); });
    lbl.addEventListener('dblclick', () => { if (defVal != null) { set(defVal); sync(); } });
    const row = el('div', { class: 'field' }, [lbl, slider, box]);
    row._sync = sync;
    return row;
  }
  function colorField(label, get, set) {
    const sw = el('div', { class: 'swatch' });
    const tx = el('input', { type: 'text', class: 'hex' });
    const sync = () => { tx.value = get(); sw.style.backgroundColor = get(); };
    sync();
    const apply = () => {
      let v = tx.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) { set(v); sync(); }
    };
    tx.addEventListener('change', apply);
    tx.addEventListener('input', apply);
    // click swatch: cycle through a handy palette
    const PAL = ['#ffffff', '#000000', '#ff4d6d', '#ffb347', '#ffe14a', '#5ce1a5', '#3aa0ff', '#7a5cff', '#1d1b4a', '#ffc68a'];
    sw.addEventListener('click', () => { const i = PAL.indexOf(get().toLowerCase()); set(PAL[(i + 1) % PAL.length]); sync(); });
    return el('div', { class: 'field' }, [el('span', { class: 'lbl', text: label }), tx, sw]);
  }

  // ---------------------------------------------------------------------------
  // Inspector
  // ---------------------------------------------------------------------------
  function renderInspector() {
    const host = $('inspector');
    while (host.firstChild) host.removeChild(host.firstChild);
    const f = find(selectedId);
    if (!f) { host.appendChild(el('div', { class: 'emptyNote', text: 'Add or select a shape to edit it.' })); return; }
    const node = f.node, depth = f.depth;

    SECTIONS.forEach((sec) => {
      const isOpen = !!ui.open[sec.id];
      const head = el('div', { class: 'sectionHead', text: (isOpen ? '▾ ' : '▸ ') + sec.title });
      const body = el('div', { class: 'sectionBody', style: isOpen ? '' : 'display:none' });
      head.addEventListener('click', () => {
        ui.open[sec.id] = !ui.open[sec.id];
        store.set(LS_UI, ui);
        body.style.display = ui.open[sec.id] ? '' : 'none';
        head.textContent = (ui.open[sec.id] ? '▾ ' : '▸ ') + sec.title;
      });
      sec.fields.forEach((fd) => {
        if (fd.t === 'shapeParams') {
          const def = PS.SHAPE_BY_ID[node.type];
          const vals = PS.shapeParams(node);
          (def && def.params || []).forEach((pd) => {
            body.appendChild(rangeField(pd.label, () => vals[pd.k], (v) => { node.params[pd.k] = v; vals[pd.k] = v; commit(); },
              { min: pd.min, max: pd.max, step: pd.step, mul: 1 }, pd.def));
          });
          return;
        }
        const get = () => getPath(node, fd.p);
        const set = (v) => { setPath(node, fd.p, v); commit(fd.structural || fd.p === 'name'); if (fd.structural) renderInspector(); };
        const defVal = getPath(PS.NODE_DEFAULTS, fd.p);
        if (fd.t === 'range') body.appendChild(rangeField(fd.label, get, set, fd.r(depth), defVal));
        else if (fd.t === 'color') body.appendChild(colorField(fd.label, get, set));
        else if (fd.t === 'check') {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!get();
          cb.addEventListener('change', () => set(!!cb.checked));
          body.appendChild(el('div', { class: 'field' }, [el('span', { class: 'lbl', text: fd.label }), cb]));
        } else if (fd.t === 'select') {
          const s = el('select');
          fillSelect(s, fd.options(), get());
          s.addEventListener('change', () => {
            const v = s.value != null && s.value !== '' ? s.value : s.options[s.selectedIndex].value;
            if (fd.p === 'type' && (!node.name || PS.SHAPES.some((x) => x.label === node.name))) node.name = PS.SHAPE_BY_ID[v].label;
            set(v);
          });
          body.appendChild(el('div', { class: 'field' }, [el('span', { class: 'lbl', text: fd.label }), s]));
        } else if (fd.t === 'text') {
          const t = el('input', { type: 'text' });
          t.value = get() || '';
          t.addEventListener('change', () => set(t.value));
          body.appendChild(el('div', { class: 'field' }, [el('span', { class: 'lbl', text: fd.label }), t]));
        }
      });
      host.appendChild(el('div', { class: 'section' }, [head, body]));
    });
  }
  // refresh only the slider values (after canvas dragging)
  function syncInspectorValues() {
    const rows = $('inspector').querySelectorAll('.field');
    for (let i = 0; i < rows.length; i++) if (rows[i]._sync) rows[i]._sync();
  }

  // ---------------------------------------------------------------------------
  // Layer list
  // ---------------------------------------------------------------------------
  function renderLayers() {
    const host = $('layerList');
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!doc.shapes.length) { host.appendChild(el('div', { class: 'emptyNote', text: 'No shapes yet — add one or pick a preset.' })); return; }
    // display top-most first (reverse render order) like Photoshop
    const rows = [];
    (function rec(list, depth) {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        rows.push([n, depth]);
        rec(n.children, depth + 1);
      }
    })(doc.shapes, 0);
    rows.forEach(([n, depth]) => {
      const eye = el('span', { class: 'eye', text: n.visible ? '◉' : '○', title: 'Toggle visibility' });
      const row = el('div', { class: 'layerRow' + (n.id === selectedId ? ' sel' : '') + (n.visible ? '' : ' hidden'), style: 'padding-left:' + (4 + depth * 14) + 'px' }, [
        eye,
        el('span', { class: 'nm', text: (depth ? '↳ ' : '') + n.name }),
        el('span', { class: 'ty', text: n.children.length ? n.children.length + '▾' : '' }),
      ]);
      eye.addEventListener('click', (e) => { e.stopPropagation(); n.visible = !n.visible; commit(true); });
      const ln = el('span', { class: 'ln' + (n.stroke.enabled ? ' on' : ''), text: 'line', title: 'Draw this shape\'s outline in the final image' });
      ln.addEventListener('click', (e) => {
        e.stopPropagation();
        n.stroke.enabled = !n.stroke.enabled;
        if (n.stroke.enabled && !(n.stroke.width > 0)) n.stroke.width = 3;
        commit(true);
        if (n.id === selectedId) renderInspector();
      });
      row.appendChild(ln);
      row.addEventListener('click', () => select(n.id));
      host.appendChild(row);
    });
  }
  function select(id) {
    selectedId = id;
    renderLayers(); renderInspector(); scheduleRender();
  }

  // ---------------------------------------------------------------------------
  // Structural actions
  // ---------------------------------------------------------------------------
  function newNode(type, child) {
    const n = PS.normalizeNode({ type, x: child ? 0 : 0.5, y: child ? 0 : 0.5, size: child ? 0.5 : 0.55 });
    return n;
  }
  function addShape(asChild) {
    const type = $('newTypeSel').value || 'triangle';
    const f = find(selectedId);
    const n = newNode(type, asChild && f);
    if (asChild && f) {
      n.filter.gray = 1;
      f.node.children.push(n);
    } else {
      n.content.flipY = true;
      doc.shapes.push(n);
    }
    selectedId = n.id;
    commit(true); renderInspector();
  }
  function dupShape() {
    const f = find(selectedId); if (!f) return;
    const c = cloneWithNewIds(f.node);
    if (f.depth === 0) { c.x = Math.min(1, c.x + 0.04); c.y = Math.min(1, c.y + 0.04); } else { c.x += 0.15; c.y += 0.15; }
    f.list.splice(f.index + 1, 0, c);
    selectedId = c.id; commit(true); renderInspector();
  }
  function delShape() {
    const f = find(selectedId); if (!f) return;
    f.list.splice(f.index, 1);
    const next = f.list[Math.min(f.index, f.list.length - 1)] || f.parent;
    selectedId = next ? next.id : (doc.shapes[0] && doc.shapes[0].id);
    commit(true); renderInspector();
  }
  function moveShape(dir) {
    const f = find(selectedId); if (!f) return;
    const j = f.index + dir; // list order: later = on top; ▲ means render later
    if (j < 0 || j >= f.list.length) return;
    const t = f.list[j]; f.list[j] = f.node; f.list[f.index] = t;
    commit(true);
  }
  // world transform estimate to keep shapes in place when re-parenting
  function guideOf(id) { return lastGuides.find((g) => g.id === id && !g.copy); }
  function indent() {
    const f = find(selectedId); if (!f || f.index === 0) return;
    const newParent = f.list[f.index - 1];
    const gp = guideOf(newParent.id), gn = guideOf(f.node.id);
    f.list.splice(f.index, 1);
    if (gp && gn) {
      const dx = gn.cx - gp.cx, dy = gn.cy - gp.cy, c = Math.cos(gp.rot), s = Math.sin(gp.rot);
      f.node.x = (dx * c + dy * s) / gp.R; f.node.y = (-dx * s + dy * c) / gp.R;
      f.node.size = gn.R / gp.R;
      f.node.rotation = ((gn.rot - gp.rot) * 180) / Math.PI;
    } else { f.node.x = 0; f.node.y = 0; f.node.size = 0.5; }
    newParent.children.push(f.node);
    commit(true); renderInspector();
  }
  function outdent() {
    const f = find(selectedId); if (!f || !f.parent) return;
    const pf = find(f.parent.id);
    const gn = guideOf(f.node.id);
    f.list.splice(f.index, 1);
    if (gn && srcPreview) {
      if (pf.depth === 0) {
        f.node.x = gn.cx / srcPreview.width; f.node.y = gn.cy / srcPreview.height;
        f.node.size = (gn.R * 2) / Math.min(srcPreview.width, srcPreview.height);
        f.node.rotation = (gn.rot * 180) / Math.PI;
      } else {
        const gp = guideOf(pf.parent.id);
        if (gp) {
          const dx = gn.cx - gp.cx, dy = gn.cy - gp.cy, c = Math.cos(gp.rot), s = Math.sin(gp.rot);
          f.node.x = (dx * c + dy * s) / gp.R; f.node.y = (-dx * s + dy * c) / gp.R;
          f.node.size = gn.R / gp.R; f.node.rotation = ((gn.rot - gp.rot) * 180) / Math.PI;
        }
      }
    }
    pf.list.splice(pf.index + 1, 0, f.node);
    commit(true); renderInspector();
  }

  // ---------------------------------------------------------------------------
  // Presets & randomiser
  // ---------------------------------------------------------------------------
  function presetOptions() {
    const o = [['', '— Presets —']];
    PRESETS.forEach((p, i) => o.push(['b' + i, p.name]));
    userPresets.forEach((p, i) => o.push(['u' + i, '★ ' + p.name]));
    return o;
  }
  function loadPreset(key) {
    let p = null;
    if (key[0] === 'b') p = PRESETS[+key.slice(1)];
    else if (key[0] === 'u') p = userPresets[+key.slice(1)];
    if (!p) return;
    doc = PS.normalizeDoc(JSON.parse(JSON.stringify({ shapes: p.shapes })));
    walk(doc.shapes, (n) => (n.id = PS.uid()));
    selectedId = doc.shapes.length ? doc.shapes[doc.shapes.length - 1].id : null;
    if (key[0] === 'u') $('presetName').value = p.name;
    commit(true); renderInspector();
  }
  function savePreset() {
    const name = ($('presetName').value || '').trim() || 'My preset ' + (userPresets.length + 1);
    const data = JSON.parse(JSON.stringify(doc));
    walk(data.shapes, (n) => delete n.id);
    const i = userPresets.findIndex((p) => p.name === name);
    if (i >= 0) userPresets[i] = { name, shapes: data.shapes }; else userPresets.push({ name, shapes: data.shapes });
    store.set(LS_USER, userPresets);
    fillSelect($('presetSel'), presetOptions(), 'u' + (i >= 0 ? i : userPresets.length - 1));
    status('Saved preset “' + name + '”.');
  }
  function deletePreset() {
    const v = $('presetSel').value;
    if (!v || v[0] !== 'u') return status('Choose one of your ★ presets to delete it.');
    const p = userPresets.splice(+v.slice(1), 1)[0];
    store.set(LS_USER, userPresets);
    fillSelect($('presetSel'), presetOptions(), '');
    status('Deleted preset “' + p.name + '”.');
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const RAND_TYPES = ['triangle', 'triangle-down', 'diamond', 'square', 'hexagon', 'pentagon', 'star', 'circle', 'hexagram', 'octagon', 'kite', 'rhombus', 'ring', 'crescent', 'lens', 'pentagram', 'squircle', 'parallelogram', 'chevron'];
  const RAND_FX = [
    (n) => { n.content.flipY = true; },
    (n) => { n.content.flipX = true; },
    (n) => { n.content.rotate = 180; },
    (n) => { n.content.rotate = pick([90, -90, 45]); n.content.zoom = rnd(1, 1.6); },
    (n) => { n.content.offY = rnd(-0.6, 0.6); n.content.offX = rnd(-0.4, 0.4); },
    (n) => { n.filter.gray = 1; },
    (n) => { n.filter.invert = 1; n.blend.mode = pick(['difference', 'normal', 'exclusion']); },
    (n) => { n.filter.duo = 1; n.filter.duoA = pick(['#1d1b4a', '#0b2b2b', '#2a0b2b', '#101820']); n.filter.duoB = pick(['#ffc68a', '#7ef9ff', '#ff8ad8', '#f2e86d']); },
    (n) => { n.filter.hue = rnd(-150, 150); n.filter.saturation = rnd(0, 0.5); },
    (n) => { n.content.kaleido = pick([3, 4, 6, 8]); },
    (n) => { n.filter.gradFrom = rnd(0.3, 0.8); n.filter.gradTo = rnd(0, 0.2); n.filter.gradAngle = pick([90, -90, 0, 45]); },
    (n) => { n.hollow = true; n.hollowThick = rnd(0.12, 0.35); },
    (n) => { n.content.chroma = rnd(5, 18); },
    (n) => { n.content.twirl = rnd(-2, 2); },
    (n) => { n.content.blur = rnd(4, 20); n.filter.brightness = 0.08; },
    (n) => { n.blend.mode = pick(['screen', 'multiply', 'overlay', 'subtract', 'soft-light', 'luminosity', 'hard-light']); },
    (n) => { n.stroke.width = rnd(1, 4); n.stroke.color = pick(['#ffffff', '#ffffff', '#000000', '#ffe14a']); },
    (n) => { n.shadow.opacity = rnd(0.3, 0.6); n.shadow.blur = rnd(15, 50); },
    (n) => { n.repeat.count = Math.round(rnd(3, 8)); n.repeat.scale = rnd(0.72, 0.9); n.repeat.rotate = rnd(-12, 12); n.stroke.width = 1; },
    (n) => { n.filter.sepia = 1; n.filter.noise = 0.1; },
  ];
  function randomNode(depth) {
    const n = PS.normalizeNode({ type: pick(RAND_TYPES) });
    if (depth === 0) { n.x = rnd(0.35, 0.65); n.y = rnd(0.35, 0.65); n.size = rnd(0.45, 0.95); }
    else { n.x = rnd(-0.3, 0.3); n.y = rnd(-0.3, 0.3); n.size = rnd(0.35, 0.7); }
    if (Math.random() < 0.35) n.rotation = pick([0, 180, 45, 90, rnd(-30, 30)]);
    const k = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < k; i++) pick(RAND_FX)(n);
    if (n.repeat.count > 1 && depth > 0) n.repeat.count = 1;
    if (depth < 2 && Math.random() < 0.55) {
      const kids = 1 + (Math.random() < 0.3 ? 1 : 0);
      for (let i = 0; i < kids; i++) n.children.push(randomNode(depth + 1));
    }
    n.name = PS.SHAPE_BY_ID[n.type].label;
    return n;
  }
  function randomize() {
    const count = Math.random() < 0.7 ? 1 : 2;
    doc = { shapes: [] };
    for (let i = 0; i < count; i++) doc.shapes.push(randomNode(0));
    selectedId = doc.shapes[0].id;
    setSelect($('presetSel'), '');
    commit(true); renderInspector();
  }

  // ---------------------------------------------------------------------------
  // Preview rendering
  // ---------------------------------------------------------------------------
  let renderQueued = false, rendering = false;
  let viewMode = 'edit'; // 'edit' | 'clean' | 'before'
  function setViewMode(m) {
    viewMode = viewMode === m ? 'edit' : m;
    $('btnClean').className = 'toggle' + (viewMode === 'clean' ? ' on' : '');
    $('btnBefore').className = 'toggle' + (viewMode === 'before' ? ' on' : '');
    scheduleRender();
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(doRender, 0);
  }
  async function doRender() {
    renderQueued = false;
    if (!srcPreview) return;
    if (rendering) { scheduleRender(); return; }
    rendering = true;
    try {
      const effectOnly = ui.output === 'effect';
      let res;
      if (viewMode === 'before') {
        res = { width: srcPreview.width, height: srcPreview.height, data: new Uint8ClampedArray(srcPreview.data) };
      } else {
        res = PS.render(srcPreview, doc, { effectOnly });
        lastGuides = res.guides;
        if (effectOnly) checker(res);
        if (ui.guides && viewMode === 'edit') PS.drawGuides(res, res.guides, selectedId);
      }
      previewUrl = await bridge.encode(res);
      const sizeChanged = previewW !== res.width || previewH !== res.height;
      previewW = res.width; previewH = res.height;
      if (sizeChanged) layoutAll(true);
      views.forEach((v) => v.show());
    } catch (e) {
      status('Preview error: ' + (e.message || e), true);
      log('preview error', e);
    }
    rendering = false;
  }
  function checker(img) {
    const d = img.data, W = img.width;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const a = d[i + 3] / 255;
      const x = p % W, y = (p / W) | 0;
      const c = ((x >> 3) + (y >> 3)) & 1 ? 200 : 150;
      d[i] = d[i] * a + c * (1 - a); d[i + 1] = d[i + 1] * a + c * (1 - a); d[i + 2] = d[i + 2] * a + c * (1 - a); d[i + 3] = 255;
    }
  }

  async function refresh() {
    log('refresh', { source: ui.source, quality: ui.quality });
    try {
      status('Sampling…');
      srcPreview = await bridge.capture(+ui.quality, ui.source);
      if (srcPreview && srcPreview.docW && srcPreview.docW !== docW) { docW = srcPreview.docW; views.forEach((v) => { v.zoom = 1; v.cx = null; }); }
      status(srcPreview ? 'Ready — ' + bridge.describe() : '');
      scheduleRender();
    } catch (e) {
      log('sample error', e);
      if (studioOpen && IS_UXP && srcPreview) {
        // Photoshop may refuse to read pixels while the dialog is modal: close, sample, reopen.
        pendingAction = 'resample';
        closeStudio('resample');
        return;
      }
      srcPreview = null;
      previewUrl = null;
      views.forEach((v) => v.show());
      status(e.message || String(e), true);
    }
  }

  // Applying (and re-sampling) happens with the dialog closed, then it reopens.
  let studioOpen = false, pendingAction = null;
  function closeStudio(reason) {
    const dlg = $('studio');
    try { dlg.close(reason); } catch (e) { log('close error', e); }
    if (bridge._resolve) bridge._resolve(reason); // browser harness: don't rely on the async close event
  }
  async function runApply() {
    status('Rendering full resolution…');
    const t0 = Date.now();
    try {
      await bridge.apply(doc, { source: ui.source, output: ui.output });
      const msg = 'Applied in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's — new layer “Polyscape”.';
      status(msg);
      return true;
    } catch (e) {
      status('Apply failed: ' + (e.message || e), true);
      log('apply error', e);
      return false;
    }
  }
  async function openStudio() {
    if (studioOpen) return;
    snapshot();
    status('Sampling…');
    await refresh();
    if (!srcPreview && IS_UXP) return; // refresh already reported the problem
    studioOpen = true;
    setTimeout(() => layoutAll(true), 60);
    setTimeout(() => layoutAll(true), 300);
    let reason = null;
    try { reason = await bridge.showDialog($('studio')); } catch (e) { log('dialog error', e); }
    studioOpen = false;
    log('dialog closed', reason);
    if (reason === 'ok') await runApply();
    else if (reason === 'apply') { if (await runApply()) setTimeout(openStudio, 30); }
    else if (reason === 'resample') setTimeout(openStudio, 30);
  }

  function status(msg, err) {
    const s = $('status');
    if (s) { s.textContent = msg || ''; s.className = err ? 'err' : ''; }
    // with the dialog closed there's nowhere to show an error, so raise a Photoshop alert
    if (err && IS_UXP && !studioOpen) bridge.alert(msg);
  }

  // ---------------------------------------------------------------------------
  // Preview mouse interaction
  // ---------------------------------------------------------------------------
  let drag = null;
  function parentGuide(f) { return f && f.parent ? guideOf(f.parent.id) : null; }
  function startPan(v, e) {
    if (v.cx == null) { v.cx = previewW / 2; v.cy = previewH / 2; }
    drag = { mode: 'pan', view: v, sx: e.clientX, sy: e.clientY, cx0: v.cx, cy0: v.cy };
  }
  function onDown(v, e) {
    if (!srcPreview) return;
    e.preventDefault && e.preventDefault();
    // middle / right button always pans
    if (e.button === 1 || e.button === 2) return startPan(v, e);
    const p = v.point(e);
    if (!p) return startPan(v, e);
    let f = find(selectedId);
    let g = f && guideOf(f.node.id);
    let mode = 'move';
    if (g) {
      const hx = g.cx + Math.sin(g.rot) * g.R, hy = g.cy - Math.cos(g.rot) * g.R;
      if (Math.hypot(p.x - hx, p.y - hy) < 9 * p.k) mode = 'rotate';
    }
    if (mode === 'move') {
      const hit = PS.hitTest(lastGuides, p.x, p.y);
      const inSel = g && lastGuides.some((x) => x.id === selectedId && !x.copy && PS.hitTest([x], p.x, p.y));
      if (!hit && !inSel) return startPan(v, e); // empty area -> pan
      if (hit && hit.id !== selectedId && !(inSel && hit.depth <= f.depth)) {
        selectedId = hit.id; renderLayers(); renderInspector(); f = find(selectedId); g = guideOf(selectedId);
      }
      if (!f || !g) { scheduleRender(); return; }
      if (e.altKey) mode = 'rotate';
      else if (e.shiftKey) mode = 'scale';
    }
    drag = { mode, view: v, f, g, pg: parentGuide(f), x0: p.x, y0: p.y, nx: f.node.x, ny: f.node.y, size: f.node.size, rot: f.node.rotation,
      a0: Math.atan2(p.y - g.cy, p.x - g.cx) };
    scheduleRender();
  }
  function onMove(e) {
    if (!drag) return;
    const v = drag.view;
    if (drag.mode === 'pan') {
      const s = v.metrics().s;
      v.cx = drag.cx0 - (e.clientX - drag.sx) / s;
      v.cy = drag.cy0 - (e.clientY - drag.sy) / s;
      v.layout();
      return;
    }
    const p = v.point(e); if (!p) return;
    const n = drag.f.node;
    if (drag.mode === 'move') {
      const dx = p.x - drag.x0, dy = p.y - drag.y0;
      if (!drag.f.parent) { n.x = drag.nx + dx / srcPreview.width; n.y = drag.ny + dy / srcPreview.height; }
      else if (drag.pg) {
        const c = Math.cos(drag.pg.rot), s = Math.sin(drag.pg.rot);
        n.x = drag.nx + (dx * c + dy * s) / drag.pg.R; n.y = drag.ny + (-dx * s + dy * c) / drag.pg.R;
      }
    } else if (drag.mode === 'scale') {
      n.size = Math.max(0.01, drag.size * Math.exp(-(p.y - drag.y0) / (srcPreview.height * 0.35)));
    } else {
      const a = Math.atan2(p.y - drag.g.cy, p.x - drag.g.cx);
      let r = drag.rot + ((a - drag.a0) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      r = ((((r + 180) % 360) + 360) % 360) - 180;
      n.rotation = Math.round(r * 10) / 10;
    }
    scheduleRender();
  }
  function onUp() {
    if (!drag) return;
    const wasPan = drag.mode === 'pan';
    drag = null;
    if (wasPan) return;
    syncInspectorValues();
    commit();
  }

  // ---------------------------------------------------------------------------
  // Bridges
  // ---------------------------------------------------------------------------
  function makeUxpBridge() {
    const photoshop = require('photoshop');
    const { app, core, imaging, action, constants } = photoshop;
    const SRGB = 'sRGB IEC61966-2.1';
    let profile = SRGB;

    function activeDoc() {
      const d = app.activeDocument;
      if (!d) throw new Error('No open document. Open an image, then press Sample.');
      return d;
    }
    function checkDoc(d) {
      const mode = String(d.mode), bits = String(d.bitsPerChannel);
      log('doc', { id: d.id, title: d.title, w: d.width, h: d.height, mode, bits });
      if (/cmyk|gray|grey|lab|index|bitmap|duotone|multichannel/i.test(mode)) throw new Error('Document must be RGB (Image › Mode › RGB Color). Current: ' + mode);
      if (bits.indexOf('32') >= 0) throw new Error('32-bit documents are not supported. Convert to 8 or 16 bits/channel.');
      return bits.indexOf('16') >= 0 ? 16 : 8;
    }
    // reads pixels into an RGBA buffer the size of the document (scaled)
    async function readPixels(d, source, maxSide) {
      const W = d.width, H = d.height;
      const scale = maxSide ? Math.min(1, maxSide / Math.max(W, H)) : 1;
      const tw = Math.max(1, Math.round(W * scale)), th = Math.max(1, Math.round(H * scale));
      const req = { documentID: d.id, colorSpace: 'RGB', colorProfile: SRGB, componentSize: 8 };
      if (scale < 1) req.targetSize = { width: tw, height: th };
      if (source === 'layer') {
        const l = d.activeLayers && d.activeLayers[0];
        if (!l) throw new Error('No active layer.');
        req.layerID = l.id;
      }
      log('getPixels', req);
      let res;
      try { res = await imaging.getPixels(req); profile = SRGB; } catch (e) {
        log('getPixels with sRGB failed, retrying in document profile', e);
        delete req.colorProfile;
        res = await imaging.getPixels(req);
        profile = res.imageData.colorProfile || SRGB;
      }
      const id = res.imageData;
      const raw = await id.getData({ chunky: true });
      const comps = id.components, iw = id.width, ih = id.height;
      // sourceBounds are reported in the coordinates of the pyramid level that was read
      const lv = Math.pow(2, res.level || 0);
      const sb0 = res.sourceBounds || { left: 0, top: 0, right: W / lv, bottom: H / lv };
      const sb = { left: sb0.left * lv, top: sb0.top * lv, right: sb0.right * lv, bottom: sb0.bottom * lv };
      log('gotPixels', { iw, ih, comps, len: raw && raw.length, type: raw && raw.constructor && raw.constructor.name, profile: id.colorProfile, sb: res.sourceBounds, level: res.level });
      const out = new Uint8ClampedArray(tw * th * 4);
      const rx0 = Math.round(sb.left * scale), ry0 = Math.round(sb.top * scale);
      const rx1 = Math.round(sb.right * scale), ry1 = Math.round(sb.bottom * scale);
      const rw = Math.max(1, rx1 - rx0), rh = Math.max(1, ry1 - ry0);
      const exact = rw === iw && rh === ih;
      for (let y = Math.max(0, ry0); y < Math.min(th, ry1); y++) {
        const sy = exact ? y - ry0 : Math.min(ih - 1, Math.floor(((y - ry0) * ih) / rh));
        for (let x = Math.max(0, rx0); x < Math.min(tw, rx1); x++) {
          const sx = exact ? x - rx0 : Math.min(iw - 1, Math.floor(((x - rx0) * iw) / rw));
          const si = (sy * iw + sx) * comps, di = (y * tw + x) * 4;
          out[di] = raw[si];
          out[di + 1] = raw[si + 1];
          out[di + 2] = raw[si + 2];
          out[di + 3] = comps === 4 ? raw[si + 3] : 255;
        }
      }
      id.dispose();
      return { width: tw, height: th, data: out, docW: W, docH: H };
    }

    let lastDesc = '';
    const bridge = {
      describe: () => lastDesc,
      async capture(maxSide, source) {
        const d = activeDoc();
        checkDoc(d);
        let result = null;
        await core.executeAsModal(async () => { result = await readPixels(d, source, maxSide); }, { commandName: 'Polyscape: sample' });
        lastDesc = d.title + ' (' + d.width + '×' + d.height + ')';
        return result;
      },
      async encode(img) {
        const n = img.width * img.height, rgb = new Uint8Array(n * 3);
        const s = img.data;
        for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) { rgb[j] = s[i]; rgb[j + 1] = s[i + 1]; rgb[j + 2] = s[i + 2]; }
        let url = null;
        if (!bridge._noEncode) {
          try {
            const id = await imaging.createImageDataFromBuffer(rgb, { width: img.width, height: img.height, components: 3, chunky: true, colorSpace: 'RGB', colorProfile: SRGB });
            const b64 = await imaging.encodeImageData({ imageData: id, base64: true });
            id.dispose();
            url = 'data:image/jpeg;base64,' + (typeof b64 === 'string' ? b64 : toBase64(new Uint8Array(b64)));
          } catch (e) {
            log('encodeImageData failed, using PNG fallback', e);
            bridge._noEncode = true;
          }
        }
        if (!url) url = 'data:image/png;base64,' + toBase64(encodePng(rgb, img.width, img.height));
        return url;
      },
      async apply(state, opts) {
        const d = activeDoc();
        const bits = checkDoc(d);
        try {
          await core.executeAsModal(async (ctx) => {
            ctx.reportProgress && ctx.reportProgress({ value: 0.05, commandName: 'Polyscape: reading pixels' });
            const hc = ctx.hostControl;
            const sid = await hc.suspendHistory({ documentID: d.id, name: 'Polyscape' });
            try {
              const src = await readPixels(d, opts.source, 0);
              ctx.reportProgress && ctx.reportProgress({ value: 0.3, commandName: 'Polyscape: rendering' });
              const res = PS.render(src, state, { effectOnly: opts.output === 'effect' });
              log('rendered', { w: res.width, h: res.height });
              ctx.reportProgress && ctx.reportProgress({ value: 0.8, commandName: 'Polyscape: writing layer' });
              const layer = d.createPixelLayer ? await d.createPixelLayer({ name: 'Polyscape' }) : await d.createLayer({ name: 'Polyscape' });
              log('layer created', { id: layer && layer.id });
              if (opts.source === 'visible') {
                try { if (d.layers[0] && d.layers[0].id !== layer.id) layer.move(d.layers[0], constants.ElementPlacement.PLACEBEFORE); } catch (e) { /* keep position */ }
              }
              let buf;
              if (bits === 16) {
                buf = new Uint16Array(res.data.length);
                for (let i = 0; i < buf.length; i++) buf[i] = Math.round((res.data[i] * 32768) / 255);
              } else buf = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.length);
              const base = { width: res.width, height: res.height, components: 4, chunky: true, colorSpace: 'RGB', componentSize: bits };
              const attempts = [Object.assign({ colorProfile: profile }, base), base, Object.assign({ colorProfile: SRGB }, base)];
              let lastErr = null, done = false;
              for (const opt of attempts) {
                let id = null;
                try {
                  id = await imaging.createImageDataFromBuffer(buf, opt);
                  await imaging.putPixels({ documentID: d.id, layerID: layer.id, imageData: id, replace: true });
                  done = true;
                } catch (e) { lastErr = e; log('putPixels attempt failed', { profile: opt.colorProfile || '(none)' }, e); }
                if (id) id.dispose();
                if (done) break;
              }
              if (!done) throw lastErr;
              log('putPixels done');
            } finally {
              await hc.resumeHistory(sid, true);
            }
          }, { commandName: 'Apply Polyscape' });
        } finally { /* nothing */ }
      },
      alert(msg) {
        try { app.showAlert('Polyscape Studio: ' + msg); } catch (e) { log('alert failed', e); }
      },
      showDialog(dlg) {
        // UXP doesn't keep a modal dialog on screen, so pick a size that fits. Use the screen
        // size when UXP reports one; otherwise a conservative default that fits a 1080p screen
        // at 150% scaling. A size the user dragged to is remembered, still capped by the screen.
        let scrW = 0, scrH = 0;
        try {
          const s = window.screen;
          if (s) { scrW = s.availWidth || s.width || 0; scrH = s.availHeight || s.height || 0; }
        } catch (e) { /* not available */ }
        const known = scrW > 600 && scrH > 400;
        const maxW = known ? scrW - 40 : 4000, maxH = known ? scrH - 60 : 4000;
        let W = ui.dlgW2 || (known ? Math.min(1500, maxW) : 1200);
        let H = ui.dlgH2 || (known ? Math.min(900, maxH) : 640);
        W = Math.round(clampN(W, Math.min(760, maxW), maxW));
        H = Math.round(clampN(H, Math.min(460, maxH), maxH));
        log('dialog size', { W, H, screen: known ? [scrW, scrH] : 'unknown', saved: [ui.dlgW2, ui.dlgH2], dpr: window.devicePixelRatio });
        dlgReq = { w: W, h: H }; dlgBase = null;
        return dlg.uxpShowModal({ title: 'Polyscape Studio', resize: 'both', size: { width: W, height: H } });
      },
      init() {
        try {
          require('uxp').entrypoints.setup({
            commands: { openStudio: () => openStudio() },
          });
        } catch (e) { log('entrypoints.setup failed', e); }
      },
    };
    return bridge;
  }

  function makeBrowserBridge() {
    let image = null, name = 'demo';
    const canvas = document.createElement('canvas');
    function demoImage() {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 900);
      sky.addColorStop(0, '#0b3d91'); sky.addColorStop(0.55, '#7fb4e6'); sky.addColorStop(0.56, '#2f6f5e'); sky.addColorStop(1, '#1b2a1f');
      g.fillStyle = sky; g.fillRect(0, 0, 1600, 900);
      g.fillStyle = '#f4f1e8';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(i * 200 - 100, 500); g.lineTo(i * 200 + 80, 180 + (i % 3) * 60); g.lineTo(i * 200 + 260, 500); g.fill(); }
      g.fillStyle = '#6b4f3a';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(i * 200 - 60, 505); g.lineTo(i * 200 + 80, 300 + (i % 3) * 60); g.lineTo(i * 200 + 220, 505); g.fill(); }
      g.fillStyle = '#ffcf6b'; g.beginPath(); g.arc(1250, 160, 70, 0, Math.PI * 2); g.fill();
      return c;
    }
    async function loadUrl(url) {
      return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Could not load ' + url));
        im.src = url;
      });
    }
    function draw(maxSide) {
      const W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
      const s = maxSide ? Math.min(1, maxSide / Math.max(W, H)) : 1;
      canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(image, 0, 0, canvas.width, canvas.height);
      const id = g.getImageData(0, 0, canvas.width, canvas.height);
      return { width: id.width, height: id.height, data: id.data, docW: W, docH: H };
    }
    const bridge = {
      describe: () => name + ' (' + (image.naturalWidth || image.width) + '×' + (image.naturalHeight || image.height) + ')',
      async capture(maxSide) { if (!image) throw new Error('No image loaded.'); return draw(maxSide); },
      async encode(img) {
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height), 0, 0);
        return canvas.toDataURL('image/jpeg', 0.9);
      },
      async apply(state, opts) {
        const src = draw(0);
        const res = PS.render(src, state, { effectOnly: opts.output === 'effect' });
        canvas.width = res.width; canvas.height = res.height;
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.data.buffer), res.width, res.height), 0, 0);
        const a = document.createElement('a');
        a.download = 'polyscape-' + name.replace(/\.[^.]+$/, '') + '.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
      },
      async init() {
        $('browserBar').style.display = '';
        document.body.className = 'browser';
        $('fileInput').addEventListener('change', async (e) => {
          const f = e.target.files[0]; if (!f) return;
          name = f.name; image = await loadUrl(URL.createObjectURL(f)); refresh();
        });
        const q = new URLSearchParams(location.search).get('img');
        try { if (q) { image = await loadUrl(q); name = q.split('/').pop(); } } catch (e) { status(e.message, true); }
        if (!image) image = demoImage();
        openStudio();
      },
      alert(msg) { /* the browser harness keeps the dialog open; status line is enough */ },
      showDialog(dlg) {
        return new Promise((resolve) => {
          const done = (r) => { if (bridge._resolve) { bridge._resolve = null; resolve(r); } };
          bridge._resolve = done;
          dlg.addEventListener('close', () => done(dlg.returnValue || 'cancel'), { once: true });
          dlg.showModal();
        });
      },
    };
    return bridge;
  }

  const bridge = IS_UXP ? makeUxpBridge() : makeBrowserBridge();

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------
  function init() {
    fillSelect($('presetSel'), presetOptions(), '');
    fillSelect($('newTypeSel'), PS.SHAPES.map((s) => [s.id, s.label]), 'triangle');
    setSelect($('sourceSel'), ui.source);
    setSelect($('qualitySel'), ui.quality);
    setSelect($('outputSel'), ui.output);
    $('guidesChk').checked = !!ui.guides;

    $('presetSel').addEventListener('change', () => { const v = $('presetSel').value; if (v) loadPreset(v); });
    $('btnRandom').addEventListener('click', randomize);
    $('btnUndo').addEventListener('click', () => { snapshot(); if (undoStack.length) { redoStack.push(lastSnapshot); restore(undoStack.pop()); } });
    $('btnRedo').addEventListener('click', () => { if (redoStack.length) { undoStack.push(lastSnapshot); restore(redoStack.pop()); } });
    $('btnRefresh').addEventListener('click', refresh);
    $('sourceSel').addEventListener('change', () => { ui.source = $('sourceSel').value; store.set(LS_UI, ui); refresh(); });
    $('qualitySel').addEventListener('change', () => { ui.quality = $('qualitySel').value; store.set(LS_UI, ui); refresh(); });
    $('outputSel').addEventListener('change', () => { ui.output = $('outputSel').value; store.set(LS_UI, ui); scheduleRender(); });
    $('guidesChk').addEventListener('change', () => { ui.guides = !!$('guidesChk').checked; store.set(LS_UI, ui); scheduleRender(); });
    $('btnAdd').addEventListener('click', () => addShape(false));
    $('btnAddChild').addEventListener('click', () => addShape(true));
    $('btnDup').addEventListener('click', dupShape);
    $('btnDel').addEventListener('click', delShape);
    $('btnUp').addEventListener('click', () => moveShape(1));
    $('btnDown').addEventListener('click', () => moveShape(-1));
    $('btnIndent').addEventListener('click', indent);
    $('btnOutdent').addEventListener('click', outdent);
    $('btnSavePreset').addEventListener('click', savePreset);
    $('btnDelPreset').addEventListener('click', deletePreset);
    $('btnApply').addEventListener('click', () => closeStudio('apply'));
    $('btnOK').addEventListener('click', () => closeStudio('ok'));
    $('btnCancel').addEventListener('click', () => closeStudio('cancel'));
    $('btnClean').addEventListener('click', () => setViewMode('clean'));
    $('btnBefore').addEventListener('click', () => setViewMode('before'));

    makeView('big');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('wheel', onWheel, { passive: false });
    setInterval(() => layoutAll(false), 400);

    window.addEventListener('resize', () => layoutAll(true));
    setTimeout(() => layoutAll(true), 50);
    log('Polyscape Studio started', { uxp: IS_UXP });
    renderLayers();
    renderInspector();
    try { bridge.init(); } catch (e) { log('init error', e); status('Init error: ' + (e.message || e), true); }
  }

  init();
  window.__polyscape = { get doc() { return doc; }, select, loadPreset, randomize, refresh };
})();
