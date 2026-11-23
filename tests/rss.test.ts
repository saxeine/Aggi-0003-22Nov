import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateRss, parseRss, safeRssUrl, sanitizeRssSymbol, RSS_FEEDS } from '../server/rss';
import { fetchStockRssFeed } from '../services/cryptoApi';
import { safeHttpUrl, storyMatchesAsset, relativeRssTime } from '../components/crypto/RssNewsFeed';

const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title><![CDATA[Apple &amp; &lt;script&gt;bad&lt;/script&gt; AAPL]]></title><link>https://example.com/a?x=1&amp;y=2</link><description><![CDATA[<p>Markets &amp; shares</p>]]></description><pubDate>Wed, 01 Jan 2025 12:00:00 GMT</pubDate><media:content url="https://example.com/img.jpg" /></item>
<item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>`;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('RSS feed security and parsing', () => {
  it('decodes entities, strips markup, validates links and returns stable stories', () => {
    const items = parseRss(xml, 'yahoo', 'Yahoo Finance');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Apple & bad AAPL', description: 'Markets & shares', url: 'https://example.com/a?x=1&y=2', image: 'https://example.com/img.jpg', publishedAt: '2025-01-01T12:00:00.000Z' });
    expect(items[0].id).toEqual(parseRss(xml, 'yahoo', 'Yahoo Finance')[0].id);
  });
  it('rejects external entities, malformed XML and non-http links', () => {
    expect(() => parseRss('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>', 'x', 'X')).toThrow();
    expect(() => parseRss('<rss><channel>', 'x', 'X')).toThrow();
    expect(safeRssUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeRssUrl('https://user:password@example.com')).toBeUndefined();
    expect(safeHttpUrl('data:image/svg+xml,test')).toBeUndefined();
  });
  it('allows only ticker characters and constructs fixed feed URLs', () => {
    expect(sanitizeRssSymbol(' brk.b ', 'stock')).toBe('BRK.B');
    for (const bad of ['AAPL&evil=1', 'https://evil.test', '../', 'AAPL,MSFT']) expect(sanitizeRssSymbol(bad, 'stock')).toBeNull();
    expect(RSS_FEEDS.stock[0].url('BRK.B')).toBe('https://feeds.finance.yahoo.com/rss/2.0/headline?s=BRK.B&region=US&lang=en-US');
  });
  it('filters ticker tokens, company names and per-ticker Yahoo results', () => {
    const item = { id: '1', title: 'BRK.B shares move', description: '', url: 'https://example.com', source: 'CNBC', sourceId: 'cnbc', publishedAt: null };
    expect(storyMatchesAsset(item, 'BRK.B', 'Berkshire Hathaway', 'stock')).toBe(true);
    expect(storyMatchesAsset({ ...item, title: 'BRKxB shares' }, 'BRK.B', '', 'stock')).toBe(false);
    expect(storyMatchesAsset({ ...item, title: 'Apple unveils device' }, 'AAPL', 'Apple Inc.', 'stock')).toBe(true);
    expect(storyMatchesAsset({ ...item, title: 'General news', sourceId: 'yahoo' }, 'AAPL', 'Apple', 'stock')).toBe(true);
    expect(relativeRssTime(null)).toBe('Date unavailable');
  });
  it('aggregates partial failures and caches then falls back to stale data', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2025-04-01T00:00:00Z'));
    const mock = vi.fn().mockImplementation((url: string) => url.includes('yahoo.com') ? Promise.resolve(new Response(xml)) : Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', mock);
    const first = await aggregateRss('stock', 'TESTABC');
    expect(first.items).toHaveLength(1);
    expect(first.sources.find(s => s.id === 'yahoo')?.state).toBe('live');
    expect(first.sources.find(s => s.id === 'cnbc')?.state).toBe('error');
    expect(mock).toHaveBeenCalledTimes(6);
    const cached = await aggregateRss('stock', 'TESTABC');
    expect(cached.sources.find(s => s.id === 'yahoo')?.state).toBe('cache');
    mock.mockRejectedValue(new Error('offline'));
    vi.advanceTimersByTime(61000);
    const stale = await aggregateRss('stock', 'TESTABC');
    expect(stale.sources.find(s => s.id === 'yahoo')?.state).toBe('stale');
    expect(stale.items).toHaveLength(1);
    vi.advanceTimersByTime(3600000);
    expect((await aggregateRss('stock', 'TESTABC')).items).toHaveLength(0);
  });
  it('client sends encoded symbols and handles failures', async () => {
    const mock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [], sources: [], symbol: 'AAPL' }), { headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', mock);
    await fetchStockRssFeed('BRK.B');
    expect(mock.mock.calls[0][0]).toBe('/api/crypto/stock-rss?symbol=BRK.B');
    await expect(fetchStockRssFeed('AAPL')).rejects.toThrow('HTTP 500');
  });
});
