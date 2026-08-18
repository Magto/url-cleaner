# Chrome Web Store — submission sheet

Everything to copy-paste into the [Developer Console](https://chrome.google.com/webstore/devconsole).
Package zip: `dist/url-cleaner-<version>.zip`.

Rebuild (Mac) — strips the Safari-only `background.scripts` manifest key
from the packaged copy so the store reviewer never sees an MV2-only key:

```bash
python3 - <<'EOF'
import json, zipfile
from pathlib import Path
src = Path('extension')
m = json.loads(src.joinpath('manifest.json').read_text(encoding='utf-8-sig'))
m['background'].pop('scripts', None)
out = Path(f"dist/url-cleaner-{m['version']}.zip")
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(src.rglob('*')):
        if p.is_dir() or p.name == '.DS_Store': continue
        rel = p.relative_to(src)
        z.writestr('manifest.json', json.dumps(m, indent=2, ensure_ascii=False)) if str(rel)=='manifest.json' else z.write(p, rel)
print(out)
EOF
```

(Windows fallback: `Compress-Archive -Path extension\* -DestinationPath dist\url-cleaner-<version>.zip -Force` — but that keeps the scripts key.)

## Store listing

**Name:** URL Cleaner

**Summary (max 132 chars):**

> Copy clean links. Removes tracking junk (utm, fbclid, gclid, Amazon pd_rd_* …) from URLs — in the address bar and on copy.

**Category:** Privacy & Security (fallback: Productivity → Tools)

**Description:**

> Ever copied a link and gotten three lines of tracking garbage?
>
> URL Cleaner strips known tracking parameters from URLs so the links you
> share are short and clean:
>
> ✂ amazon.se/…/dp/B083DP4LXH?pd_rd_w=InoTU&content-id=amzn1.sym.7832…&pf_rd_p=7832…&pf_rd_r=ZQHK6…&pd_rd_wg=FU4eL
> ✔ amazon.se/…/dp/B083DP4LXH
>
> HOW IT WORKS
> • Auto-clean: the address bar is rewritten in place (no reload) whenever
>   the URL contains known tracking parameters — a plain Ctrl+C already
>   gives you a clean link. Toggle it per site from the popup.
> • Clean-copy: press Alt+Shift+C (remappable) or use the popup button to
>   copy a cleaned URL. Redirect wrappers like google.com/url?q=… are
>   unwrapped to their real destination.
> • The popup shows exactly which parameters were removed — nothing is
>   hidden from you.
>
> WHAT GETS REMOVED
> Based on the open-source ClearURLs ruleset: 200+ site-specific providers
> (Amazon, Google, YouTube, AliExpress …) plus global trackers like utm_*,
> fbclid, gclid. Only known junk is removed — unknown parameters are always
> kept, so links never break.
>
> PRIVACY
> Everything runs locally. No data collection, no analytics, no network
> requests — the rules are bundled. Open source:
> https://github.com/Magto/url-cleaner

**Privacy policy URL:** https://github.com/Magto/url-cleaner/blob/master/PRIVACY.md

**Homepage URL:** https://github.com/Magto/url-cleaner

**Screenshot:** `docs/store/screenshot-1.png` (1280×800). Add a real popup
screenshot as a second image if you like.

## Privacy tab

**Single purpose description:**

> Removes known tracking parameters from URLs, so users can copy and share
> clean links.

**Permission justifications:**

- **Host permission (all sites):** Tracking parameters appear on any
  website, so the content script must be able to run everywhere to clean
  the address bar in place. It reads only the page URL, never page content,
  and processes it locally.
- **webNavigation:** Needed to detect in-page (history.pushState)
  navigations on single-page apps such as YouTube, so the address bar can
  be re-cleaned after SPA navigation. URLs are processed locally and
  discarded.
- **activeTab:** Reads the current tab's URL at the moment the user invokes
  the extension (keyboard shortcut or popup) to produce the cleaned copy.
- **scripting:** Injects a one-line snippet into the active tab to write
  the cleaned URL to the clipboard when the user triggers a copy.
- **clipboardWrite:** Copying the cleaned URL to the clipboard is the
  extension's core user-facing feature.
- **storage:** Stores the user's own per-site "auto-clean off" list locally.

**Remote code:** No, all code is packaged. No analytics or external requests.

**Data usage:** check **"Does not collect or use user data"** — nothing is
collected.

## Submission checklist

1. [x] Pay the one-time $5 developer registration fee, verify email + 2FA (2026-08-18)
2. [x] Rebuild zip from current `extension/` (dist/url-cleaner-0.5.0.zip)
3. [ ] New item → upload zip
4. [ ] Paste listing texts + upload screenshot(s)
5. [ ] Fill Privacy tab (texts above), set data-collection to none
6. [ ] Distribution: Public, all regions
7. [ ] Submit for review (expect days–2 weeks first time due to all-sites
       host permission)
