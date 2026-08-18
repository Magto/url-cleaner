(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  // Safari's browser.* APIs are promise-only (callbacks are silently
  // ignored), Chrome's accept both. Promise-first works everywhere.
  function storageGet(defaults) {
    try {
      const p = api.storage.local.get(defaults);
      if (p?.then) return p;
    } catch { /* callback-only API */ }
    return new Promise((resolve) => api.storage.local.get(defaults, resolve));
  }

  function sendMessage(msg) {
    try {
      const p = api.runtime.sendMessage(msg);
      if (p?.then) return p.catch(() => undefined);
    } catch { /* callback-only API */ }
    return new Promise((resolve) =>
      api.runtime.sendMessage(msg, (res) => {
        void api.runtime.lastError;
        resolve(res);
      }),
    );
  }
  // Original bound before anything on the page can matter; also avoids
  // re-triggering our own history writes.
  const originalReplaceState = history.replaceState.bind(history);
  let disabled = null; // null = disabledHosts not loaded yet
  // The page's true pre-clean URL — survives our own replaceState so the
  // popup/shortcut can re-clean with different settings (e.g. keep referral).
  let originalUrl = location.href;
  let lastCleaned = null;

  function applyClean() {
    const href = location.href;
    if (href !== lastCleaned) originalUrl = href;
    if (disabled !== false) return;
    if (!/^https?:/i.test(originalUrl)) return;
    try {
      // Clean from the original so setting changes (e.g. keep referral)
      // can restore params that an earlier pass removed.
      sendMessage({ type: 'clean', url: originalUrl, unwrap: false }).then((res) => {
        // Only act if the URL hasn't changed while we waited.
        if (res && res.cleaned && res.cleaned !== location.href && location.href === href) {
          try {
            lastCleaned = res.cleaned;
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

  storageGet({ disabledHosts: [] }).then(({ disabledHosts }) => {
    disabled = (disabledHosts ?? []).includes(location.hostname);
    applyClean();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.disabledHosts) {
      disabled = (changes.disabledHosts.newValue ?? []).includes(location.hostname);
    }
    if (area === 'local' && changes.keepReferral) applyClean();
  });

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'recheck') applyClean();
    if (msg?.type === 'getOriginal') {
      const href = location.href;
      if (href !== lastCleaned) originalUrl = href;
      sendResponse({ originalUrl });
    }
  });

  window.addEventListener('popstate', () => setTimeout(applyClean, 0));
})();
