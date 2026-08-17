const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

// Renders the original URL with the removed parameters highlighted.
function renderOriginal(url, removedSet) {
  const el = $('original');
  el.replaceChildren();
  const qIndex = url.indexOf('?');
  if (qIndex === -1 || removedSet.size === 0) {
    el.textContent = url;
    return;
  }
  const hashIndex = url.indexOf('#', qIndex);
  const query = hashIndex === -1 ? url.slice(qIndex + 1) : url.slice(qIndex + 1, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  el.append(url.slice(0, qIndex + 1));
  query.split('&').forEach((pair, i) => {
    let name = pair.split('=')[0];
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    const text = (i ? '&' : '') + pair;
    if (removedSet.has(name)) {
      const span = document.createElement('span');
      span.className = 'junk';
      span.textContent = text;
      el.append(span);
    } else {
      el.append(text);
    }
  });
  if (hash) el.append(hash);
}

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  // Prefer the page's true pre-clean URL from the content script — the
  // address bar may already have been auto-cleaned.
  const url = await new Promise((resolve) => {
    if (!tab?.id) return resolve(tab?.url ?? '');
    try {
      api.tabs.sendMessage(tab.id, { type: 'getOriginal' }, (res) => {
        void api.runtime.lastError;
        resolve(res?.originalUrl ?? tab?.url ?? '');
      });
    } catch {
      resolve(tab?.url ?? '');
    }
  });
  $('original').textContent = url || '(no tab URL)';

  if (!/^https?:/i.test(url)) {
    $('cleaned').textContent = '(not a web page)';
    $('copy').disabled = true;
    $('autoclean').disabled = true;
    $('keepreferral').disabled = true;
    return;
  }
  const host = new URL(url).hostname;

  let cleaned = url;
  async function refreshCleaned() {
    const res = await new Promise((resolve) =>
      api.runtime.sendMessage({ type: 'clean', url, unwrap: true }, resolve),
    );
    cleaned = res?.cleaned ?? url;
    $('cleaned').textContent = cleaned;
    const removed = res?.removed ?? [];
    renderOriginal(url, new Set(removed));
    $('removed').replaceChildren();
    for (const name of removed) {
      const li = document.createElement('li');
      li.textContent = name;
      $('removed').appendChild(li);
    }
  }
  await refreshCleaned();

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(cleaned);
    $('copy').textContent = 'Copied ✓';
    setTimeout(() => ($('copy').textContent = 'Copy clean URL'), 1200);
  });

  const { keepReferral = false } = await new Promise((resolve) =>
    api.storage.local.get({ keepReferral: false }, resolve),
  );
  $('keepreferral').checked = keepReferral === true;
  $('keepreferral').addEventListener('change', () => {
    api.storage.local.set({ keepReferral: $('keepreferral').checked }, refreshCleaned);
  });

  let hosts = await new Promise((resolve) =>
    api.storage.local.get({ disabledHosts: [] }, (r) => resolve(r.disabledHosts ?? [])),
  );
  $('autoclean').checked = !hosts.includes(host);
  $('autoclean').addEventListener('change', () => {
    hosts = hosts.filter((h) => h !== host);
    if (!$('autoclean').checked) hosts.push(host);
    api.storage.local.set({ disabledHosts: hosts });
  });
}

init();
