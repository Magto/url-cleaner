(() => {
  const api = globalThis.browser ?? globalThis.chrome;
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
      api.runtime.sendMessage({ type: 'clean', url: originalUrl, unwrap: false }, (res) => {
        void api.runtime.lastError;
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

  api.storage.local.get({ disabledHosts: [] }, ({ disabledHosts }) => {
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
