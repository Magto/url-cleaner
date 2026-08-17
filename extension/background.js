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
