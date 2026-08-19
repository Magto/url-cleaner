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

> Copy clean links. Removes known tracking parameters from URLs — in the address bar and on copy.

**Category:** Privacy & Security (fallback: Productivity → Tools)

**Description:**

<!-- Rewritten 2026-08-19 after CWS rejection (spam policy, ref "Yellow Nickel",
     automated review). The original version contained a raw tracking-URL
     example, literal parameter names (utm_*, fbclid, gclid, pd_rd_*), a brand
     list and ✂/✔ symbols — all plausible keyword-spam classifier bait per
     https://developer.chrome.com/docs/webstore/troubleshooting/#spam.
     Keep this version in plain prose: no example URLs, no parameter names,
     no brand enumerations, no decorative symbols. -->

> Ever copied a link and gotten three lines of tracking garbage? URL Cleaner
> strips known tracking parameters from the URLs you copy and share, so your
> links stay short, clean and private.
>
> HOW IT WORKS
>
> Auto-clean: the address bar is rewritten in place (no page reload) whenever
> the URL contains known tracking parameters, so a plain Ctrl+C already gives
> you a clean link. You can toggle this per site from the popup.
>
> Clean-copy: press Alt+Shift+C (remappable) or use the popup button to copy
> a cleaned version of the current URL. Redirect wrappers are unwrapped to
> their real destination.
>
> Transparent: the popup shows exactly which parameters were removed —
> nothing is hidden from you.
>
> WHAT GETS REMOVED
>
> Cleaning is based on the open-source ClearURLs ruleset, covering more than
> 200 site-specific providers as well as the most common global tracking
> parameters. Only known tracking parameters are removed — unknown parameters
> are always kept, so links never break.
>
> AFFILIATE LINKS, FAIR BY DESIGN
>
> URL Cleaner never interferes with the links you click. It does no request
> blocking or redirecting: pages load exactly as intended and affiliate
> credit registers as normal. Cleaning only affects the URL you copy and
> share afterwards. If you want the links you share to keep crediting their
> owner, enable "Keep referral codes" in the popup and referral parameters
> survive cleaning too.
>
> PRIVACY
>
> Everything runs locally in your browser. No data collection, no analytics,
> no network requests — the cleaning rules are bundled with the extension.
> The extension is fully open source; the source code is available via the
> homepage link on this page.

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
3. [x] New item → upload zip (0.5.0)
4. [x] Paste listing texts + upload screenshot(s)
5. [x] Fill Privacy tab (texts above), set data-collection to none
6. [x] Distribution: Public, all regions
7. [x] Submit for review — submitted 2026-08-18, status "Väntar på granskning"
       (expect days–2 weeks due to all-sites host permission).
       Gotcha: the submit flow has TWO dialogs — the auto-publish confirm,
       then a "Publiceringen fördröjs" host-permission warning that needs a
       second "Skicka för granskning" click. Miss it and nothing happens.
       Item id: hfhhgaeacednhhdehoebekieekanigba
