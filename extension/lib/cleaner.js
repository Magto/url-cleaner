// Pure URL-cleaning engine implementing ClearURLs rule semantics.
// No browser APIs — unit-testable in Node.

const MAX_UNWRAP_DEPTH = 5;

export function cleanUrl(urlString, providers, opts = {}) {
  try {
    return cleanRecursive(urlString, providers, {
      unwrap: opts.unwrap === true,
      keepReferral: opts.keepReferral === true,
    }, 0);
  } catch {
    return { cleaned: urlString, removed: [] };
  }
}

function cleanRecursive(urlString, providers, opts, depth) {
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

    if (opts.unwrap && depth < MAX_UNWRAP_DEPTH) {
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
          const inner = cleanRecursive(target, providers, opts, depth + 1);
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

    const paramRules = [
      ...(provider.rules ?? []),
      ...(opts.keepReferral ? [] : provider.referralMarketing ?? []),
    ];
    if (paramRules.length) current = stripQueryParams(current, paramRules, removed);

    for (const [param, keepKeys] of Object.entries(provider.jsonParamKeep ?? {})) {
      current = filterJsonParam(current, param, keepKeys, removed);
    }
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

// For params whose value is URL-encoded JSON (e.g. AliExpress pdp_ext_f,
// which mixes the functional variant selection with recommendation
// telemetry): keep only the whitelisted keys; drop the param entirely when
// none remain. Non-JSON values pass through untouched.
function filterJsonParam(urlString, param, keepKeys, removed) {
  const qIndex = urlString.indexOf('?');
  if (qIndex === -1) return urlString;
  const hashIndex = urlString.indexOf('#', qIndex);
  const query = hashIndex === -1 ? urlString.slice(qIndex + 1) : urlString.slice(qIndex + 1, hashIndex);
  const hash = hashIndex === -1 ? '' : urlString.slice(hashIndex);

  const kept = [];
  let changed = false;
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const name = decodeSafe(eq === -1 ? pair : pair.slice(0, eq));
    if (name !== param || eq === -1) {
      kept.push(pair);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(decodeSafe(pair.slice(eq + 1)));
    } catch {
      kept.push(pair);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      kept.push(pair);
      continue;
    }
    const filtered = {};
    for (const key of Object.keys(parsed)) {
      if (keepKeys.includes(key)) filtered[key] = parsed[key];
    }
    if (Object.keys(filtered).length === Object.keys(parsed).length) {
      kept.push(pair);
      continue;
    }
    changed = true;
    if (Object.keys(filtered).length === 0) {
      removed.push(param);
    } else {
      removed.push(`${param}: kept only ${Object.keys(filtered).join(', ')}`);
      kept.push(`${param}=${encodeURIComponent(JSON.stringify(filtered))}`);
    }
  }
  if (!changed) return urlString;
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

export function mergeRules(base, custom) {
  return { ...(base?.providers ?? {}), ...(custom?.providers ?? {}) };
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
