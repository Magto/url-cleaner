(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Original bound before anything on the page can matter; also avoids
  // re-triggering our own history writes.
  const originalReplaceState = history.replaceState.bind(history);
  let disabled = null; // null = disabledHosts not loaded yet

  function applyClean() {
    if (disabled !== false) return;
    const href = location.href;
    if (!/^https?:/i.test(href)) return;
    try {
      api.runtime.sendMessage({ type: 'clean', url: href, unwrap: false }, (res) => {
        void api.runtime.lastError;
        // Only act if the URL hasn't changed while we waited.
        if (res && res.cleaned && res.cleaned !== href && location.href === href) {
          try {
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
  });

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'recheck') applyClean();
  });

  window.addEventListener('popstate', () => setTimeout(applyClean, 0));
})();
