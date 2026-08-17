import { describe, it, expect } from 'vitest';
import { cleanUrl } from '../extension/lib/cleaner.js';

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
