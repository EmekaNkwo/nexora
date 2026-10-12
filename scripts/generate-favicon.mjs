/**
 * Generates `src/app/favicon.ico` from the same geometry as `src/app/icon.svg`.
 *
 * Why generate rather than hand-draw: modern browsers take the SVG icon, but
 * older ones and some embedders still fetch `/favicon.ico`, and Next emits a
 * link for it whenever the file exists. Leaving the stock Next icon there meant
 * a share card or an old browser showed someone else's branding.
 *
 * Why no image library: the mark is a rounded rectangle, four circular arcs and
 * a dot — all expressible as distance tests, so rasterising it directly is a
 * few dozen lines and avoids adding a dependency that exists to run once.
 * Geometry is kept in the glyph's own 24-unit space so it can be compared
 * against the SVG by eye.
 *
 * Usage: node scripts/generate-favicon.mjs
 */
import { writeFileSync } from "node:fs";

const TILE = { radius: 7, fill: [0x0b, 0x0d, 0x10] };
const STROKE = [0x22, 0xb5, 0xe1];

/** Glyph placement inside the tile, matching the SVG's transform. */
const GLYPH = { offset: 6, scale: 0.8333, centre: 12 };
const HALF_STROKE = 1.3;
const ARC_HALF_SPAN = (45 * Math.PI) / 180;
const DOT_RADIUS = 3;
const ARC_RADII = [6, 10];

/** 4× in each axis — enough to keep the arcs smooth at 32px. */
const SAMPLES = 4;

function insideRoundedSquare(x, y, size, radius) {
  const dx = Math.max(radius - x, x - (size - radius), 0);
  const dy = Math.max(radius - y, y - (size - radius), 0);
  return Math.hypot(dx, dy) <= radius;
}

/** True when (x, y) in tile space lands on the radio glyph's ink. */
function onGlyph(x, y) {
  const u = (x - GLYPH.offset) / GLYPH.scale;
  const v = (y - GLYPH.offset) / GLYPH.scale;
  const dx = u - GLYPH.centre;
  const dy = v - GLYPH.centre;
  const radius = Math.hypot(dx, dy);

  if (radius <= DOT_RADIUS) return true;

  // Both arc pairs open left and right, spanning ±45° about the horizontal.
  const angle = Math.atan2(dy, dx);
  const fromHorizontal = Math.min(
    Math.abs(angle),
    Math.abs(Math.abs(angle) - Math.PI),
  );
  if (fromHorizontal > ARC_HALF_SPAN) return false;

  return ARC_RADII.some((r) => Math.abs(radius - r) <= HALF_STROKE);
}

/** Supersampled BGRA for one square icon size. */
function render(size) {
  const scale = size / 32;
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let tile = 0;
      let ink = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / scale;
          const y = (py + (sy + 0.5) / SAMPLES) / scale;
          if (!insideRoundedSquare(x, y, 32, TILE.radius)) continue;
          tile += 1;
          if (onGlyph(x, y)) ink += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const alpha = tile / total;
      const inkRatio = tile === 0 ? 0 : ink / tile;

      // Composite the stroke over the tile, then apply the tile's own coverage
      // as alpha so the rounded corners stay antialiased.
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = TILE.fill[channel];
        const over = STROKE[channel];
        const value = base + (over - base) * inkRatio;
        // ICO stores BGRA, so the channel order is reversed on write.
        pixels[offset + (2 - channel)] = Math.round(value);
      }
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/** One ICO image: BITMAPINFOHEADER, bottom-up BGRA rows, then the AND mask. */
function encodeImage(size, pixels) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  // Doubled height is the format's way of describing XOR + AND masks.
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const rows = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4;
    pixels.copy(rows, y * size * 4, source, source + size * 4);
  }

  // Alpha carries transparency; the mask is required but can be all-opaque.
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);

  return Buffer.concat([header, rows, mask]);
}

function buildIco(sizes) {
  const images = sizes.map((size) => encodeImage(size, render(size)));

  const directory = Buffer.alloc(6);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);

  let offset = 6 + sizes.length * 16;
  const entries = sizes.map((size, index) => {
    const entry = Buffer.alloc(16);
    // 256px is stored as 0; none of our sizes hit that, but be explicit.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(images[index].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[index].length;
    return entry;
  });

  return Buffer.concat([directory, ...entries, ...images]);
}

const ico = buildIco([16, 32, 48]);
writeFileSync("src/app/favicon.ico", ico);
console.log(`wrote src/app/favicon.ico — ${ico.length} bytes, sizes 16/32/48`);
