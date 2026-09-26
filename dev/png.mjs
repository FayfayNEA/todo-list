// A tiny PNG writer, so the pretend accounts get real pictures without shipping any.
import zlib from 'node:zlib';
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
// Soft blobs of colour over a two-colour wash. `a`, `b` and the blob colours are [r,g,b].
export function dreamyPng(w, h, a, b, blobs, seed = 1) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const spots = blobs.map((col) => ({ col, x: rnd() * w, y: rnd() * h, r: (0.12 + rnd() * 0.22) * Math.max(w, h) }));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      let px = [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
      for (const sp of spots) {
        const d = Math.hypot(x - sp.x, y - sp.y) / sp.r;
        if (d < 1) { const k = (1 - d * d) * 0.55; px = px.map((v, i) => v + (sp.col[i] - v) * k); }
      }
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}
