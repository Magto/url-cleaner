# URL Cleaner

Personal Chrome + Safari extension that strips tracking junk from URLs.

- **Alt+Shift+C** (remappable) — copy a cleaned version of the current tab's
  URL to the clipboard (with redirect unwrapping, e.g. google.com/url?q=…).
- **Auto-clean** — the address bar is rewritten in place (no reload) whenever
  the URL contains known tracking params. Toggle per site in the popup.
- Rules: bundled snapshot of the [ClearURLs](https://clearurls.xyz) ruleset
  plus local overrides in `extension/rules/custom.json` (same format,
  wins on conflict).
- **Keep referral codes** — global popup toggle; when on, affiliate params
  (e.g. Amazon `tag=`) survive cleaning so shared links still credit their
  owner. Default off.

Example: `amazon.se/...dp/B083DP4LXH?pd_rd_w=…&pf_rd_r=…&th=1`
→ `amazon.se/...dp/B083DP4LXH`

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
