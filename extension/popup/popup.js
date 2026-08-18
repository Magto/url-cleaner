const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

// Safari's browser.* APIs are promise-only (callbacks are silently ignored),
// Chrome's accept both. Promise-first with callback fallback works everywhere.
function storageGet(defaults) {
  try {
    const p = api.storage.local.get(defaults);
    if (p?.then) return p;
  } catch { /* callback-only API */ }
  return new Promise((resolve) => api.storage.local.get(defaults, resolve));
}

function storageSet(items) {
  try {
    const p = api.storage.local.set(items);
    if (p?.then) return p;
  } catch { /* callback-only API */ }
  return new Promise((resolve) => api.storage.local.set(items, resolve));
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
      const p = api.tabs.sendMessage(tab.id, { type: 'getOriginal' });
      if (p?.then) {
        p.then((res) => resolve(res?.originalUrl ?? tab?.url ?? ''))
          .catch(() => resolve(tab?.url ?? ''));
        return;
      }
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
    const res = await sendMessage({ type: 'clean', url, unwrap: true });
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

  const { keepReferral = false } = await storageGet({ keepReferral: false });
  $('keepreferral').checked = keepReferral === true;
  $('keepreferral').addEventListener('change', () => {
    storageSet({ keepReferral: $('keepreferral').checked }).then(refreshCleaned);
  });

  let hosts = (await storageGet({ disabledHosts: [] })).disabledHosts ?? [];
  $('autoclean').checked = !hosts.includes(host);
  $('autoclean').addEventListener('change', () => {
    hosts = hosts.filter((h) => h !== host);
    if (!$('autoclean').checked) hosts.push(host);
    storageSet({ disabledHosts: hosts });
  });
}

init();
