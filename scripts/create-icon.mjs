import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
// Original raster icon. No external art or copyrighted template assets.
const size = 256,
  raw = Buffer.alloc((size * 4 + 1) * size);
const purple = [186, 164, 229],
  peach = [252, 193, 159],
  black = [5, 5, 9];
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const index = y * (size * 4 + 1) + 1 + x * 4;
    const round =
      Math.hypot(Math.max(0, Math.abs(x - 128) - 78), Math.max(0, Math.abs(y - 128) - 78)) <= 38;
    let color = black;
    if (x >= 20 && x < 58 && y > 26 && y < 226) color = purple;
    if (x >= 20 && x < 230 && y > 26 && y < 57) color = purple;
    if (x >= 20 && x < 230 && y > 199 && y < 226) color = peach;
    if (
      y >= 79 &&
      y <= 175 &&
      Math.abs(x - 145) <= (y - 79) * 0.47 &&
      (y < 145 || Math.abs(x - 145) >= (y - 145) * 0.72)
    )
      color = peach;
    if (x >= 195 && x <= 230 && y >= 78 && y <= 91) color = purple;
    if (x >= 213 && x <= 230 && y >= 104 && y <= 117) color = purple;
    if ((y >= 121 && y <= 128) || (x >= 179 && x <= 187 && y > 196)) color = black;
    raw[index] = color[0];
    raw[index + 1] = color[1];
    raw[index + 2] = color[2];
    raw[index + 3] = round ? 255 : 0;
  }
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const b of buffer) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([length, t, data, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
writeFileSync('build/icon.ico', Buffer.concat([icoHeader, png]));
