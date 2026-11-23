import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RssNewsFeed } from '../components/crypto/RssNewsFeed';
import { fetchStockRssFeed } from '../services/cryptoApi';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../services/cryptoApi', () => ({ fetchStockRssFeed: vi.fn(), fetchCryptoRssFeed: vi.fn() }));
let root: Root; let container: HTMLDivElement;
const feed = { symbol: 'AAPL', sources: [{ id: 'yahoo', name: 'Yahoo Finance', state: 'live', updatedAt: '2025-01-01T00:00:00Z' }, { id: 'cnbc', name: 'CNBC Markets', state: 'error', updatedAt: null }], items: [
  { id: '1', title: 'Apple story', url: 'https://example.com/a', description: 'Apple news', source: 'Yahoo Finance', sourceId: 'yahoo', publishedAt: null },
  { id: '2', title: 'Market story', url: 'https://example.com/b', description: 'Stocks today', source: 'CNBC Markets', sourceId: 'cnbc', publishedAt: null },
  { id: '3', title: 'Unsafe URL', url: 'javascript:alert(1)', image: 'javascript:alert(2)', description: '', source: 'CNBC Markets', sourceId: 'cnbc', publishedAt: null },
] };
const find = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))!;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.clearAllMocks(); });
describe('RSS reader', () => {
  it('starts enabled and expanded, filters sources and focus, and prevents unsafe links', async () => {
    vi.mocked(fetchStockRssFeed).mockResolvedValue(feed as any);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<RssNewsFeed kind="stock" symbol="AAPL" name="Apple Inc." />); });
    expect(fetchStockRssFeed).toHaveBeenCalledWith('AAPL', expect.any(AbortSignal));
    expect(container.textContent).toContain('US Stock RSS News Feed');
    expect(container.textContent).toContain('Apple story');
    expect(container.textContent).toContain('Partial / cached');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector('img[src^="javascript"]')).toBeNull();
    expect(container.querySelector('a[href="https://example.com/a"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    act(() => find('CNBC Markets').click());
    expect(container.textContent).toContain('Market story'); expect(container.textContent).not.toContain('Apple story');
    act(() => find('All RSS').click()); act(() => find('AAPL Focus').click());
    expect(container.textContent).toContain('Apple story'); expect(container.textContent).not.toContain('Market story');
    act(() => find('Feed on').click());
    expect(container.textContent).toContain('Feed paused');
  });
});
