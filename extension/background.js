// Classic script: cleaner.js is loaded via manifest background.scripts in
// Safari; Chrome's classic service worker pulls it in with importScripts.
if (typeof importScripts === 'function') importScripts('lib/cleaner.js');
// NOTE: no top-level destructuring into bare names here — in Safari the
// background scripts share one global scope, and `const cleanUrl = …` would
// shadow cleaner.js's global `function cleanUrl` (SyntaxError).
const UC = globalThis.URLCleaner;

const api = globalThis.browser ?? globalThis.chrome;

let providersPromise = null;
function getProviders() {
  providersPromise ??= (async () => {
    const [base, custom] = await Promise.all([
      fetch(api.runtime.getURL('rules/clearurls.json')).then((r) => r.json()),
      fetch(api.runtime.getURL('rules/custom.json')).then((r) => r.json()),
    ]);
    return UC.mergeRules(base, custom);
  })();
  return providersPromise;
}

// Safari's browser.* APIs are promise-only (callbacks are silently ignored),
// Chrome's accept both. Promise-first works everywhere.
function storageGet(defaults) {
  try {
    const p = api.storage.local.get(defaults);
    if (p?.then) return p;
  } catch { /* callback-only API */ }
  return new Promise((resolve) => api.storage.local.get(defaults, resolve));
}

function getKeepReferral() {
  return storageGet({ keepReferral: false }).then((r) => r.keepReferral === true);
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'clean') {
    Promise.all([getProviders(), getKeepReferral()])
      .then(([providers, keepReferral]) =>
        sendResponse(UC.cleanUrl(msg.url, providers, { unwrap: !!msg.unwrap, keepReferral })),
      )
      .catch(() => sendResponse({ cleaned: msg.url, removed: [] }));
    return true; // async response
  }
  return false;
});

// SPA navigations: the page's own pushState calls are invisible to the
// content script's isolated world, so the recheck signal comes from here.
api.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId }) => {
  if (frameId !== 0) return;
  try {
    const p = api.tabs.sendMessage(tabId, { type: 'recheck' });
    if (p?.then) { p.catch(() => undefined); return; }
  } catch { return; }
  api.tabs.sendMessage(tabId, { type: 'recheck' }, () => void api.runtime.lastError);
});

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'copy-clean-url') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
    flashBadge('!');
    return;
  }
  // Prefer the page's true pre-clean URL (auto-clean may already have
  // rewritten the address bar, e.g. stripping a referral tag the user now
  // wants kept). Falls back to the tab URL on restricted pages.
  const original = await new Promise((resolve) => {
    try {
      const p = api.tabs.sendMessage(tab.id, { type: 'getOriginal' });
      if (p?.then) {
        p.then((res) => resolve(res?.originalUrl ?? tab.url))
          .catch(() => resolve(tab.url));
        return;
      }
      api.tabs.sendMessage(tab.id, { type: 'getOriginal' }, (res) => {
        void api.runtime.lastError;
        resolve(res?.originalUrl ?? tab.url);
      });
    } catch {
      resolve(tab.url);
    }
  });
  const [providers, keepReferral] = await Promise.all([getProviders(), getKeepReferral()]);
  const { cleaned } = UC.cleanUrl(original, providers, { unwrap: true, keepReferral });
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
