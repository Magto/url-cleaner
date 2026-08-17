import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeAll } from 'vitest';
import { cleanUrl, mergeRules } from '../extension/lib/cleaner.js';

let providers;
beforeAll(async () => {
  const base = JSON.parse(await readFile(new URL('../extension/rules/clearurls.json', import.meta.url), 'utf8'));
  const custom = JSON.parse(await readFile(new URL('../extension/rules/custom.json', import.meta.url), 'utf8'));
  providers = mergeRules(base, custom);
});

describe('real ClearURLs snapshot', () => {
  // Upstream ClearURLs lists `th` as junk for Amazon, so the result is the
  // fully bare form — Martin accepted both ?th=1 and bare in the spec.
  it("cleans Martin's Amazon example to exactly dp/B083DP4LXH", () => {
    const input =
      'https://www.amazon.se/Bosch-professionell-tillbeh%C3%B6r-skruvmejsel-borrskruvmejsel/dp/B083DP4LXH?pd_rd_w=InoTU&content-id=amzn1.sym.7832760a-c497-4514-a1e7-73d6cc033ab0%3Aamzn1.symc.30e3dbb4-8dd8-4bad-b7a1-a45bcdbc49b8&pf_rd_p=7832760a-c497-4514-a1e7-73d6cc033ab0&pf_rd_r=ZQHK69DNCXG5NYE08Z9B&pd_rd_wg=FU4eL&pd_rd_r=9b1ea2fa-31b6-43d8-9c84-febc6f5acd52&pd_rd_i=B083DP4LXH&th=1';
    const expected =
      'https://www.amazon.se/Bosch-professionell-tillbeh%C3%B6r-skruvmejsel-borrskruvmejsel/dp/B083DP4LXH';
    expect(cleanUrl(input, providers).cleaned).toBe(expected);
  });

  it('removes generic trackers on an unknown site', () => {
    const { cleaned } = cleanUrl(
      'https://blog.example.org/post?utm_source=t&utm_campaign=c&fbclid=IwAB12&page=2',
      providers,
    );
    expect(cleaned).toBe('https://blog.example.org/post?page=2');
  });

  it('unwraps a Google result redirect', () => {
    const wrapper =
      'https://www.google.com/url?sa=t&url=' +
      encodeURIComponent('https://en.wikipedia.org/wiki/Bosch') + '&usg=AOvVaw0';
    const { cleaned } = cleanUrl(wrapper, providers, { unwrap: true });
    expect(cleaned).toBe('https://en.wikipedia.org/wiki/Bosch');
  });

  it('strips Amazon referral tag by default but keeps it with keepReferral', () => {
    const input = 'https://www.amazon.se/dp/B083DP4LXH?tag=friend-21&pd_rd_w=InoTU';
    expect(cleanUrl(input, providers).cleaned).toBe('https://www.amazon.se/dp/B083DP4LXH');
    expect(cleanUrl(input, providers, { keepReferral: true }).cleaned).toBe(
      'https://www.amazon.se/dp/B083DP4LXH?tag=friend-21',
    );
  });

  it('removes custom.json additions like geniuslink', () => {
    const { cleaned } = cleanUrl(
      'https://www.amazon.se/dp/B083DP4LXH?geniuslink=true&psc=1',
      providers,
    );
    expect(cleaned).toBe('https://www.amazon.se/dp/B083DP4LXH?psc=1');
  });

  it('strips the AliExpress affiliate bundle by default, keeps it with keepReferral', () => {
    const input =
      'https://www.aliexpress.com/?aff_fcid=56cdd749951b474fab587dcb5c453b71-1787008447956-00868-_DmE0c9x&tt=CPS_NORMAL&aff_fsk=_DmE0c9x&aff_platform=portals-tool&aff_trace_key=56cdd749951b474fab587dcb5c453b71-1787008447956-00868-_DmE0c9x&afSmartRedirect=y';
    expect(cleanUrl(input, providers).cleaned).toBe('https://www.aliexpress.com/');
    expect(cleanUrl(input, providers, { keepReferral: true }).cleaned).toBe(input);
  });

  it('strips AliExpress webview/attribution flags but keeps functional productIds', () => {
    const input =
      'https://www.aliexpress.com/ssr/300002660/Deals-HomePage?disableNav=YES&pha_manifest=ssr&_immersiveMode=true&businessCode=guide&source=superdeals&productIds=1005011993727808';
    expect(cleanUrl(input, providers).cleaned).toBe(
      'https://www.aliexpress.com/ssr/300002660/Deals-HomePage?productIds=1005011993727808',
    );
  });

  it('strips AliExpress product-page tracking but keeps the variant selector pdp_ext_f', () => {
    const input =
      'https://www.aliexpress.com/item/1005010114448300.html?sourceType=561&pvid=e5aec4df-c76f-4fba-8cd5-603aaa1efa08&pdp_ext_f=%7B%22ship_from%22%3A%22CN%22%2C%22sku_id%22%3A%2212000051191005045%22%7D&aecmd=true';
    expect(cleanUrl(input, providers).cleaned).toBe(
      'https://www.aliexpress.com/item/1005010114448300.html?pdp_ext_f=%7B%22ship_from%22%3A%22CN%22%2C%22sku_id%22%3A%2212000051191005045%22%7D',
    );
  });

  it('leaves a clean URL alone', () => {
    const input = 'https://www.svt.se/nyheter/lokalt/uppsala?page=3';
    expect(cleanUrl(input, providers).cleaned).toBe(input);
  });
});
