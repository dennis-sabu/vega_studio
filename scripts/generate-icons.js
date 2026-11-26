/**
 * Generates obsidian + cool-blue VEGA Studio PNG and SVG desktop icons cleanly
 * with built-in Node.js zlib (zero external image-processing dependencies).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const OUT_DIR = path.join(__dirname, '..', 'build');
const ICONS_DIR = path.join(OUT_DIR, 'icons');

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function signedRoundedRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function blendPixel(rgba, idx, r, g, b, a) {
  const srcA = clamp01(a);
  if (srcA <= 0) return;
  const dstR = rgba[idx];
  const dstG = rgba[idx + 1];
  const dstB = rgba[idx + 2];
  const dstA = rgba[idx + 3] / 255;

  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;

  rgba[idx] = Math.round((r * srcA + dstR * dstA * (1 - srcA)) / outA);
  rgba[idx + 1] = Math.round((g * srcA + dstG * dstA * (1 - srcA)) / outA);
  rgba[idx + 2] = Math.round((b * srcA + dstB * dstA * (1 - srcA)) / outA);
  rgba[idx + 3] = Math.round(outA * 255);
}

function renderVegaIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const pxScale = size / 512;
  const aa = 1.0 / Math.max(1, pxScale);
  const c = 256;

  // Background squircle & microchip layout in 512x512 virtual space
  const bgHw = 232;
  const bgR = 96;
  const frameStroke = 14;
  const chipHw = 122;
  const chipR = 28;
  const coreHw = 62;
  const coreR = 14;

  const pinOffsets = [-68, 0, 68];

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const idx = (py * size + px) * 4;
      const x = (px + 0.5) / pxScale;
      const y = (py + 0.5) / pxScale;

      // 1. Obsidian rounded square base (#080b13 with subtle cool radial lift)
      const bgDist = signedRoundedRect(x, y, c, c, bgHw, bgHw, bgR);
      const bgAlpha = clamp01(0.5 - bgDist / (1.5 * aa));
      if (bgAlpha <= 0) continue;

      const rad = Math.hypot(x - c, y - c) / 280;
      const lift = Math.max(0, 1 - rad);
      const baseR = Math.round(8 + lift * 11);
      const baseG = Math.round(11 + lift * 16);
      const baseB = Math.round(19 + lift * 31);
      blendPixel(rgba, idx, baseR, baseG, baseB, bgAlpha);

      // Subtle hairline inner border (#7aa2ff at ~26% opacity)
      if (bgDist > -frameStroke && bgDist < 0) {
        const ringAlpha =
          clamp01((bgDist + frameStroke) / aa) *
          clamp01(-bgDist / aa) *
          0.26;
        blendPixel(rgba, idx, 122, 162, 255, ringAlpha);
      }

      // 2. Top/bottom/left/right CPU pins (#7aa2ff / #b5ccff)
      for (const offset of pinOffsets) {
        // Horizontal leads (left/right)
        const lx = Math.abs(x - c);
        if (lx >= chipHw && lx <= chipHw + 42) {
          const pinDist = Math.abs(y - (c + offset)) - 11;
          const pa = clamp01(0.5 - pinDist / aa);
          if (pa > 0) blendPixel(rgba, idx, 122, 162, 255, pa * 0.92);
        }
        // Vertical leads (top/bottom)
        const ly = Math.abs(y - c);
        if (ly >= chipHw && ly <= chipHw + 42) {
          const pinDist = Math.abs(x - (c + offset)) - 11;
          const pa = clamp01(0.5 - pinDist / aa);
          if (pa > 0) blendPixel(rgba, idx, 122, 162, 255, pa * 0.92);
        }
      }

      // 3. Outer CPU package outline + dark interior fill
      const chipDist = signedRoundedRect(x, y, c, c, chipHw, chipHw, chipR);
      const chipFillAlpha = clamp01(0.5 - chipDist / aa);
      if (chipFillAlpha > 0) {
        blendPixel(rgba, idx, 14, 19, 34, chipFillAlpha);
      }
      const chipOutlineDist = Math.abs(chipDist) - 12;
      const chipOutlineAlpha = clamp01(0.5 - chipOutlineDist / aa);
      if (chipOutlineAlpha > 0) {
        blendPixel(rgba, idx, 122, 162, 255, chipOutlineAlpha);
      }

      // 4. Inner RISC-V silicon core rectangle (#7aa2ff gradient -> #e8ebf7 sheen)
      const coreDist = signedRoundedRect(x, y, c, c, coreHw, coreHw, coreR);
      const coreAlpha = clamp01(0.5 - coreDist / aa);
      if (coreAlpha > 0) {
        const coreGrad = clamp01((c - y + coreHw) / (coreHw * 2));
        const cr = Math.round(104 + coreGrad * 44);
        const cg = Math.round(146 + coreGrad * 44);
        const cb = 255;
        blendPixel(rgba, idx, cr, cg, cb, coreAlpha * 0.92);
      }
    }
  }

  return rgba;
}

const SVG_SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg-glow" cx="50%" cy="46%" r="54%">
      <stop offset="0%" stop-color="#131b32"/>
      <stop offset="100%" stop-color="#080b13"/>
    </radialGradient>
    <linearGradient id="core-grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#94b6ff"/>
      <stop offset="100%" stop-color="#6892ff"/>
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="96" fill="url(#bg-glow)" stroke="#7aa2ff" stroke-opacity="0.28" stroke-width="10"/>
  <g stroke="#7aa2ff" stroke-width="22" stroke-linecap="round">
    <line x1="188" y1="92" x2="188" y2="134"/>
    <line x1="256" y1="92" x2="256" y2="134"/>
    <line x1="324" y1="92" x2="324" y2="134"/>
    <line x1="188" y1="378" x2="188" y2="420"/>
    <line x1="256" y1="378" x2="256" y2="420"/>
    <line x1="324" y1="378" x2="324" y2="420"/>
    <line x1="92" y1="188" x2="134" y2="188"/>
    <line x1="92" y1="256" x2="134" y2="256"/>
    <line x1="92" y1="324" x2="134" y2="324"/>
    <line x1="378" y1="188" x2="420" y2="188"/>
    <line x1="378" y1="256" x2="420" y2="256"/>
    <line x1="378" y1="324" x2="420" y2="324"/>
  </g>
  <rect x="134" y="134" width="244" height="244" rx="28" fill="#0e1322" stroke="#7aa2ff" stroke-width="22"/>
  <rect x="194" y="194" width="124" height="124" rx="14" fill="url(#core-grad)"/>
</svg>
`;

function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'vega-studio.svg'), SVG_SOURCE, 'utf8');

  for (const size of SIZES) {
    const rgba = renderVegaIcon(size);
    const png = encodePng(size, size, rgba);
    fs.writeFileSync(path.join(ICONS_DIR, `${size}x${size}.png`), png);
    if (size === 512) {
      fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);
    }
  }

  console.log(
    `[generate-icons] Generated ${SIZES.length} PNG icon sizes + SVG icon in ${OUT_DIR}`
  );
}

main();
