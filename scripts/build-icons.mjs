#!/usr/bin/env node
// Renders extension/icons/icon.svg to the PNG sizes the manifest needs.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const svg = await readFile(new URL('../extension/icons/icon.svg', import.meta.url));
for (const size of [16, 32, 48, 128]) {
  const out = fileURLToPath(new URL(`../extension/icons/icon${size}.png`, import.meta.url));
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(`icon${size}.png`);
}
