import { describe, it, expect } from 'vitest';
import { cleanUrl, mergeRules } from '../extension/lib/cleaner.js';

const GLOBAL_ONLY = {
  globalRules: {
    urlPattern: '.*',
    rules: ['utm_(?:source|medium|campaign|term|content)', 'fbclid', 'gclid'],
  },
};

describe('global query-param removal', () => {
  it('removes utm_* params and reports them', () => {
    const { cleaned, removed } = cleanUrl(
      'https://example.com/page?utm_source=news&utm_medium=email&id=42',
      GLOBAL_ONLY,
    );
    expect(cleaned).toBe('https://example.com/page?id=42');
    expect(removed).toEqual(['utm_source', 'utm_medium']);
  });

  it('drops the ? entirely when all params are junk', () => {
    const { cleaned } = cleanUrl('https://example.com/page?fbclid=abc123', GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/page');
  });

  it('preserves the fragment', () => {
    const { cleaned } = cleanUrl('https://example.com/p?gclid=x&a=1#section', GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/p?a=1#section');
  });

  it('preserves encoding of kept params byte-for-byte', () => {
    const input = 'https://example.com/s?q=r%C3%B6d%20f%C3%A4rg&utm_source=x';
    const { cleaned } = cleanUrl(input, GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/s?q=r%C3%B6d%20f%C3%A4rg');
  });

  it('matches param names case-insensitively and as whole names only', () => {
    const { cleaned } = cleanUrl('https://example.com/?FBCLID=x&notfbclid=keep', GLOBAL_ONLY);
    expect(cleaned).toBe('https://example.com/?notfbclid=keep');
  });

  it('passes an already-clean URL through byte-identical', () => {
    const input = 'https://example.com/path?real=1&also=2#frag';
    expect(cleanUrl(input, GLOBAL_ONLY).cleaned).toBe(input);
  });

  it('leaves non-http(s) URLs untouched', () => {
    const input = 'chrome://extensions/?utm_source=x';
    expect(cleanUrl(input, GLOBAL_ONLY)).toEqual({ cleaned: input, removed: [] });
  });
});

const SITE_PROVIDERS = {
  exampleShop: {
    urlPattern: '^https?://(?:[a-z0-9-]+\\.)*?shop\\.example\\.com',
    rules: ['tracker_.*'],
    exceptions: ['^https?://shop\\.example\\.com/checkout'],
  },
};

describe('provider matching and exceptions', () => {
  it('applies provider rules only on matching hosts', () => {
    const onSite = cleanUrl('https://shop.example.com/item?tracker_id=9&sku=1', SITE_PROVIDERS);
    expect(onSite.cleaned).toBe('https://shop.example.com/item?sku=1');

    const offSite = cleanUrl('https://other.example.org/item?tracker_id=9', SITE_PROVIDERS);
    expect(offSite.cleaned).toBe('https://other.example.org/item?tracker_id=9');
  });

  it('skips the provider entirely when an exception matches', () => {
    const input = 'https://shop.example.com/checkout?tracker_id=9&cart=abc';
    expect(cleanUrl(input, SITE_PROVIDERS).cleaned).toBe(input);
  });
});

const RAW_PROVIDERS = {
  amazonLike: {
    urlPattern: '^https?://(?:[a-z0-9-]+\\.)*?amazon\\.(?:com|se|de)',
    rules: ['pd_rd_.*'],
    referralMarketing: ['tag'],
    rawRules: ['\\/ref\\=[^/?#]*'],
  },
};

describe('rawRules and referralMarketing', () => {
  it('removes raw path junk like Amazon /ref= segments', () => {
    const { cleaned, removed } = cleanUrl(
      'https://www.amazon.se/dp/B083DP4LXH/ref=sr_1_3?keywords=bosch',
      RAW_PROVIDERS,
    );
    expect(cleaned).toBe('https://www.amazon.se/dp/B083DP4LXH?keywords=bosch');
    expect(removed).toContain('raw:\\/ref\\=[^/?#]*');
  });

  it('treats referralMarketing params as junk', () => {
    const { cleaned } = cleanUrl('https://www.amazon.se/dp/B083DP4LXH?tag=affiliate-21', RAW_PROVIDERS);
    expect(cleaned).toBe('https://www.amazon.se/dp/B083DP4LXH');
  });
});

const REDIRECT_PROVIDERS = {
  googleLike: {
    urlPattern: '^https?://(?:[a-z0-9-]+\\.)*?google\\.(?:com|se)',
    redirections: ['^https?://(?:[a-z0-9-]+\\.)*?google\\.(?:com|se)/url\\?.*?(?:url|q)=([^&]+)'],
  },
  globalRules: {
    urlPattern: '.*',
    rules: ['utm_(?:source|medium|campaign|term|content)'],
  },
};

describe('redirect unwrapping', () => {
  const wrapper =
    'https://www.google.se/url?q=' +
    encodeURIComponent('https://example.com/target?utm_source=google&x=1') +
    '&sa=D';

  it('unwraps and cleans the target when unwrap is on', () => {
    const { cleaned } = cleanUrl(wrapper, REDIRECT_PROVIDERS, { unwrap: true });
    expect(cleaned).toBe('https://example.com/target?x=1');
  });

  it('does NOT unwrap when unwrap is off (auto-clean mode)', () => {
    const { cleaned } = cleanUrl(wrapper, REDIRECT_PROVIDERS);
    expect(cleaned.startsWith('https://www.google.se/url?')).toBe(true);
  });

  it('ignores redirection targets that are not http(s)', () => {
    const bad = 'https://www.google.se/url?q=javascript%3Aalert(1)';
    const { cleaned } = cleanUrl(bad, REDIRECT_PROVIDERS, { unwrap: true });
    expect(cleaned.startsWith('https://www.google.se/url?')).toBe(true);
  });

  it('caps recursion on self-referencing wrappers', () => {
    const loop = 'https://www.google.se/url?q=' +
      encodeURIComponent('https://www.google.se/url?q=https%3A%2F%2Fwww.google.se%2Furl');
    // Must terminate and return a string — no stack overflow.
    expect(typeof cleanUrl(loop, REDIRECT_PROVIDERS, { unwrap: true }).cleaned).toBe('string');
  });
});

describe('mergeRules', () => {
  it('custom provider wins over base on the same key', () => {
    const base = { providers: { shop: { urlPattern: '.*', rules: ['a'] } } };
    const custom = { providers: { shop: { urlPattern: '.*', rules: ['b'] } } };
    const merged = mergeRules(base, custom);
    expect(cleanUrl('https://x.se/?a=1&b=2', merged).cleaned).toBe('https://x.se/?a=1');
  });

  it('tolerates null/missing inputs', () => {
    expect(mergeRules(null, null)).toEqual({});
    expect(mergeRules({ providers: { p: { urlPattern: '.*' } } }, undefined)).toHaveProperty('p');
  });
});

describe('never-throw hardening', () => {
  it('returns malformed URLs unchanged', () => {
    expect(cleanUrl('http://[not-a-url', {})).toEqual({ cleaned: 'http://[not-a-url', removed: [] });
    expect(cleanUrl('', {})).toEqual({ cleaned: '', removed: [] });
  });

  it('survives invalid regexes in every rule position', () => {
    const broken = {
      p: {
        urlPattern: '([',
        rules: ['(('],
        rawRules: ['*bad'],
        exceptions: ['[z'],
        redirections: ['(('],
      },
      ok: { urlPattern: '.*', rules: ['utm_source'] },
    };
    const { cleaned } = cleanUrl('https://a.se/?utm_source=x&k=1', broken, { unwrap: true });
    expect(cleaned).toBe('https://a.se/?k=1');
  });
});
