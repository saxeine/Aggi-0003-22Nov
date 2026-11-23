
import { CoinId, PriceData, OHLCCandle, NewsItem } from '../crypto-types';
import { COINS } from '../constants/crypto';

const safeJson = async (response: Response) => {
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  }
  const text = await response.text();
  if (text.includes('<!DOCTYPE html>') || text.includes('<html>')) {
    throw new Error(`Server returned HTML instead of JSON (Status ${response.status})`);
  }
  throw new Error(`Unexpected response format: ${text.substring(0, 50)}`);
};

export const fetchAllPrices = async (customCoinsList?: { id: string }[]): Promise<Record<CoinId, PriceData>> => {
  try {
    const list = customCoinsList || COINS;
    const ids = list.filter(c => c.id !== 'thb-currency').map(c => c.id).join(',');
    const response = await fetch(`/api/crypto/prices?ids=${ids}`);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    const result = await safeJson(response);
    const data = result.data;
    
    if (!data || typeof data !== 'object') {
      console.warn("Price data is not an object:", data);
      return {} as Record<CoinId, PriceData>;
    }
    
    return Object.keys(data).reduce((acc, id) => {
      acc[id] = {
        usd: data[id].usd,
        usd_24h_change: data[id].usd_24h_change,
        last_updated_at: data[id].last_updated_at
      };
      return acc;
    }, {} as Record<CoinId, PriceData>);
  } catch (error) {
    console.log('[Crypto API] fetch notification:', error);
    throw error;
  }
};

export const fetchOHLC = async (id: CoinId, days: number, currentPrice: number): Promise<OHLCCandle[]> => {
  try {
    const response = await fetch(`/api/crypto/ohlc?id=${id}&days=${days}`);
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    const result = await safeJson(response);
    const data = result.data;
    
    if (!Array.isArray(data)) {
      console.warn(`OHLC data for ${id} is not an array:`, data);
      throw new Error("Invalid OHLC data format received");
    }
    
    // CoinGecko OHLC format: [time, open, high, low, close]
    return data.map((d: any) => ({
      time: d[0],
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
      volume: 0 // Free API doesn't provide volume in OHLC endpoint
    }));
  } catch (error) {
    console.log('[Crypto API] OHLC fetch notification:', error);
    // Return a mock candle if fetch fails to keep analysis alive
    const now = Date.now();
    return [
      { time: now - 3600000, open: currentPrice * 0.99, high: currentPrice * 1.01, low: currentPrice * 0.985, close: currentPrice, volume: 100 }
    ];
  }
};

export interface FXRates {
  SEK: number;
  THB: number;
}

export const fetchFXRates = async (): Promise<FXRates> => {
  try {
    const response = await fetch('/api/crypto/sek-rate');
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }
    const result = await safeJson(response);
    const data = result.data;
    return {
      SEK: data.rates.SEK || 10.65,
      THB: data.rates.THB || 34.50
    };
  } catch (error: any) {
    console.log("FX Rate loaded with fallback: ", error.message || error);
    return {
      SEK: 10.65,
      THB: 34.50
    };
  }
};

export const fetchCoinNews = async (symbol: string): Promise<NewsItem[]> => {
  try {
    const response = await fetch(`/api/crypto/news?symbol=${symbol}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const result = await safeJson(response);
    const data = result.data?.Data; // CryptoCompare uses .Data
    
    if (!Array.isArray(data)) {
      console.warn(`News data for ${symbol} is not an array:`, data);
      return [];
    }
    
    return data.map((item: any) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source_info?.name || item.source,
      time: new Date(item.published_on * 1000).toLocaleString(),
      image: item.imageurl,
      description: item.body
    }));
  } catch (error: any) {
    console.log("News loaded via fallback stream: ", error.message || error);
    return [];
  }
};

export type CryptoRssFeedSource = 'cointelegraph' | 'coindesk' | 'decrypt' | 'cryptopotato' | 'google';
export type StockRssFeedSource = 'yahoo' | 'marketwatch' | 'cnbc' | 'investing' | 'nasdaq' | 'google';
export type RssSourceState = 'live' | 'cache' | 'stale' | 'error';
export interface RssFeedItem {
  id: string;
  title: string;
  description: string;
  url: string;
  image?: string;
  source: string;
  sourceId: string;
  publishedAt: string | null;
}
export interface RssFeedResponse {
  items: RssFeedItem[];
  sources: Array<{ id: string; name: string; state: RssSourceState; updatedAt: string | null }>;
  symbol: string;
}
async function fetchRssFeed(path: string, symbol: string, signal?: AbortSignal): Promise<RssFeedResponse> {
  const params = new URLSearchParams({ symbol });
  const response = await fetch(`${path}?${params}`, { signal });
  if (!response.ok) throw new Error(`RSS request failed (HTTP ${response.status})`);
  const result = await safeJson(response);
  if (!Array.isArray(result?.items) || !Array.isArray(result?.sources)) throw new Error('Invalid RSS response');
  return result as RssFeedResponse;
}
export const fetchCryptoRssFeed = (symbol: string, signal?: AbortSignal) => fetchRssFeed('/api/crypto/rss', symbol, signal);
export const fetchStockRssFeed = (symbol: string, signal?: AbortSignal) => fetchRssFeed('/api/crypto/stock-rss', symbol, signal);
