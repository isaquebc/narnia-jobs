// Ícone da extensão sem dependências: a porta do logo do narnia-jobs (docs/assets/logo.svg) rasterizada em PNG RGBA.
// O desenho usa a grade 34×34 do SVG: quadrado arredondado (1..33, raio 9), batentes em x = 11 e 23 (y 15..26),
// arco de raio 6 centrado em (17, 15), traço de 2,6 com pontas redondas e a maçaneta em (20, 20), raio 1,6.
import { deflateSync } from "node:zlib";

const BG = [15, 92, 90];
const DOOR = [255, 255, 255];
const KNOB = [224, 138, 98];
const SAMPLES = 4; // 4×4 amostras por pixel (borda suave)

function inRoundRect(u, v) {
  if (u < 1 || u > 33 || v < 1 || v > 33) return false;
  const cx = Math.min(Math.max(u, 10), 24);
  const cy = Math.min(Math.max(v, 10), 24);
  return Math.hypot(u - cx, v - cy) <= 9;
}

function doorDistance(u, v) {
  const side = (x) =>
    v >= 15 && v <= 26 ? Math.abs(u - x) : Math.hypot(u - x, v - (v < 15 ? 15 : 26));
  const arc = v <= 15 ? Math.abs(Math.hypot(u - 17, v - 15) - 6) : Number.POSITIVE_INFINITY;
  return Math.min(side(11), side(23), arc);
}

/** Pixels RGBA (linha a linha) do ícone de lado `size`. */
export function iconPixels(size) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = ((x + (sx + 0.5) / SAMPLES) / size) * 34;
          const v = ((y + (sy + 0.5) / SAMPLES) / size) * 34;
          if (!inRoundRect(u, v)) continue;
          inside++;
          const c =
            Math.hypot(u - 20, v - 20) <= 1.6 ? KNOB : doorDistance(u, v) <= 1.3 ? DOOR : BG;
          for (let k = 0; k < 3; k++) sum[k] += c[k];
        }
      }
      const o = (y * size + x) * 4;
      if (inside === 0) continue;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(sum[k] / inside);
      px[o + 3] = Math.round((inside / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return px;
}

/** PNG do ícone de lado `size`. */
export function iconPng(size) {
  const px = iconPixels(size);
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0]), Buffer.from(px.subarray(y * size * 4, (y + 1) * size * 4)));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
