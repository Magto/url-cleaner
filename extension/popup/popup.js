const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  $('original').textContent = url || '(no tab URL)';

  if (!/^https?:/i.test(url)) {
    $('cleaned').textContent = '(not a web page)';
    $('copy').disabled = true;
    $('autoclean').disabled = true;
    return;
  }
  const host = new URL(url).hostname;

  const res = await new Promise((resolve) =>
    api.runtime.sendMessage({ type: 'clean', url, unwrap: true }, resolve),
  );
  const cleaned = res?.cleaned ?? url;
  $('cleaned').textContent = cleaned;
  for (const name of res?.removed ?? []) {
    const li = document.createElement('li');
    li.textContent = name;
    $('removed').appendChild(li);
  }

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(cleaned);
    $('copy').textContent = 'Copied ✓';
    setTimeout(() => ($('copy').textContent = 'Copy clean URL'), 1200);
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
