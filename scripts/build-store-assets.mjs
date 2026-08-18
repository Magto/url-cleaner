#!/usr/bin/env node
// Renders docs/store/screenshot-1.png (1280x800, no alpha) for the
// Chrome Web Store listing.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const icon = (await readFile(new URL('../extension/icons/icon.svg', import.meta.url), 'utf8'))
  // strip the outer svg tag so it can be inlined as a group
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <rect width="1280" height="800" fill="#f4f7fb"/>

  <!-- header -->
  <g transform="translate(90 70) scale(1.1)">${icon}</g>
  <text x="260" y="140" font-family="Arial" font-size="64" font-weight="700" fill="#1c2733">URL Cleaner</text>
  <text x="260" y="190" font-family="Arial" font-size="28" fill="#5a6b7c">Copy clean links — tracking junk removed, automatically.</text>

  <!-- before card -->
  <rect x="90" y="280" width="1100" height="170" rx="14" fill="#ffffff" stroke="#e3e8ef"/>
  <rect x="90" y="280" width="8" height="170" rx="4" fill="#c62828"/>
  <text x="126" y="322" font-family="Arial" font-size="20" font-weight="700" fill="#c62828" letter-spacing="2">BEFORE</text>
  <text x="126" y="360" font-family="Consolas, Courier New" font-size="21" fill="#38424d">https://www.amazon.se/Bosch-professionell-.../dp/B083DP4LXH<tspan fill="#c62828">?pd_rd_w=InoTU</tspan></text>
  <text x="126" y="392" font-family="Consolas, Courier New" font-size="21" fill="#c62828">&amp;content-id=amzn1.sym.7832760a-c497-4514-a1e7-...&amp;pf_rd_p=7832760a-c497...</text>
  <text x="126" y="424" font-family="Consolas, Courier New" font-size="21" fill="#c62828">&amp;pf_rd_r=ZQHK69DNCXG5NYE08Z9B&amp;pd_rd_wg=FU4eL&amp;pd_rd_r=9b1ea2fa-31b6-...</text>

  <!-- arrow + count -->
  <path d="M640 470 v40 m-14 -16 l14 18 l14 -18" stroke="#f0a818" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="680" y="502" font-family="Arial" font-size="24" fill="#5a6b7c">8 tracking parameters removed</text>

  <!-- after card -->
  <rect x="90" y="540" width="1100" height="110" rx="14" fill="#ffffff" stroke="#cde7d0"/>
  <rect x="90" y="540" width="8" height="110" rx="4" fill="#2e7d32"/>
  <text x="126" y="582" font-family="Arial" font-size="20" font-weight="700" fill="#2e7d32" letter-spacing="2">AFTER</text>
  <text x="126" y="622" font-family="Consolas, Courier New" font-size="23" fill="#1c2733">https://www.amazon.se/Bosch-professionell-.../dp/B083DP4LXH</text>

  <!-- footer -->
  <text x="90" y="730" font-family="Arial" font-size="24" fill="#5a6b7c">Alt+Shift+C to copy clean · address bar auto-cleans in place · no data collection · open source</text>
</svg>`;

const out = fileURLToPath(new URL('../docs/store/screenshot-1.png', import.meta.url));
await sharp(Buffer.from(svg), { density: 96 })
  .resize(1280, 800) // the store requires exactly 1280x800; density scaling otherwise yields 1707x1067
  .flatten({ background: '#f4f7fb' })
  .removeAlpha()
  .png()
  .toFile(out);
console.log('docs/store/screenshot-1.png');

