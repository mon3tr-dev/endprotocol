// Regenerate the Android adaptive-icon foregrounds from `src-tauri/icons/icon.png`
// so the glyph fits inside the 66dp safe zone of the 108dp adaptive canvas.
//
// Why this exists: `tauri icon` maps the source straight onto the 108dp foreground
// layer with no safe-zone inset, and our chain-link mark fills ~86% of the source
// canvas. Adaptive icons only guarantee the central 66dp circle is visible (the
// launcher mask crops everything else), so the mark's corners were being clipped.
//
// The scale factor is derived from the artwork itself rather than hard-coded: we
// measure the furthest opaque pixel from the canvas centre and solve for the factor
// that lands it exactly on the 66dp safe-zone radius.
import fs from "node:fs";
import zlib from "node:zlib";

const SAFE_ZONE_DP = 66;
const CANVAS_DP = 108;
// Resampling spreads the outermost antialiased pixels slightly past the geometric
// edge, so aim a hair inside the documented radius instead of exactly at it.
const SAFETY_MARGIN_DP = 1;

// density -> foreground layer size in px (108dp at that density)
const TARGETS = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType})`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, ch, data: out };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "ascii");
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Box-filter downscale with premultiplied alpha, centring the scaled artwork.
function resample(src, size, scale) {
  const { width, height, ch, data } = src;
  const dst = Buffer.alloc(size * size * 4);
  // Source centre maps to destination centre.
  const srcCx = width / 2;
  const srcCy = height / 2;
  const dstCx = size / 2;
  const dstCy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // destination pixel -> source-space rectangle
      const sx0 = (x - dstCx) / scale + srcCx;
      const sy0 = (y - dstCy) / scale + srcCy;
      const sx1 = (x + 1 - dstCx) / scale + srcCx;
      const sy1 = (y + 1 - dstCy) / scale + srcCy;
      const x0 = Math.max(0, Math.floor(sx0));
      const x1 = Math.min(width, Math.ceil(sx1));
      const y0 = Math.max(0, Math.floor(sy0));
      const y1 = Math.min(height, Math.ceil(sy1));
      const di = (y * size + x) * 4;
      if (x1 <= x0 || y1 <= y0) {
        dst[di + 3] = 0;
        continue;
      }
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const si = (yy * width + xx) * ch;
          const pa = ch === 4 ? data[si + 3] : 255;
          r += data[si] * pa;
          g += data[si + 1] * pa;
          b += data[si + 2] * pa;
          a += pa;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      if (a === 0) {
        dst[di + 3] = 0;
      } else {
        dst[di] = Math.round(r / a);
        dst[di + 1] = Math.round(g / a);
        dst[di + 2] = Math.round(b / a);
        dst[di + 3] = Math.round(a / n);
      }
    }
  }
  return dst;
}

function maxRadiusFraction(img) {
  const { width, height, ch, data } = img;
  let maxR = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = ch === 4 ? data[(y * width + x) * ch + 3] : 255;
      if (a <= 16) continue;
      const dx = x - width / 2 + 0.5;
      const dy = y - height / 2 + 0.5;
      const r = Math.hypot(dx, dy);
      if (r > maxR) maxR = r;
    }
  }
  return maxR / (width / 2);
}

const srcPath = "src-tauri/icons/icon.png";
const source = decodePng(fs.readFileSync(srcPath));

// Fraction of the canvas' half-width that the furthest opaque pixel occupies.
const srcFraction = maxRadiusFraction(source);
// Target: that fraction must shrink to SAFE_ZONE_DP/2 out of CANVAS_DP/2.
const targetFraction = (SAFE_ZONE_DP / 2 - SAFETY_MARGIN_DP) / (CANVAS_DP / 2);
// Extra shrink applied on top of the plain "fit source to canvas" mapping. A glyph
// radius fraction `f` of the source half-size lands at `f * fit * shrink` of the
// destination half-size, so solving for the safe zone gives `targetFraction / f`.
const shrink = targetFraction / srcFraction;

console.log(`source ${srcPath} (${source.width}px) glyph radius = ${(srcFraction * 100).toFixed(2)}% of half-canvas`);
console.log(`safe zone ${SAFE_ZONE_DP}dp of ${CANVAS_DP}dp => ${(targetFraction * 100).toFixed(2)}% of half-canvas`);
console.log(`artwork shrink = ${shrink.toFixed(4)}\n`);

for (const [density, size] of TARGETS) {
  // Foreground layer is `size` px and represents the full 108dp canvas. The total
  // source->destination scale combines the density fit with the safe-zone shrink.
  const fit = size / source.width;
  const scaled = resample(source, size, fit * shrink);
  const outPath = `src-tauri/icons/android/mipmap-${density}/ic_launcher_foreground.png`;
  fs.writeFileSync(outPath, encodePng(size, scaled));

  const check = { width: size, height: size, ch: 4, data: scaled };
  const got = maxRadiusFraction(check);
  const radiusDp = (got * CANVAS_DP) / 2;
  console.log(
    `${density.padEnd(8)} ${String(size).padStart(3)}px  glyph radius ${radiusDp.toFixed(2)}dp ` +
      `(${radiusDp <= SAFE_ZONE_DP / 2 ? "inside" : "OUTSIDE"} ${SAFE_ZONE_DP / 2}dp safe radius)`,
  );
}
