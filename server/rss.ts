/** Fixed-source RSS aggregation; never accepts a URL from the client. */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { decode } from 'html-entities';

export type FeedKind = 'crypto' | 'stock';
export interface RssStory {
  id: string; title: string; description: string; url: string; image?: string;
  source: string; sourceId: string; publishedAt: string | null;
}
export interface FeedStatus { id: string; name: string; state: 'live' | 'cache' | 'stale' | 'error'; updatedAt: string | null }
export interface RssResult { items: RssStory[]; sources: FeedStatus[] }
type Feed = { id: string; name: string; url: (symbol: string) => string; tickerSpecific?: boolean };
const fixed = (url: string) => () => url;
export const RSS_FEEDS: Record<FeedKind, Feed[]> = {
  crypto: [
    { id: 'cointelegraph', name: 'Cointelegraph', url: fixed('https://cointelegraph.com/rss') },
    { id: 'coindesk', name: 'CoinDesk', url: fixed('https://www.coindesk.com/arc/outboundfeeds/rss/') },
    { id: 'decrypt', name: 'Decrypt', url: fixed('https://decrypt.co/feed') },
    { id: 'cryptopotato', name: 'CryptoPotato', url: fixed('https://cryptopotato.com/feed/') },
    { id: 'google', name: 'Google News RSS', url: fixed('https://news.google.com/rss/search?q=cryptocurrency&hl=en-US&gl=US&ceid=US:en') },
  ],
  stock: [
    { id: 'yahoo', name: 'Yahoo Finance', tickerSpecific: true, url: symbol => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US` },
    { id: 'marketwatch', name: 'MarketWatch', url: fixed('https://feeds.marketwatch.com/marketwatch/topstories/') },
    { id: 'cnbc', name: 'CNBC Markets', url: fixed('https://www.cnbc.com/id/100003114/device/rss/rss.html') },
    { id: 'investing', name: 'Investing.com', url: fixed('https://www.investing.com/rss/news_25.rss') },
    { id: 'nasdaq', name: 'Nasdaq', url: fixed('https://www.nasdaq.com/feed/rssoutbound') },
    { id: 'google', name: 'Google News RSS', url: fixed('https://news.google.com/rss/search?q=US%20stock%20market&hl=en-US&gl=US&ceid=US:en') },
  ],
};

export function sanitizeRssSymbol(input: unknown, kind: FeedKind): string | null {
  if (typeof input !== 'string') return null;
  const symbol = input.trim().toUpperCase();
  return (kind === 'stock' ? /^[A-Z0-9][A-Z0-9.-]{0,14}$/ : /^[A-Z0-9][A-Z0-9-]{0,14}$/).test(symbol) ? symbol : null;
}

export function safeRssUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { const u = new URL(decode(value.trim())); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}
const plainText = (value: unknown, max = 1000): string => {
  if (value && typeof value === 'object') value = (value as any)['#text'] ?? '';
  let text = String(value ?? '');
  // Decode before stripping tags, including doubly encoded markup.
  text = decode(decode(text)).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
};
const first = (x: any) => Array.isArray(x) ? x[0] : x;
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false, parseTagValue: false, trimValues: true });

export function parseRss(xml: string, sourceId: string, source: string): RssStory[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid or unsafe RSS XML');
  const parsed = xmlParser.parse(xml);
  if (!parsed?.rss?.channel) throw new Error('Not an RSS feed');
  const raw = parsed.rss.channel.item;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return entries.slice(0, 50).flatMap((item: any): RssStory[] => {
    const title = plainText(item.title, 300);
    const url = safeRssUrl(typeof item.link === 'object' ? item.link?.['#text'] : item.link);
    if (!title || !url) return [];
    const description = plainText(item.description || item['content:encoded'], 700);
    const media = first(item['media:content']) || first(item['media:thumbnail']) || first(item.enclosure) || {};
    const image = safeRssUrl(media['@_url'] || first(item['media:thumbnail'])?.['@_url']);
    const date = Date.parse(plainText(item.pubDate || item['dc:date'], 100));
    return [{ id: `${sourceId}:${url}`, title, description, url, ...(image ? { image } : {}), source, sourceId, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null }];
  });
}

const FRESH_MS = 60_000;
const STALE_MS = 60 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
type CacheEntry = { items: RssStory[]; time: number };
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<CacheEntry>>();

async function readLimited(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Feed too large');
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let text = ''; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error('Feed too large'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function fetchFeed(feed: Feed, symbol: string): Promise<CacheEntry> {
  const response = await fetch(feed.url(symbol), {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'AggiRSSReader/1.0' },
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const items = parseRss(await readLimited(response), feed.id, feed.name);
  if (!items.length) throw new Error('Feed contained no usable stories');
  return { items, time: Date.now() };
}

async function loadFeed(kind: FeedKind, feed: Feed, symbol: string): Promise<{ items: RssStory[]; status: FeedStatus }> {
  const key = `${kind}:${feed.id}:${feed.tickerSpecific ? symbol : ''}`;
  const stored = cache.get(key);
  const status = (state: FeedStatus['state'], time?: number): FeedStatus => ({ id: feed.id, name: feed.name, state, updatedAt: time ? new Date(time).toISOString() : null });
  if (stored && Date.now() - stored.time < FRESH_MS) return { items: stored.items, status: status('cache', stored.time) };
  try {
    let job = pending.get(key);
    if (!job) {
      job = fetchFeed(feed, symbol);
      pending.set(key, job);
      job.finally(() => pending.delete(key)).catch(() => {});
    }
    const entry = await job;
    cache.delete(key); cache.set(key, entry);
    if (cache.size > 250) cache.delete(cache.keys().next().value!);
    return { items: entry.items, status: status('live', entry.time) };
  } catch {
    if (stored && Date.now() - stored.time < STALE_MS) return { items: stored.items, status: status('stale', stored.time) };
    return { items: [], status: status('error') };
  }
}

export async function aggregateRss(kind: FeedKind, symbol: string): Promise<RssResult> {
  const results = await Promise.all(RSS_FEEDS[kind].map(feed => loadFeed(kind, feed, symbol)));
  const seen = new Set<string>();
  const items = results.flatMap(result => result.items).sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0)).filter(item => {
    const key = `${item.sourceId}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return { items, sources: results.map(result => result.status) };
}
