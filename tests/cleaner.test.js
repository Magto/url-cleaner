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
