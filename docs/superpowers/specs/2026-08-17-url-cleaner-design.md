# URL Cleaner — Design Spec

**Date:** 2026-08-17
**Status:** Approved by Martin (chat), pending spec review
**Targets:** Chrome (Windows + Mac) and Safari (Mac), personal use

## Purpose

A browser extension that produces clean, tracking-free URLs. Two modes:

1. **Clean-copy:** a keyboard shortcut / toolbar button copies a cleaned
   version of the current tab's URL to the clipboard.
2. **Auto-clean:** the address bar itself is rewritten in place (no reload)
   whenever the current URL contains known tracking parameters, so a plain
   Ctrl+C from the address bar already yields a clean link.

Canonical example (must hold as a test fixture):

```
https://www.amazon.se/Bosch-professionell-tillbeh%C3%B6r-skruvmejsel-borrskruvmejsel/dp/B083DP4LXH?pd_rd_w=InoTU&content-id=...&pf_rd_p=...&pf_rd_r=...&pd_rd_wg=...&pd_rd_r=...&pd_rd_i=B083DP4LXH&th=1
→ https://www.amazon.se/Bosch-professionell-tillbeh%C3%B6r-skruvmejsel-borrskruvmejsel/dp/B083DP4LXH?th=1
```

Both forms were accepted by Martin. The upstream ClearURLs Amazon provider
lists `th` as junk, so the actual result is the fully bare second form.

## Decisions made

| Decision | Choice |
|---|---|
| Trigger model | Both shortcut clean-copy AND automatic address-bar rewrite |
| Cleaning philosophy | **Blocklist** — remove known-junk params only; unknown params are kept (never breaks a page) |
| Rule source | Bundled snapshot of the open-source **ClearURLs** ruleset + `custom.json` overrides |
| Auto-clean default | **On everywhere**, per-site off switch in popup |
| Safari distribution | Personal use on Mac: `safari-web-extension-converter` + unsigned/dev-mode install. No App Store, no paid account |
| Architecture | Single Manifest V3 WebExtension codebase shared verbatim by Chrome and Safari (Approach A) |
| Network-level cleaning (declarativeNetRequest) | **Rejected** — params are cleaned after page load, not before request. Acceptable: goal is clean *copied* links, not request privacy |

## Repository layout

`C:\Users\marti\claude-project\url-cleaner`:

```
url-cleaner/
├── extension/              # the WebExtension — loaded unpacked in Chrome,
│   ├── manifest.json       #   and fed to Safari's converter as-is
│   ├── background.js       # service worker: shortcut command, badge feedback
│   ├── content.js          # auto-clean of the address bar
│   ├── popup/              # toolbar popup (html/js/css)
│   ├── lib/cleaner.js      # pure URL-cleaning engine
│   └── rules/
│       ├── clearurls.json  # bundled snapshot of the ClearURLs ruleset
│       └── custom.json     # Martin's own additions, same format, wins on conflict
├── scripts/update-rules.mjs  # fetches latest ClearURLs rules → snapshot
├── tests/cleaner.test.js     # vitest unit tests
└── README.md                 # incl. Safari-on-Mac build steps
```

The Safari Xcode project is **generated** on the Mac from `extension/` and is
not checked in; the WebExtension source is the single source of truth.

## Components

### 1. Cleaning engine — `extension/lib/cleaner.js`

Pure ES module, no browser APIs. Entry point:

```js
cleanUrl(urlString, rules) → { cleaned: string, removed: string[] }
```

Implements the ClearURLs rule semantics:

- **Providers:** per-site `urlPattern` match (Amazon, Google, YouTube, …);
  a `globalRules` provider applies everywhere (`utm_*`, `fbclid`, `gclid`, …).
- **rules[]:** regex-based query-parameter removal.
- **rawRules[]:** raw path junk removal (e.g. Amazon `/ref=` path segments).
- **exceptions[]:** provider-level URL exceptions — skip cleaning on match.
- **redirections[]:** redirect unwrapping — e.g. Google `/url?q=…` and
  Outlook SafeLinks resolve to the wrapped destination URL (recursively,
  with a depth cap).
- **referralMarketing:** treated as junk (removed) — personal tool, no
  affiliate courtesy needed.
- `custom.json` uses the same provider format and is merged on top of the
  snapshot; on conflict, custom wins.

**Error handling:** the engine never throws. Unparseable input, a bad regex,
or any internal error returns the original URL with `removed: []`. Query
encoding of untouched params is preserved as-is where possible.

### 2. Auto-clean — `extension/content.js`

- Runs on all `http(s)` pages at `document_idle`.
- If `cleanUrl(location.href)` differs from the current URL, calls
  `history.replaceState(null, '', cleaned)` — address bar updates in place,
  **no reload, no redirect**.
- Hooks `history.pushState` / `history.replaceState` and listens to
  `popstate` so SPA navigations (YouTube, Amazon in-page nav) are re-cleaned.
- Only acts when cleaned ≠ current → inherently loop-free.
- Checks the per-site disable list before acting; list is cached and kept
  fresh via `storage.onChanged`.
- **Redirect unwrapping is NOT applied in auto-clean** (replacing the URL of
  a Google redirect page with its destination without navigating would lie
  about the page you're on). Unwrapping applies to clean-copy only.

### 3. Clean-copy — `extension/background.js` + popup

- Command `copy-clean-url`, suggested binding **Alt+Shift+C** (both
  platforms; Ctrl/Cmd+Shift+C is reserved by DevTools inspect-element),
  via the `commands` API. Remappable at `chrome://extensions/shortcuts`.
- Handler: read active tab URL → clean (with redirect unwrapping) → write to
  clipboard by injecting a small `scripting.executeScript` snippet into the
  active tab that calls `navigator.clipboard.writeText` (works in both
  Chrome MV3 and Safari without an offscreen document).
- Feedback: toolbar badge shows `✓` for ~1.5 s after a successful copy
  (count of removed params as badge title/tooltip).
- On restricted pages where injection fails (chrome://, Web Store, PDF
  viewer): badge shows `!` — no clipboard write.

### 4. Popup — `extension/popup/`

- Shows current tab URL **before/after** with removed parameters listed.
- **Copy clean URL** button (same path as the shortcut).
- Toggle **"Auto-clean on this site"** — writes hostname to
  `disabledHosts` in `storage.local`.

### 5. Storage

`storage.local`:
- `disabledHosts: string[]` — hostnames where auto-clean is off.

No other persistent state. No sync (personal, per-machine is fine).

### 6. Manifest / permissions

Manifest V3. Permissions: `storage`, `scripting`, `activeTab`, `tabs`,
`clipboardWrite`, `webNavigation` (SPA navigations are invisible to the
content script's isolated world, so the background signals re-cleans via
`webNavigation.onHistoryStateUpdated`); host permissions `http://*/*`,
`https://*/*` for the content script. Background declared as `service_worker` (supported by
Chrome and Safari 16.4+). **No analytics, no runtime network calls** — rules
are bundled.

## Rules updates

`node scripts/update-rules.mjs`:
1. Fetch the current ClearURLs `data.min.json` from the official source.
2. Validate it parses and contains a plausible provider count.
3. Rewrite `extension/rules/clearurls.json`.

Run manually, whenever. No auto-update machinery in v1 (YAGNI).

## Safari build (documented in README)

On the Mac:
1. `xcrun safari-web-extension-converter extension/ --project-location safari-build/`
2. Open generated project in Xcode, Run once.
3. Safari → Develop → *Allow unsigned extensions*; enable in
   Settings → Extensions.

Repeat after Safari major updates / reboots as needed (unsigned extensions
are disabled on Safari restart — known personal-use friction).

## Testing

- **Unit (vitest):** fixture table against `cleanUrl`:
  - the Amazon example verbatim (→ `…/dp/B083DP4LXH?th=1`),
  - `utm_*` / `fbclid` / `gclid` generic cases,
  - a Google `/url?q=` redirect wrapper (unwraps),
  - an already-clean URL (byte-identical pass-through),
  - a malformed URL (returned unchanged, no throw),
  - a `custom.json` override case,
  - an exception-rule case (provider exception → untouched).
- **Manual smoke checklist (Chrome, Load unpacked):** shortcut copy + badge,
  popup before/after + copy, auto-clean visibly rewrites an Amazon URL,
  per-site toggle stops it, SPA navigation re-clean on YouTube.
- **Safari:** one-time verification pass of the same checklist on the Mac.

## Out of scope (v1)

- App Store / Chrome Web Store distribution
- iOS Safari
- declarativeNetRequest before-request cleaning
- Rules auto-update
- Options page beyond the popup toggle
- Context-menu items, link-hover cleaning, in-page link rewriting
