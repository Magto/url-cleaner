// Pure URL-cleaning engine implementing ClearURLs rule semantics.
// No browser APIs — unit-testable in Node.

const MAX_UNWRAP_DEPTH = 5;

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

    if (unwrap && depth < MAX_UNWRAP_DEPTH) {
      for (const redirection of provider.redirections ?? []) {
        let match = null;
        try {
          match = current.match(new RegExp(redirection, 'i'));
        } catch {
          continue;
        }
        if (match && match[1]) {
          const target = decodeSafe(match[1]);
          if (!/^https?:\/\//i.test(target)) continue;
          const inner = cleanRecursive(target, providers, true, depth + 1);
          return {
            cleaned: inner.cleaned,
            removed: [...removed, 'redirect:unwrapped', ...inner.removed],
          };
        }
      }
    }

    for (const raw of provider.rawRules ?? []) {
      let next = current;
      try {
        next = current.replace(new RegExp(raw, 'gi'), '');
      } catch {
        continue;
      }
      if (next !== current) {
        removed.push(`raw:${raw}`);
        current = next;
      }
    }

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
