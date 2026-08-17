# URL Cleaner — Privacy Policy

*Last updated: 2026-08-17*

URL Cleaner does not collect, store, transmit, or sell any user data. Period.

## What the extension does

URL Cleaner removes known tracking parameters (such as `utm_source`,
`fbclid`, `gclid`, and site-specific junk) from URLs, either when you copy
the current page's URL via the keyboard shortcut/popup, or by rewriting the
address bar in place.

## Data handling

- **All processing happens locally** in your browser. URLs are never sent
  anywhere.
- **No network requests.** The tracking-parameter rules are bundled with the
  extension. It makes zero runtime connections to any server.
- **No analytics, no telemetry, no error reporting.**
- **The only stored data** is your own per-site "auto-clean off" list, kept
  in the browser's local extension storage on your device. It never leaves
  your browser.
- **Clipboard access** is write-only and only happens when you explicitly
  trigger a copy (shortcut or button).

## Permissions explained

| Permission | Why |
|---|---|
| Access to all websites | Tracking parameters appear on any site; the content script must be able to clean the address bar everywhere. It reads only the page URL, never page content. |
| `webNavigation` | Detects in-page navigations on single-page apps (e.g. YouTube) so the address bar can be re-cleaned. URLs are processed locally and discarded. |
| `activeTab` | Reads the current tab's URL at the moment you press the shortcut or open the popup. |
| `scripting` | Writes the cleaned URL to your clipboard in the active tab. |
| `clipboardWrite` | Copying the cleaned URL is the extension's core feature. |
| `storage` | Saves your per-site auto-clean preferences locally. |

## Contact

Questions: open an issue at
[github.com/Magto/url-cleaner](https://github.com/Magto/url-cleaner/issues).
