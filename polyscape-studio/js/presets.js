/* Built-in Polyscape presets (partial node definitions; missing fields use defaults). */
(function (root) {
  'use strict';
  const frost = (from, to, angle = 90) => ({ gradColor: '#ffffff', gradFrom: from, gradTo: to, gradAngle: angle });

  const PRESETS = [
    {
      name: 'Mirror Triangle Mono',
      shapes: [{ type: 'triangle', x: 0.5, y: 0.55, size: 0.75, content: { flipY: true }, filter: { gray: 1, contrast: 0.15 }, stroke: { width: 3 } }],
    },
    {
      name: 'Road Reflection (frame + inverted core)',
      shapes: [{
        type: 'triangle', x: 0.5, y: 0.56, size: 0.95, hollow: true, hollowThick: 0.24,
        content: { flipY: true, offY: -0.15 }, filter: Object.assign({ saturation: -0.2 }, frost(0.05, 0.35)),
        children: [
          { type: 'triangle-down', y: -0.12, size: 0.42, content: { offY: -0.9, zoom: 1.3 }, filter: Object.assign({ gray: 0.5, brightness: 0.05 }, frost(0.55, 0.05)) },
          { type: 'triangle', y: -0.72, size: 0.2, content: { flipX: true, offY: 0.6 }, filter: { gray: 0.3 } },
        ],
      }],
    },
    {
      name: 'Mesa Diamond',
      shapes: [{
        type: 'diamond', x: 0.5, y: 0.5, size: 0.92, content: { offY: -0.28, zoom: 1.05 }, filter: { contrast: 0.08 },
        children: [
          { type: 'diamond', y: -0.8, size: 0.3, filter: Object.assign({ gray: 0.6 }, frost(0.9, 0.15)) },
          { type: 'diamond', y: 0.8, size: 0.3, filter: Object.assign({ gray: 0.6 }, frost(0.2, 0.95)) },
          { type: 'diamond', x: -0.82, size: 0.24, hollow: true, hollowThick: 0.3, filter: { brightness: 1 }, blend: { clip: false } },
          { type: 'diamond', x: 0.82, size: 0.24, hollow: true, hollowThick: 0.3, filter: { brightness: 1 }, blend: { clip: false } },
          { type: 'line', rotation: 45, size: 0.85, params: { thick: 0.012 }, filter: { brightness: 1 }, blend: { opacity: 0.85 } },
          { type: 'line', rotation: -45, size: 0.85, params: { thick: 0.012 }, filter: { brightness: 1 }, blend: { opacity: 0.85 } },
        ],
      }],
    },
    {
      name: 'Forest Hexagram',
      shapes: [
        { type: 'triangle-down', x: 0.5, y: 0.42, size: 0.95, filter: Object.assign({ gray: 1 }, frost(0.45, 0.1)), blend: { mode: 'screen', opacity: 0.75 } },
        { type: 'triangle', x: 0.5, y: 0.58, size: 0.8, content: { flipX: true }, filter: { gray: 0.4, saturation: 0.6, hue: 25 }, blend: { mode: 'multiply', opacity: 0.9 }, stroke: { width: 2, color: '#3050ff', opacity: 0.8 } },
      ],
    },
    {
      name: 'Glacier Diamond',
      shapes: [{
        type: 'diamond', x: 0.5, y: 0.47, size: 0.92, hollow: true, hollowThick: 0.18,
        content: { rotate: 90, zoom: 1.25 }, filter: { saturation: 0.25 },
        children: [
          { type: 'square', size: 0.58, content: { zoom: 1.7, offY: -0.1 }, filter: { contrast: 0.15, saturation: 0.15 } },
          { type: 'circle', size: 0.48, x: 0.15, y: 0.05, content: { flipX: true }, blend: { mode: 'normal', opacity: 0.6 } },
        ],
      }],
    },
    {
      name: 'Star Flip Subtract',
      shapes: [{ type: 'star', x: 0.5, y: 0.5, size: 0.8, content: { rotate: 180 }, blend: { mode: 'subtract' }, stroke: { width: 2, opacity: 0.7 } }],
    },
    {
      name: 'Nested Inversions',
      shapes: [{
        type: 'triangle-down', x: 0.5, y: 0.47, size: 0.95, content: { flipY: true },
        children: [{
          type: 'triangle-down', size: 0.62, filter: { gray: 1 }, content: { flipX: true },
          children: [{ type: 'triangle-down', size: 0.6, filter: { invert: 1 }, blend: { mode: 'normal', opacity: 0.85 } }],
        }],
      }],
    },
    {
      name: 'Square Tunnel',
      shapes: [{ type: 'square', x: 0.5, y: 0.5, size: 0.9, content: { zoom: 1.12 }, stroke: { width: 1.5, opacity: 0.8 }, repeat: { count: 9, scale: 0.84, rotate: 7 } }],
    },
    {
      name: 'Kaleido Hex',
      shapes: [{ type: 'hexagon', x: 0.5, y: 0.5, size: 0.85, content: { kaleido: 6 }, filter: { saturation: 0.3 }, stroke: { width: 3, color: '#ffffff' }, shadow: { opacity: 0.5, blur: 30, dy: 12 } }],
    },
    {
      name: 'Prism Split',
      shapes: [{ type: 'triangle', x: 0.5, y: 0.55, size: 0.85, content: { chroma: 14, zoom: 1.15 }, filter: { hue: 35, saturation: 0.4 }, blend: { mode: 'screen', opacity: 0.85 }, stroke: { width: 1.5 } }],
    },
    {
      name: 'Duotone Circle',
      shapes: [{
        type: 'circle', x: 0.5, y: 0.5, size: 0.7, content: { flipX: true }, filter: { duo: 1, contrast: 0.2 },
        children: [{ type: 'ring', size: 1.08, params: { thick: 0.06 }, filter: { brightness: 1 }, blend: { clip: false, opacity: 0.9 } }],
      }],
    },
    {
      name: 'Honeycomb',
      shapes: [{
        type: 'hexagon', x: 0.5, y: 0.5, size: 0.3, content: { zoom: 1.4 }, filter: { gray: 1 }, stroke: { width: 2 },
        children: [[0, -1.8], [1.56, -0.9], [1.56, 0.9], [0, 1.8], [-1.56, 0.9], [-1.56, -0.9]].map(([x, y], i) => ({
          type: 'hexagon', x, y, size: 1, content: { rotate: i * 60 }, filter: { hue: i * 50 - 120, saturation: 0.3 },
          stroke: { width: 2 }, blend: { clip: false, mode: i % 2 ? 'normal' : 'overlay' },
        })),
      }],
    },
    {
      name: 'Inverted Moon',
      shapes: [{ type: 'crescent', x: 0.5, y: 0.5, size: 0.75, rotation: -25, content: { rotate: 180 }, blend: { mode: 'difference' }, shadow: { opacity: 0.6, color: '#ffffff', blur: 40, dx: 0, dy: 0 } }],
    },
    {
      name: 'Twirl Portal',
      shapes: [{
        type: 'circle', x: 0.5, y: 0.5, size: 0.7, content: { twirl: 1.6 }, filter: { saturation: 0.3 }, stroke: { width: 4 },
        children: [{ type: 'circle', size: 0.35, content: { twirl: -2 }, filter: { invert: 1 }, blend: { mode: 'luminosity' } }],
      }],
    },
    {
      name: 'Pixel Heart',
      shapes: [{ type: 'heart', x: 0.5, y: 0.5, size: 0.7, content: { pixelate: 18 }, filter: { saturation: 0.5, hue: -20 }, stroke: { width: 2 }, shadow: { opacity: 0.45, blur: 20 } }],
    },
    {
      name: 'Shattered Shards',
      shapes: [
        { type: 'triangle', x: 0.38, y: 0.42, size: 0.42, rotation: 15, content: { offX: 0.3, rotate: 25 }, stroke: { width: 1.5 } },
        { type: 'triangle-right', x: 0.62, y: 0.55, size: 0.38, rotation: -20, content: { offY: -0.4, flipX: true }, filter: { gray: 1 }, stroke: { width: 1.5 } },
        { type: 'kite', x: 0.5, y: 0.65, size: 0.3, rotation: 110, content: { rotate: -40 }, filter: { invert: 1 }, blend: { mode: 'difference' } },
        { type: 'triangle-tall', x: 0.7, y: 0.32, size: 0.3, rotation: 200, content: { zoom: 1.6 }, filter: { hue: 90 } },
      ],
    },
    {
      name: 'Sunburst Glass',
      shapes: [{ type: 'starburst', x: 0.5, y: 0.5, size: 0.8, params: { points: 32, inner: 0.82 }, content: { zoom: 0.8 }, filter: Object.assign({ brightness: 0.05 }, frost(0.35, 0.05, 90)), stroke: { width: 1, opacity: 0.6 } }],
    },
    {
      name: 'Posterized Pentagram',
      shapes: [{ type: 'pentagram', x: 0.5, y: 0.52, size: 0.8, content: { mirror: 'left' }, filter: { posterize: 4, saturation: 0.4 }, blend: { mode: 'hard-light', opacity: 0.85 }, stroke: { width: 2 } }],
    },
    {
      name: 'Sepia Window',
      shapes: [{
        type: 'square', x: 0.5, y: 0.5, size: 0.7, rotation: 45, filter: { sepia: 1, noise: 0.12 }, content: { zoom: 1.3 },
        children: [{ type: 'square', size: 0.6, rotation: -45, filter: { sepia: 0, saturation: 0.3 }, content: { rotate: 90 } }],
      }],
    },
    {
      name: 'Threshold Bolt',
      shapes: [{ type: 'bolt', x: 0.5, y: 0.5, size: 0.75, filter: { threshold: 0.5 }, blend: { mode: 'overlay' }, stroke: { width: 3, color: '#ffe14a' }, shadow: { opacity: 0.7, color: '#ffe14a', blur: 35, dx: 0, dy: 0 } }],
    },
  ];

  root.POLYSCAPE_PRESETS = PRESETS;
})(typeof window !== 'undefined' ? window : globalThis);
