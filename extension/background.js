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
