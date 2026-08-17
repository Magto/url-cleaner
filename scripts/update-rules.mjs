#!/usr/bin/env node
// Fetches the latest ClearURLs ruleset and rewrites the bundled snapshot.
import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://rules2.clearurls.xyz/data.minify.json';
const TARGET = new URL('../extension/rules/clearurls.json', import.meta.url);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
const data = await res.json();
const count = Object.keys(data.providers ?? {}).length;
if (count < 100) throw new Error(`Suspicious ruleset: only ${count} providers`);
await writeFile(TARGET, JSON.stringify(data, null, 1));
console.log(`Wrote ${count} providers to extension/rules/clearurls.json`);
