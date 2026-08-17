// Pure URL-cleaning engine implementing ClearURLs rule semantics.
// No browser APIs — unit-testable in Node.

export function cleanUrl(urlString, providers, opts = {}) {
  try {
    return cleanRecursive(urlString, providers, opts.unwrap === true, 0);
  } catch {
    return { cleaned: urlString, removed: [] };
  }
}

function cleanRecursive(urlString, providers, unwrap, depth) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { cleaned: urlString, removed: [] };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { cleaned: urlString, removed: [] };
  }

  let current = urlString;
  const removed = [];

  for (const provider of Object.values(providers)) {
    if (!provider || !safeTest(provider.urlPattern, current)) continue;
    if ((provider.exceptions ?? []).some((e) => safeTest(e, current))) continue;

    const paramRules = [...(provider.rules ?? []), ...(provider.referralMarketing ?? [])];
    if (paramRules.length) current = stripQueryParams(current, paramRules, removed);
  }

  return { cleaned: current, removed };
}

// Query string is processed as raw &-separated segments so that kept
// params keep their original encoding byte-for-byte.
function stripQueryParams(urlString, paramRules, removed) {
  const qIndex = urlString.indexOf('?');
  if (qIndex === -1) return urlString;
  const hashIndex = urlString.indexOf('#', qIndex);
  const query = hashIndex === -1 ? urlString.slice(qIndex + 1) : urlString.slice(qIndex + 1, hashIndex);
  const hash = hashIndex === -1 ? '' : urlString.slice(hashIndex);
  if (query === '') return urlString;

  const kept = [];
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const name = decodeSafe(pair.split('=')[0]);
    if (paramRules.some((rule) => matchesWholeName(rule, name))) {
      removed.push(name);
    } else {
      kept.push(pair);
    }
  }
  const base = urlString.slice(0, qIndex);
  return kept.length ? `${base}?${kept.join('&')}${hash}` : `${base}${hash}`;
}

function matchesWholeName(pattern, value) {
  try {
    return new RegExp(`^(?:${pattern})$`, 'i').test(value);
  } catch {
    return false;
  }
}

function safeTest(pattern, value) {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
