// Renders the plugin icons (a hexagram) to PNG using the core rasterizer.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
require('../polyscape-studio/js/polyscape-core.js');
const P = globalThis.Polyscape;
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function icon(size, color) {
  const img = new Uint8ClampedArray(size * size * 4);
  const s = size / 2, R = size * 0.46;
  const tri = (rot) => { const c = []; for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + rot + i * Math.PI * 2 / 3; c.push(s + Math.cos(a) * R, s + Math.sin(a) * R * 1.02 + (rot ? -size * 0.04 : size * 0.04)); } return c; };
  const layers = [[tri(0), color, 1], [tri(Math.PI), color, 0.55]];
  for (const [c, col, op] of layers) {
    const m = P.rasterize([c], size, size); if (!m) continue;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const a = m.data[y * m.w + x] * op; if (!a) continue;
      const i = ((y + m.y0) * size + x + m.x0) * 4, ea = img[i + 3] / 255, na = a + ea * (1 - a);
      for (let k = 0; k < 3; k++) img[i + k] = (col[k] * a + img[i + k] * ea * (1 - a)) / na;
      img[i + 3] = na * 255;
    }
  }
  return png(size, size, img);
}
const dir = path.join(__dirname, '../polyscape-studio/icons');
fs.mkdirSync(dir, { recursive: true });
const light = [220, 220, 220], blue = [40, 150, 255];
fs.writeFileSync(path.join(dir, 'panel.png'), icon(23, light));
fs.writeFileSync(path.join(dir, 'panel@2x.png'), icon(46, light));
fs.writeFileSync(path.join(dir, 'plugin.png'), icon(48, blue));
fs.writeFileSync(path.join(dir, 'plugin@2x.png'), icon(96, blue));
console.log('icons written');
