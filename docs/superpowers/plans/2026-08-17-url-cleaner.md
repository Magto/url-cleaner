# URL Cleaner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 WebExtension (Chrome + Safari) that strips tracking parameters from URLs — via a clean-copy keyboard shortcut/popup and via automatic in-place address-bar rewriting.

**Architecture:** A pure ES-module cleaning engine (`extension/lib/cleaner.js`) implements ClearURLs rule semantics and is unit-tested with vitest. A module service worker loads the bundled ruleset and answers `{type:'clean'}` messages; a content script rewrites the address bar with `history.replaceState`; a popup provides copy + per-site toggle. No bundler, no build step — the `extension/` folder is loaded directly by Chrome and fed to Safari's converter.

**Tech Stack:** Plain JavaScript (ES modules), WebExtension Manifest V3, vitest for unit tests, Node 20+ for scripts.

**Spec:** `docs/superpowers/specs/2026-08-17-url-cleaner-design.md`

## Global Constraints

- Working directory for ALL commands: `C:\Users\marti\claude-project\url-cleaner`
- `extension/lib/cleaner.js` is a **pure module**: no `chrome`/`browser`/DOM APIs, ever
- All extension chrome code obtains the API object via `const api = globalThis.browser ?? globalThis.chrome;` (Safari compatibility)
- Manifest V3; background is `"type": "module"` service worker (Chrome + Safari 16.4+)
- No runtime network calls in the extension; rules are bundled JSON
- The engine **never throws** — any failure returns the input URL unchanged with `removed: []`
- Keyboard shortcut default is `Alt+Shift+C` (`Ctrl+Shift+C` is reserved by Chrome DevTools)
- Node's built-in `fetch` is used in scripts (Node 20+); vitest is the only dev dependency
- Test command: `npx vitest run` (all tests must pass before every commit)

---

### Task 1: Repo scaffold + engine core (global query-param removal)

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `extension/lib/cleaner.js`
- Test: `tests/cleaner.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `cleanUrl(urlString, providers, opts?) → { cleaned: string, removed: string[] }` — `providers` is a map `{ [name]: { urlPattern, rules?, rawRules?, exceptions?, redirections?, referralMarketing? } }` of ClearURLs-style providers; `opts` is `{ unwrap?: boolean }` (unwrap ignored until Task 4). All later tasks call exactly this signature.

- [ ] **Step 1: Scaffold**

Create `package.json`:

```json
{
  "name": "url-cleaner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "update-rules": "node scripts/update-rules.mjs"
  }
}
```

Create `.gitignore`:

```
node_modules/
safari-build/
```

Run: `npm install --save-dev vitest`

- [ ] **Step 2: Write the failing tests**

Create `tests/cleaner.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { cleanUrl } from '../extension/lib/cleaner.js';

const GLOBAL_ONLY = {
  globalRules: {
    urlPattern: '.*',
    rules: ['utm_(?:source|medium|campaign|term|content)', 'fbclid', 'gclid'],
  },
};

describe('global query-param removal', () => {
  it('removes utm_* params and reports them', () => {
    const { cleaned, removed } = cleanUrl(
      'https://example.com/page?utm_source=news&utm_medium=email&id=42',
      GLOBAL_ONLY,
    );
    expect(cleaned).toBe('https://example.com/page?id=42');
    expect(removed).toEqual(['utm_source', 'utm_medium']);
  });

  it('drops the ? entirely when all params are junk', () => {
    const { cleaned } = cleanUrl('https://example.com/page?fbclid=abc123', GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/page');
  });

  it('preserves the fragment', () => {
    const { cleaned } = cleanUrl('https://example.com/p?gclid=x&a=1#section', GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/p?a=1#section');
  });

  it('preserves encoding of kept params byte-for-byte', () => {
    const input = 'https://example.com/s?q=r%C3%B6d%20f%C3%A4rg&utm_source=x';
    const { cleaned } = cleanUrl(input, GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/s?q=r%C3%B6d%20f%C3%A4rg');
  });

  it('matches param names case-insensitively and as whole names only', () => {
    const { cleaned } = cleanUrl('https://example.com/?FBCLID=x&notfbclid=keep', GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/?notfbclid=keep');
  });

  it('passes an already-clean URL through byte-identical', () => {
    const input = 'https://example.com/path?real=1&also=2#frag';
    expect(cleanUrl(input, GLOBAL_ONLY).cleaned).toBe(input);
  });

  it('leaves non-http(s) URLs untouched', () => {
    const input = 'chrome://extensions/?utm_source=x';
    expect(cleanUrl(input, GLOBAL_ONLY)).toEqual({ cleaned: input, removed: [] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — cannot resolve `../extension/lib/cleaner.js`

- [ ] **Step 4: Implement the engine core**

Create `extension/lib/cleaner.js`:

```js
// Pure URL-cleaning engine implementing ClearURLs rule semantics.
// No browser APIs — unit-testable in Node.

export function cleanUrl(urlString, providers, opts = {}) {
  try {
    return cleanRecursive(urlString, providers, opts.unwrap === true, 0);
  } catch {
    return { cleaned: urlString, removed: [] };
  }
}

function cleanRecursive(urlString, providers, unwrap, depth) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { cleaned: urlString, removed: [] };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { cleaned: urlString, removed: [] };
  }

  let current = urlString;
  const removed = [];

  for (const provider of Object.values(providers)) {
    if (!provider || !safeTest(provider.urlPattern, current)) continue;

    const paramRules = [...(provider.rules ?? []), ...(provider.referralMarketing ?? [])];
    if (paramRules.length) current = stripQueryParams(current, paramRules, removed);
  }

  return { cleaned: current, removed };
}

// Query string is processed as raw &-separated segments so that kept
// params keep their original encoding byte-for-byte.
function stripQueryParams(urlString, paramRules, removed) {
  const qIndex = urlString.indexOf('?');
  if (qIndex === -1) return urlString;
  const hashIndex = urlString.indexOf('#', qIndex);
  const query = hashIndex === -1 ? urlString.slice(qIndex + 1) : urlString.slice(qIndex + 1, hashIndex);
  const hash = hashIndex === -1 ? '' : urlString.slice(hashIndex);
  if (query === '') return urlString;

  const kept = [];
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const name = decodeSafe(pair.split('=')[0]);
    if (paramRules.some((rule) => matchesWholeName(rule, name))) {
      removed.push(name);
    } else {
      kept.push(pair);
    }
  }
  const base = urlString.slice(0, qIndex);
  return kept.length ? `${base}?${kept.join('&')}${hash}` : `${base}${hash}`;
}

function matchesWholeName(pattern, value) {
  try {
    return new RegExp(`^(?:${pattern})$`, 'i').test(value);
  } catch {
    return false;
  }
}

function safeTest(pattern, value) {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore extension/lib/cleaner.js tests/cleaner.test.js
git commit -m "feat: engine core — global query-param removal"
```

---

### Task 2: Provider urlPattern matching + exceptions

**Files:**
- Modify: `extension/lib/cleaner.js`
- Test: `tests/cleaner.test.js` (append)

**Interfaces:**
- Consumes: `cleanUrl` from Task 1
- Produces: same signature; providers with non-matching `urlPattern` are skipped, providers with a matching entry in `exceptions[]` are skipped

- [ ] **Step 1: Write the failing tests**

Append to `tests/cleaner.test.js`:

```js
const SITE_PROVIDERS = {
  exampleShop: {
    urlPattern: '^https?://(?:[a-z0-9-]+\\.)*?shop\\.example\\.com',
    rules: ['tracker_.*'],
    exceptions: ['^https?://shop\\.example\\.com/checkout'],
  },
};

describe('provider matching and exceptions', () => {
  it('applies provider rules only on matching hosts', () => {
    const onSite = cleanUrl('https://shop.example.com/item?tracker_id=9&sku=1', SITE_PROVIDERS);
    expect(onSite.cleaned).toBe('https://shop.example.com/item?sku=1');

    const offSite = cleanUrl('https://other.example.org/item?tracker_id=9', SITE_PROVIDERS);
    expect(offSite.cleaned).toBe('https://other.example.org/item?tracker_id=9');
  });

  it('skips the provider entirely when an exception matches', () => {
    const input = 'https://shop.example.com/checkout?tracker_id=9&cart=abc';
    expect(cleanUrl(input, SITE_PROVIDERS).cleaned).toBe(input);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run`
Expected: FAIL — exception test: `tracker_id` was removed on the checkout URL

- [ ] **Step 3: Implement exceptions**

In `cleanRecursive`, directly after the `urlPattern` check, add:

```js
    if ((provider.exceptions ?? []).some((e) => safeTest(e, current))) continue;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/lib/cleaner.js tests/cleaner.test.js
git commit -m "feat: provider urlPattern matching with exceptions"
```

---

### Task 3: rawRules + referralMarketing

**Files:**
- Modify: `extension/lib/cleaner.js`
- Test: `tests/cleaner.test.js` (append)

**Interfaces:**
- Consumes: `cleanUrl`
- Produces: same signature; `rawRules[]` regexes are deleted from the raw URL string (flags `gi`), reported in `removed` as `raw:<pattern>`; `referralMarketing[]` entries are treated exactly like `rules[]` (already wired in Task 1's `paramRules` concat — this task proves it with a test)

- [ ] **Step 1: Write the failing tests**

Append to `tests/cleaner.test.js`:

```js
const RAW_PROVIDERS = {
  amazonLike: {
    urlPattern: '^https?://(?:[a-z0-9-]+\\.)*?amazon\\.(?:com|se|de)',
    rules: ['pd_rd_.*'],
    referralMarketing: ['tag'],
    rawRules: ['\\/ref\\=[^/?#]*'],
  },
};

describe('rawRules and referralMarketing', () => {
  it('removes raw path junk like Amazon /ref= segments', () => {
    const { cleaned, removed } = cleanUrl(
      'https://www.amazon.se/dp/B083DP4LXH/ref=sr_1_3?keywords=bosch',
      RAW_PROVIDERS,
    );
    expect(cleaned).toBe('https://www.amazon.se/dp/B083DP4LXH?keywords=bosch');
    expect(removed).toContain('raw:\\/ref\\=[^/?#]*');
  });

  it('treats referralMarketing params as junk', () => {
    const { cleaned } = cleanUrl('https://www.amazon.se/dp/B083DP4LXH?tag=affiliate-21', RAW_PROVIDERS);
    expect(cleaned).toBe('https://www.amazon.se/dp/B083DP4LXH');
  });
});
```

- [ ] **Step 2: Run tests to verify the raw-rule test fails**

Run: `npx vitest run`
Expected: FAIL — `/ref=sr_1_3` still present (referralMarketing test may already pass; that is fine)

- [ ] **Step 3: Implement rawRules**

In `cleanRecursive`, between the exceptions check and the `paramRules` block, add:

```js
    for (const raw of provider.rawRules ?? []) {
      let next = current;
      try {
        next = current.replace(new RegExp(raw, 'gi'), '');
      } catch {
        continue;
      }
      if (next !== current) {
        removed.push(`raw:${raw}`);
        current = next;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/lib/cleaner.js tests/cleaner.test.js
git commit -m "feat: rawRules path junk removal, referralMarketing as junk"
```

---

### Task 4: Redirect unwrapping (opt-in)

**Files:**
- Modify: `extension/lib/cleaner.js`
- Test: `tests/cleaner.test.js` (append)

**Interfaces:**
- Consumes: `cleanUrl`
- Produces: same signature; with `opts.unwrap === true`, a provider `redirections[]` regex whose capture group 1 matches yields the decoded target URL, which is then cleaned recursively (depth cap 5). Without `unwrap`, redirections are ignored (spec: auto-clean must NOT unwrap).

- [ ] **Step 1: Write the failing tests**

Append to `tests/cleaner.test.js`:

```js
const REDIRECT_PROVIDERS = {
  googleLike: {
    urlPattern: '^https?://(?:[a-z0-9-]+\\.)*?google\\.(?:com|se)',
    redirections: ['^https?://(?:[a-z0-9-]+\\.)*?google\\.(?:com|se)/url\\?.*?(?:url|q)=([^&]+)'],
  },
  globalRules: {
    urlPattern: '.*',
    rules: ['utm_(?:source|medium|campaign|term|content)'],
  },
};

describe('redirect unwrapping', () => {
  const wrapper =
    'https://www.google.se/url?q=' +
    encodeURIComponent('https://example.com/target?utm_source=google&x=1') +
    '&sa=D';

  it('unwraps and cleans the target when unwrap is on', () => {
    const { cleaned } = cleanUrl(wrapper, REDIRECT_PROVIDERS, { unwrap: true });
    expect(cleaned).toBe('https://example.com/target?x=1');
  });

  it('does NOT unwrap when unwrap is off (auto-clean mode)', () => {
    const { cleaned } = cleanUrl(wrapper, REDIRECT_PROVIDERS);
    expect(cleaned.startsWith('https://www.google.se/url?')).toBe(true);
  });

  it('ignores redirection targets that are not http(s)', () => {
    const bad = 'https://www.google.se/url?q=javascript%3Aalert(1)';
    const { cleaned } = cleanUrl(bad, REDIRECT_PROVIDERS, { unwrap: true });
    expect(cleaned.startsWith('https://www.google.se/url?')).toBe(true);
  });

  it('caps recursion on self-referencing wrappers', () => {
    const loop = 'https://www.google.se/url?q=' +
      encodeURIComponent('https://www.google.se/url?q=https%3A%2F%2Fwww.google.se%2Furl');
    // Must terminate and return a string — no stack overflow.
    expect(typeof cleanUrl(loop, REDIRECT_PROVIDERS, { unwrap: true }).cleaned).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — unwrap test returns the google.se wrapper instead of example.com

- [ ] **Step 3: Implement redirections**

At the top of `extension/lib/cleaner.js` add:

```js
const MAX_UNWRAP_DEPTH = 5;
```

In `cleanRecursive`, directly after the exceptions check (before rawRules), add:

```js
    if (unwrap && depth < MAX_UNWRAP_DEPTH) {
      for (const redirection of provider.redirections ?? []) {
        let match = null;
        try {
          match = current.match(new RegExp(redirection, 'i'));
        } catch {
          continue;
        }
        if (match && match[1]) {
          const target = decodeSafe(match[1]);
          if (!/^https?:\/\//i.test(target)) continue;
          const inner = cleanRecursive(target, providers, true, depth + 1);
          return {
            cleaned: inner.cleaned,
            removed: [...removed, 'redirect:unwrapped', ...inner.removed],
          };
        }
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/lib/cleaner.js tests/cleaner.test.js
git commit -m "feat: opt-in redirect unwrapping with depth cap"
```

---

### Task 5: Rules merge + never-throw hardening

**Files:**
- Modify: `extension/lib/cleaner.js`
- Create: `extension/rules/custom.json`
- Test: `tests/cleaner.test.js` (append)

**Interfaces:**
- Consumes: `cleanUrl`
- Produces: `mergeRules(base, custom) → providers` — both inputs shaped `{ providers: { ... } }` (either may be null/empty); custom's providers override base's on the same key. `extension/rules/custom.json` exists with shape `{ "providers": {} }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cleaner.test.js` (extend the import line at the top of the file to `import { cleanUrl, mergeRules } from '../extension/lib/cleaner.js';`):

```js
describe('mergeRules', () => {
  it('custom provider wins over base on the same key', () => {
    const base = { providers: { shop: { urlPattern: '.*', rules: ['a'] } } };
    const custom = { providers: { shop: { urlPattern: '.*', rules: ['b'] } } };
    const merged = mergeRules(base, custom);
    expect(cleanUrl('https://x.se/?a=1&b=2', merged).cleaned).toBe('https://x.se/?a=1');
  });

  it('tolerates null/missing inputs', () => {
    expect(mergeRules(null, null)).toEqual({});
    expect(mergeRules({ providers: { p: { urlPattern: '.*' } } }, undefined)).toHaveProperty('p');
  });
});

describe('never-throw hardening', () => {
  it('returns malformed URLs unchanged', () => {
    expect(cleanUrl('http://[not-a-url', {})).toEqual({ cleaned: 'http://[not-a-url', removed: [] });
    expect(cleanUrl('', {})).toEqual({ cleaned: '', removed: [] });
  });

  it('survives invalid regexes in every rule position', () => {
    const broken = {
      p: {
        urlPattern: '([',
        rules: ['(('],
        rawRules: ['*bad'],
        exceptions: ['[z'],
        redirections: ['(('],
      },
      ok: { urlPattern: '.*', rules: ['utm_source'] },
    };
    const { cleaned } = cleanUrl('https://a.se/?utm_source=x&k=1', broken, { unwrap: true });
    expect(cleaned).toBe('https://a.se/?k=1');
  });
});
```

- [ ] **Step 2: Run tests to verify the mergeRules tests fail**

Run: `npx vitest run`
Expected: FAIL — `mergeRules` is not exported (hardening tests should already pass from the safe* helpers; if any fails, the fix belongs in this task)

- [ ] **Step 3: Implement mergeRules and create custom.json**

Append to `extension/lib/cleaner.js`:

```js
export function mergeRules(base, custom) {
  return { ...(base?.providers ?? {}), ...(custom?.providers ?? {}) };
}
```

Create `extension/rules/custom.json`:

```json
{
  "providers": {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/lib/cleaner.js extension/rules/custom.json tests/cleaner.test.js
git commit -m "feat: mergeRules with custom override, never-throw hardening"
```

---

### Task 6: Rules snapshot script + real-world fixtures

**Files:**
- Create: `scripts/update-rules.mjs`
- Create: `extension/rules/clearurls.json` (generated by the script)
- Modify: `extension/rules/custom.json` (only if the Amazon fixture needs additions)
- Test: `tests/realrules.test.js`

**Interfaces:**
- Consumes: `cleanUrl`, `mergeRules`
- Produces: `extension/rules/clearurls.json` — a snapshot of the official ClearURLs ruleset, shape `{ providers: {...} }`; `npm run update-rules` refreshes it

- [ ] **Step 1: Write the update script**

Create `scripts/update-rules.mjs`:

```js
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
```

- [ ] **Step 2: Run it to generate the snapshot**

Run: `npm run update-rules`
Expected: `Wrote <N> providers ...` with N well above 100. If `rules2.clearurls.xyz` is unreachable, use the mirror `https://gitlab.com/ClearURLs/rules/-/raw/master/data.min.json` as `SOURCE` (same shape) and note the change in the commit message.

- [ ] **Step 3: Write the failing real-world fixture tests**

Create `tests/realrules.test.js`:

```js
import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeAll } from 'vitest';
import { cleanUrl, mergeRules } from '../extension/lib/cleaner.js';

let providers;
beforeAll(async () => {
  const base = JSON.parse(await readFile(new URL('../extension/rules/clearurls.json', import.meta.url), 'utf8'));
  const custom = JSON.parse(await readFile(new URL('../extension/rules/custom.json', import.meta.url), 'utf8'));
  providers = mergeRules(base, custom);
});

describe('real ClearURLs snapshot', () => {
  it("cleans Martin's Amazon example to exactly dp/B083DP4LXH?th=1", () => {
    const input =
      'https://www.amazon.se/Bosch-professionell-tillbeh%C3%B6r-skruvmejsel-borrskruvmejsel/dp/B083DP4LXH?pd_rd_w=InoTU&content-id=amzn1.sym.7832760a-c497-4514-a1e7-73d6cc033ab0%3Aamzn1.symc.30e3dbb4-8dd8-4bad-b7a1-a45bcdbc49b8&pf_rd_p=7832760a-c497-4514-a1e7-73d6cc033ab0&pf_rd_r=ZQHK69DNCXG5NYE08Z9B&pd_rd_wg=FU4eL&pd_rd_r=9b1ea2fa-31b6-43d8-9c84-febc6f5acd52&pd_rd_i=B083DP4LXH&th=1';
    const expected =
      'https://www.amazon.se/Bosch-professionell-tillbeh%C3%B6r-skruvmejsel-borrskruvmejsel/dp/B083DP4LXH?th=1';
    expect(cleanUrl(input, providers).cleaned).toBe(expected);
  });

  it('removes generic trackers on an unknown site', () => {
    const { cleaned } = cleanUrl(
      'https://blog.example.org/post?utm_source=t&utm_campaign=c&fbclid=IwAB12&page=2',
      providers,
    );
    expect(cleaned).toBe('https://blog.example.org/post?page=2');
  });

  it('unwraps a Google result redirect', () => {
    const wrapper =
      'https://www.google.com/url?sa=t&url=' +
      encodeURIComponent('https://en.wikipedia.org/wiki/Bosch') + '&usg=AOvVaw0';
    const { cleaned } = cleanUrl(wrapper, providers, { unwrap: true });
    expect(cleaned).toBe('https://en.wikipedia.org/wiki/Bosch');
  });

  it('leaves a clean URL alone', () => {
    const input = 'https://www.svt.se/nyheter/lokalt/uppsala?page=3';
    expect(cleanUrl(input, providers).cleaned).toBe(input);
  });
});
```

- [ ] **Step 4: Run and reconcile against the real ruleset**

Run: `npx vitest run`

If the Amazon test fails because some params survive (e.g. `content-id` is not in the upstream Amazon provider), that is **the designed use of custom.json** — add the survivors there and re-run until green:

```json
{
  "providers": {
    "martinAmazon": {
      "urlPattern": "^https?://(?:[a-z0-9-]+\\.)*?amazon\\.(?:[a-z.]+)",
      "rules": ["content-id", "pd_rd_.*", "pf_rd_.*"]
    }
  }
}
```

(Only include what actually survives — start with the empty custom.json result and add the minimum.)

If the Google unwrap test fails because the snapshot's redirection regex differs, adjust the test's wrapper URL to a form the snapshot handles (check the `google` provider's `redirections` array in `extension/rules/clearurls.json`) — the semantics under test are Task 4's; this test pins real-data integration.

Expected end state: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add scripts/update-rules.mjs extension/rules/clearurls.json extension/rules/custom.json tests/realrules.test.js
git commit -m "feat: bundle ClearURLs snapshot, real-world fixtures incl. Amazon example"
```

---

### Task 7: Manifest + background service worker (rules loading, clean messaging)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`

**Interfaces:**
- Consumes: `cleanUrl`, `mergeRules`, `extension/rules/*.json`
- Produces: runtime message protocol used by Tasks 8–10: send `{ type: 'clean', url: string, unwrap: boolean }` → response `{ cleaned: string, removed: string[] }`. Storage key `disabledHosts: string[]` in `storage.local` (written by popup, read by content script).

- [ ] **Step 1: Create the manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "URL Cleaner",
  "version": "0.1.0",
  "description": "Removes tracking junk from URLs — clean-copy shortcut and in-place address-bar cleaning.",
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["storage", "scripting", "activeTab", "clipboardWrite", "webNavigation", "tabs"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "popup/popup.html", "default_title": "URL Cleaner" },
  "commands": {
    "copy-clean-url": {
      "suggested_key": { "default": "Alt+Shift+C", "mac": "Alt+Shift+C" },
      "description": "Copy cleaned URL of the current tab"
    }
  }
}
```

(`content.js` and `popup/` do not exist yet — Chrome refuses to load the extension until Task 8/10. For this task's manual check, create an empty `extension/content.js` containing only `// populated in Task 8` and a minimal `extension/popup/popup.html` containing `<!doctype html><html><body>URL Cleaner</body></html>`.)

- [ ] **Step 2: Create the background worker**

Create `extension/background.js`:

```js
import { cleanUrl, mergeRules } from './lib/cleaner.js';

const api = globalThis.browser ?? globalThis.chrome;

let providersPromise = null;
function getProviders() {
  providersPromise ??= (async () => {
    const [base, custom] = await Promise.all([
      fetch(api.runtime.getURL('rules/clearurls.json')).then((r) => r.json()),
      fetch(api.runtime.getURL('rules/custom.json')).then((r) => r.json()),
    ]);
    return mergeRules(base, custom);
  })();
  return providersPromise;
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'clean') {
    getProviders()
      .then((providers) => sendResponse(cleanUrl(msg.url, providers, { unwrap: !!msg.unwrap })))
      .catch(() => sendResponse({ cleaned: msg.url, removed: [] }));
    return true; // async response
  }
  return false;
});

// SPA navigations: the page's own pushState calls are invisible to the
// content script's isolated world, so the recheck signal comes from here.
api.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId !== 0) return;
  api.tabs.sendMessage(tabId, { type: 'recheck' }, () => void api.runtime.lastError);
});
```

- [ ] **Step 3: Manual verification in Chrome**

1. Open `chrome://extensions`, enable Developer mode, **Load unpacked** → select the `extension/` folder. Expected: loads with no errors.
2. Click "service worker" on the extension card to open its console. Run:
   ```js
   chrome.runtime.sendMessage({ type: 'clean', url: 'https://example.com/?utm_source=x&a=1', unwrap: false }, console.log)
   ```
   Expected: `{ cleaned: 'https://example.com/?a=1', removed: ['utm_source'] }`

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/background.js extension/content.js extension/popup/popup.html
git commit -m "feat: MV3 manifest and background worker with clean-message protocol"
```

---

### Task 8: Content script — auto-clean the address bar

**Files:**
- Modify: `extension/content.js` (replace the Task 7 stub)

**Interfaces:**
- Consumes: `{type:'clean'}` message protocol (Task 7); `disabledHosts` in `storage.local`; `{type:'recheck'}` messages from background
- Produces: nothing consumed by later tasks (leaf component)

- [ ] **Step 1: Implement the content script**

Replace `extension/content.js` with:

```js
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Original bound before anything on the page can matter; also avoids
  // re-triggering our own history writes.
  const originalReplaceState = history.replaceState.bind(history);
  let disabled = null; // null = disabledHosts not loaded yet

  function applyClean() {
    if (disabled !== false) return;
    const href = location.href;
    if (!/^https?:/i.test(href)) return;
    try {
      api.runtime.sendMessage({ type: 'clean', url: href, unwrap: false }, (res) => {
        void api.runtime.lastError;
        // Only act if the URL hasn't changed while we waited.
        if (res && res.cleaned && res.cleaned !== href && location.href === href) {
          try {
            originalReplaceState(history.state, '', res.cleaned);
          } catch {
            // e.g. malformed result — leave the URL alone
          }
        }
      });
    } catch {
      // extension context invalidated (reloaded) — nothing to do
    }
  }

  api.storage.local.get({ disabledHosts: [] }, ({ disabledHosts }) => {
    disabled = (disabledHosts ?? []).includes(location.hostname);
    applyClean();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.disabledHosts) {
      disabled = (changes.disabledHosts.newValue ?? []).includes(location.hostname);
    }
  });

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'recheck') applyClean();
  });

  window.addEventListener('popstate', () => setTimeout(applyClean, 0));
})();
```

- [ ] **Step 2: Manual verification in Chrome**

Reload the extension (`chrome://extensions` → refresh icon), then:

1. Paste this into the address bar: `https://www.amazon.se/dp/B083DP4LXH?pd_rd_w=InoTU&pf_rd_r=ZQHK69DNCXG5NYE08Z9B&th=1`
   Expected: within ~a second of page load, the address bar reads `https://www.amazon.se/dp/B083DP4LXH?th=1` — with **no** page reload.
2. On YouTube, click through a few videos (SPA navigation). Append `&si=abc` junk to a watch URL and navigate: junk disappears from the bar after navigation settles.
3. In the service-worker console: `chrome.storage.local.set({ disabledHosts: ['www.amazon.se'] })`, then reload the Amazon URL from step 1. Expected: URL stays dirty. Reset with `chrome.storage.local.set({ disabledHosts: [] })`.

- [ ] **Step 3: Run the unit suite (guard against accidental engine edits)**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "feat: content script auto-cleans address bar in place"
```

---

### Task 9: Clean-copy command + badge feedback

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `getProviders()`, `cleanUrl` (both already in background.js)
- Produces: command `copy-clean-url` behavior; `flashBadge(text)` helper (used only within background.js)

- [ ] **Step 1: Implement the command handler**

Append to `extension/background.js`:

```js
api.commands.onCommand.addListener(async (command) => {
  if (command !== 'copy-clean-url') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
    flashBadge('!');
    return;
  }
  const providers = await getProviders();
  const { cleaned } = cleanUrl(tab.url, providers, { unwrap: true });
  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => navigator.clipboard.writeText(text),
      args: [cleaned],
    });
    flashBadge('✓');
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer) — cannot inject.
    flashBadge('!');
  }
});

function flashBadge(text) {
  api.action.setBadgeText({ text });
  api.action.setBadgeBackgroundColor({ color: text === '✓' ? '#2e7d32' : '#c62828' });
  setTimeout(() => api.action.setBadgeText({ text: '' }), 1500);
}
```

- [ ] **Step 2: Manual verification in Chrome**

Reload the extension, then:

1. On the dirty Amazon URL (with auto-clean temporarily disabled via `disabledHosts`, so the bar stays dirty): press `Alt+Shift+C`. Expected: badge flashes green `✓`; paste into Notepad gives `https://www.amazon.se/dp/B083DP4LXH?th=1`. Re-enable auto-clean afterwards.
2. On any page whose URL contains `utm_` junk: press `Alt+Shift+C`, paste — junk is gone (unwrap-path regression is already covered by the unit fixtures).
3. On `chrome://extensions`: press `Alt+Shift+C`. Expected: red `!` badge, clipboard untouched.
4. If the shortcut does nothing at all, check `chrome://extensions/shortcuts` — assign `Alt+Shift+C` manually (suggested keys can silently fail if taken).

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: copy-clean-url command with badge feedback"
```

---

### Task 10: Popup — before/after view, copy button, per-site toggle

**Files:**
- Modify: `extension/popup/popup.html` (replace the Task 7 stub)
- Create: `extension/popup/popup.js`, `extension/popup/popup.css`

**Interfaces:**
- Consumes: `{type:'clean'}` protocol; `disabledHosts` in `storage.local`
- Produces: nothing consumed by later tasks (leaf component)

- [ ] **Step 1: Implement the popup**

Replace `extension/popup/popup.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>URL Cleaner</h1>
  <div class="label">Current</div>
  <div id="original" class="url"></div>
  <div class="label">Clean</div>
  <div id="cleaned" class="url clean"></div>
  <ul id="removed"></ul>
  <button id="copy">Copy clean URL</button>
  <label class="toggle">
    <input type="checkbox" id="autoclean"> Auto-clean on this site
  </label>
  <script src="popup.js"></script>
</body>
</html>
```

Create `extension/popup/popup.css`:

```css
body {
  width: 360px;
  margin: 0;
  padding: 12px;
  font: 13px/1.4 system-ui, sans-serif;
  color: #222;
  background: #fff;
}
h1 { font-size: 14px; margin: 0 0 8px; }
.label { font-size: 11px; text-transform: uppercase; color: #888; margin-top: 8px; }
.url {
  word-break: break-all;
  background: #f4f4f4;
  border-radius: 4px;
  padding: 6px;
  max-height: 72px;
  overflow-y: auto;
}
.url.clean { background: #e8f4e8; }
#removed { margin: 6px 0; padding-left: 18px; color: #a33; font-size: 12px; }
#removed:empty { display: none; }
button {
  width: 100%;
  margin-top: 10px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: #2e7d32;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
button:disabled { background: #bbb; cursor: default; }
.toggle { display: block; margin-top: 10px; }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #ddd; }
  .url { background: #2a2a2a; }
  .url.clean { background: #1e3320; }
}
```

Create `extension/popup/popup.js`:

```js
const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  $('original').textContent = url || '(no tab URL)';

  if (!/^https?:/i.test(url)) {
    $('cleaned').textContent = '(not a web page)';
    $('copy').disabled = true;
    $('autoclean').disabled = true;
    return;
  }
  const host = new URL(url).hostname;

  const res = await new Promise((resolve) =>
    api.runtime.sendMessage({ type: 'clean', url, unwrap: true }, resolve),
  );
  const cleaned = res?.cleaned ?? url;
  $('cleaned').textContent = cleaned;
  for (const name of res?.removed ?? []) {
    const li = document.createElement('li');
    li.textContent = name;
    $('removed').appendChild(li);
  }

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(cleaned);
    $('copy').textContent = 'Copied ✓';
    setTimeout(() => ($('copy').textContent = 'Copy clean URL'), 1200);
  });

  let hosts = await new Promise((resolve) =>
    api.storage.local.get({ disabledHosts: [] }, (r) => resolve(r.disabledHosts ?? [])),
  );
  $('autoclean').checked = !hosts.includes(host);
  $('autoclean').addEventListener('change', () => {
    hosts = hosts.filter((h) => h !== host);
    if (!$('autoclean').checked) hosts.push(host);
    api.storage.local.set({ disabledHosts: hosts });
  });
}

init();
```

- [ ] **Step 2: Manual verification in Chrome**

Reload the extension, then on a page with `utm_` junk appended to the URL (add `?utm_source=test` to any site with auto-clean toggled off, or use a redirect-wrapper URL):

1. Click the toolbar icon. Expected: popup shows dirty URL under Current, clean URL under Clean (green), removed params listed in red.
2. Click **Copy clean URL** → button says "Copied ✓", paste verifies.
3. Untick **Auto-clean on this site** → reload a dirty URL on that site → bar stays dirty. Re-tick → reload → bar cleans.
4. On `chrome://extensions` the popup shows "(not a web page)" with controls disabled.

- [ ] **Step 3: Commit**

```bash
git add extension/popup/
git commit -m "feat: popup with before/after view, copy, per-site toggle"
```

---

### Task 11: README with Safari build steps + smoke checklist

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything (documentation)
- Produces: the repeatable Safari install procedure and the manual smoke checklist

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
# URL Cleaner

Personal Chrome + Safari extension that strips tracking junk from URLs.

- **Alt+Shift+C** (remappable) — copy a cleaned version of the current tab's
  URL to the clipboard (with redirect unwrapping, e.g. google.com/url?q=…).
- **Auto-clean** — the address bar is rewritten in place (no reload) whenever
  the URL contains known tracking params. Toggle per site in the popup.
- Rules: bundled snapshot of the [ClearURLs](https://clearurls.xyz) ruleset
  plus local overrides in `extension/rules/custom.json` (same format,
  wins on conflict).

Example: `amazon.se/...dp/B083DP4LXH?pd_rd_w=…&pf_rd_r=…&th=1`
→ `amazon.se/...dp/B083DP4LXH?th=1`

## Install — Chrome

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
2. If Alt+Shift+C does nothing: `chrome://extensions/shortcuts` → assign it.

## Install — Safari (Mac, personal use)

1. `xcrun safari-web-extension-converter extension/ --project-location safari-build/ --app-name "URL Cleaner"`
2. Open the generated project in Xcode → Run once (builds + registers the wrapper app).
3. Safari → Settings → Advanced → “Show features for web developers”, then
   Develop → **Allow Unsigned Extensions** (re-required after each Safari restart).
4. Safari → Settings → Extensions → enable URL Cleaner, grant access to all websites.

`safari-build/` is gitignored — regenerate any time from `extension/`.

## Updating the rules

```
npm run update-rules   # fetches latest ClearURLs data → extension/rules/clearurls.json
npx vitest run         # verify fixtures still pass
```

Add newly discovered junk params to `extension/rules/custom.json`.

## Tests

`npx vitest run` — unit tests for the cleaning engine + real-ruleset fixtures.

## Manual smoke checklist (after changes)

- [ ] Dirty Amazon URL auto-cleans in the address bar without reload
- [ ] YouTube SPA navigation re-cleans (webNavigation recheck)
- [ ] Alt+Shift+C copies clean URL, badge flashes ✓
- [ ] Shortcut on chrome:// page flashes ! and leaves clipboard alone
- [ ] Popup shows before/after + removed params; Copy works
- [ ] Per-site toggle disables/re-enables auto-clean
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `npx vitest run`
Expected: PASS — everything green

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with Safari build steps and smoke checklist"
```
