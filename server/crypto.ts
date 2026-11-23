/**
 * Crypto price / info / OHLC / news routes backed by CoinGecko with resilient
 * fallbacks (live → cache → stale → procedural mock).
 */
import express from 'express';
import { getAiClient, generateContentWithFallback } from './gemini';
import { aggregateRss, sanitizeRssSymbol, type FeedKind } from './rss';

export const createCryptoRouter = () => {
  const router = express.Router();

  const rssHandler = (kind: FeedKind) => async (req: express.Request, res: express.Response) => {
    const symbol = sanitizeRssSymbol(req.query.symbol ?? (kind === 'stock' ? 'AAPL' : 'BTC'), kind);
    if (!symbol) return res.status(400).json({ error: 'Invalid symbol.' });
    const result = await aggregateRss(kind, symbol);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...result, symbol });
  };
  router.get('/rss', rssHandler('crypto'));
  router.get('/stock-rss', rssHandler('stock'));

// Proxy for Crypto APIs
// Cache for Crypto API responses to handle rate limits
const cryptoCache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 60000; // 1 minute focus on fresh data
const STALE_TTL = 1800000; // 30 minutes for emergency stale data

const SERVER_FALLBACK_PRICES: Record<string, { usd: number, usd_24h_change: number }> = {
  bitcoin: { usd: 65420, usd_24h_change: 2.5 },
  ethereum: { usd: 3450, usd_24h_change: 1.8 },
  ripple: { usd: 0.62, usd_24h_change: -0.5 },
  solana: { usd: 145, usd_24h_change: 4.2 },
  cardano: { usd: 0.45, usd_24h_change: 0.2 },
  polkadot: { usd: 7.20, usd_24h_change: -1.2 },
  chainlink: { usd: 18.50, usd_24h_change: 3.1 },
  stellar: { usd: 0.12, usd_24h_change: -0.8 },
  'hedera-hashgraph': { usd: 0.08, usd_24h_change: 1.5 },
  sui: { usd: 1.15, usd_24h_change: 5.6 },
  'xdce-utility-token': { usd: 0.045, usd_24h_change: -1.0 },
  'avalanche-2': { usd: 35.80, usd_24h_change: 2.7 },
  'polygon-ecosystem-token': { usd: 0.68, usd_24h_change: -0.4 },
  near: { usd: 5.40, usd_24h_change: 3.8 },
  'crypto-com-chain': { usd: 0.12, usd_24h_change: 1.2 },
  'ondo-finance': { usd: 0.75, usd_24h_change: 2.5 },
  algorand: { usd: 0.18, usd_24h_change: -0.5 },
  vechain: { usd: 0.035, usd_24h_change: 0.8 },
  'research-coin': { usd: 0.42, usd_24h_change: 15.2 },
  astar: { usd: 0.08, usd_24h_change: -1.2 },
  'kata-exchange': { usd: 0.00045, usd_24h_change: 5.4 },
  'superior-coin': { usd: 0.0012, usd_24h_change: -2.1 },
};

// Keep track of active requests to prevent concurrent duplicate calls
const inFlightRequests: Record<string, Promise<any> | undefined> = {};

const fetchWithCache = async (cacheKey: string, fetcher: () => Promise<any>) => {
  const now = Date.now();
  const entry = cryptoCache[cacheKey];

  // Return fresh cache immediately
  if (entry && (now - entry.timestamp) < CACHE_TTL) {
    return { data: entry.data, source: 'cache' };
  }

  // If a request is already in progress, wait for it
  if (inFlightRequests[cacheKey]) {
    try {
      const data = await inFlightRequests[cacheKey];
      return { data, source: 'coalesced' };
    } catch (e) {
      // If the coalesced request failed, we might still have stale data
    }
  }

  // Fetch new data
  const request = (async () => {
    try {
      const data = await fetcher();
      cryptoCache[cacheKey] = { data, timestamp: Date.now() };
      return data;
    } finally {
      delete inFlightRequests[cacheKey];
    }
  })();

  inFlightRequests[cacheKey] = request;

  try {
    const data = await request;
    return { data, source: 'live' };
  } catch (error: any) {
    // If live fetch fails (e.g. 429), fall back to stale cache if available
    if (entry && (now - entry.timestamp) < STALE_TTL) {
      console.warn(`Fetch for ${cacheKey} failed (${error.message}). Serving stale cache.`);
      return { data: entry.data, source: 'stale', warning: 'Upstream rate limit reached' };
    }
    throw error;
  }
};

router.get('/prices', async (req, res) => {
  const { ids } = req.query;
  const cacheKey = `prices_${ids}`;
  
  try {
    const result = await fetchWithCache(cacheKey, async () => {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        const err = new Error(`CoinGecko status: ${response.status} - ${text.substring(0, 100)}`);
        (err as any).status = response.status;
        throw err;
      }
      return await response.json();
    });
    res.json(result);
  } catch (error: any) {
    console.log('[Crypto Prices] Serving resilient fallback values.');
    
    // Construct robust fallback data
    const idList = typeof ids === 'string' ? ids.split(',') : [];
    const fallbackData: Record<string, any> = {};
    const nowSecs = Math.floor(Date.now() / 1000);
    
    idList.forEach(id => {
      const fixed = SERVER_FALLBACK_PRICES[id];
      if (fixed) {
        const variation = 1 + (Math.random() * 0.008 - 0.004); // subtle fluctuation
        const finalUsd = parseFloat((fixed.usd * variation).toFixed(fixed.usd < 1 ? 6 : 2));
        const finalChange = parseFloat((fixed.usd_24h_change + (Math.random() * 0.4 - 0.2)).toFixed(2));
        fallbackData[id] = {
          usd: finalUsd,
          usd_24h_change: finalChange,
          last_updated_at: nowSecs
        };
      } else {
        // Unknown / custom coin
        let hashSeed = 0;
        for (let i = 0; i < id.length; i++) hashSeed += id.charCodeAt(i);
        const randPrice = parseFloat((0.85 + (hashSeed % 150) * 0.08).toFixed(3));
        const randChange = parseFloat(((hashSeed % 20) - 10).toFixed(2));
        fallbackData[id] = {
          usd: randPrice,
          usd_24h_change: randChange,
          last_updated_at: nowSecs
        };
      }
    });

    res.json({
      data: fallbackData,
      source: 'fallback_mock',
      warning: 'Using resilient mock fallback due to rate limit/connection issue'
    });
  }
});

router.get('/coin-info', async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing coin id' });
  }
  const cacheKey = `coin_info_${id}`;
  
  try {
    const result = await fetchWithCache(cacheKey, async () => {
      const url = `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CoinGecko status: ${response.status}`);
      }
      return await response.json();
    });
    const info = result.data;
    res.json({
      id: info.id,
      symbol: info.symbol?.toUpperCase(),
      name: info.name,
      icon: info.image?.small || info.image?.thumb || '',
      priceUsd: info.market_data?.current_price?.usd,
      change24h: info.market_data?.price_change_percentage_24h
    });
  } catch (error: any) {
    console.log('[Crypto Info] Serving resilient fallback detail for:', id);
    // Guesses / procedurally generated fallback if coingecko rate limits or fails in live environment
    let hashSeed = 0;
    for (let i = 0; i < (id as string).length; i++) hashSeed += (id as string).charCodeAt(i);
    const randPrice = parseFloat((0.85 + (hashSeed % 150) * 0.08).toFixed(3));
    const randChange = parseFloat(((hashSeed % 20) - 10).toFixed(2));
    const guessedName = (id as string).split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    const guessedSymbol = guessedName.split(' ').map(w => w[0]).join('').substring(0, 4).toUpperCase();
    res.json({
      id,
      symbol: guessedSymbol || 'CUST',
      name: guessedName,
      icon: '',
      priceUsd: randPrice,
      change24h: randChange
    });
  }
});

router.get('/ohlc', async (req, res) => {
  const { id, days } = req.query;
  const cacheKey = `ohlc_${id}_${days}`;

  try {
    const result = await fetchWithCache(cacheKey, async () => {
      const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`;
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        const err = new Error(`CoinGecko status: ${response.status} - ${text.substring(0, 100)}`);
        (err as any).status = response.status;
        throw err;
      }
      return await response.json();
    });
    res.json(result);
  } catch (error: any) {
    console.log('[Crypto OHLC] Serving procedural fallback candles for:', id);
    
    // Create clean sequence of pseudo-random candles
    const numDays = parseInt(days as string) || 7;
    const now = Date.now();
    
    const basePrice = SERVER_FALLBACK_PRICES[id as string]?.usd || 1.25;
    const candlesList: any[] = [];
    
    let numCandles = 30;
    let stepMs = 24 * 3600 * 1000;
    
    if (numDays === 1) {
      numCandles = 24;
      stepMs = 3600 * 1000;
    } else if (numDays === 7) {
      numCandles = 28;
      stepMs = 6 * 3600 * 1000;
    } else {
      numCandles = Math.min(100, Math.max(30, numDays));
      stepMs = Math.round((numDays * 24 * 3600 * 1000) / numCandles);
    }
    
    let currentCandlePrice = basePrice;
    for (let i = 0; i < numCandles; i++) {
      const candleTime = now - i * stepMs;
      const changePercent = (Math.random() * 0.05 - 0.024); // -2.4% to +2.6%
      const nextCandlePrice = currentCandlePrice * (1 - changePercent);
      
      const open = nextCandlePrice;
      const close = currentCandlePrice;
      const high = Math.max(open, close) * (1 + Math.random() * 0.008);
      const low = Math.min(open, close) * (1 - Math.random() * 0.008);
      
      candlesList.unshift([candleTime, open, high, low, close]);
      currentCandlePrice = nextCandlePrice;
    }

    res.json({
      data: candlesList,
      source: 'fallback_procedural_candles',
      warning: 'Procedural chart rendered due to rate-limiting/error'
    });
  }
});

router.get('/sek-rate', async (req, res) => {
  try {
    const url = 'https://open.er-api.com/v6/latest/USD';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FX Rate status: ${response.status}`);
    const data = await response.json();
    res.json({ data, source: 'live' });
  } catch (error: any) {
    console.error('SEK Rate Proxy Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const getGeminiFallbackNews = async (symbol: string, req?: express.Request): Promise<any[]> => {
  const customKey = req?.headers['x-gemini-key'] as string;
  if (!process.env.GEMINI_API_KEY && !customKey) {
    console.warn('No Gemini API key found, skipping Gemini news fallback');
    return [];
  }
  try {
    const ai = getAiClient(req);
    const prompt = `Generate 5 realistic, professional financial/cryptocurrency/stock market news articles for the trading asset symbol "${symbol}". 
The news must be high-quality, timely, and analytical, similar to Reuters, Bloomberg, or CoinDesk.
Return the response as a JSON array of objects. Do NOT wrap it in any Markdown codeblocks or other text.
Each object in the array MUST have the following structure:
{
  "id": "string (unique random numerical id, e.g., '1023245')",
  "title": "string (engaging, professional headline)",
  "url": "string (realistic news source URL or '#')",
  "source_info": {
    "name": "string (e.g., Bloomberg, Reuters, CoinDesk, Cointelegraph)"
  },
  "published_on": number (current UNIX timestamp in seconds, slightly staggered, e.g. within the last 24 hours),
  "imageurl": "string (high-quality Unsplash image URL related to crypto/stocks/finance)",
  "body": "string (2-3 sentences of detailed, insightful news body/summary)"
}
Only output the raw JSON array of objects.`;

    const response = await generateContentWithFallback(ai, {
      model: 'gemini-4-hydrogen',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const text = response.text;
    if (text) {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Gemini fallback news unavailable, using programmatic news:', error instanceof Error ? error.message : String(error));
  }
  return [];
};

const getProgrammaticFallbackNews = (symbol: string): any[] => {
  const cleanSymbol = (symbol || 'BTC').toUpperCase();
  const nowSecs = Math.floor(Date.now() / 1000);
  
  const newsTemplates = [
    {
      title: `${cleanSymbol} Technical Structure Shows Strong Momentum Amid Market Resilience`,
      body: `Market analysts note that ${cleanSymbol} has entered a critical consolidation range. Order book depth and volume indicators point to sustained interest from professional desks as technical patterns mature.`,
      source: "Bloomberg Finance"
    },
    {
      title: `Institutional Allocations to ${cleanSymbol} Derivatives Hit Multi-Month Highs`,
      body: `Recent flow data indicates significant positioning in ${cleanSymbol} options and futures. Open interest has expanded, reflecting hedging activity and strategic accumulation by mid-tier asset managers.`,
      source: "Reuters Market Desk"
    },
    {
      title: `Macroeconomic Outlook Shifts Support Capital Rotation into ${cleanSymbol}`,
      body: `As central banks signal subtle changes in policy frameworks, global liquidity trends are shifting. Capital is rotating into premium liquid assets, providing a favorable backdrop for ${cleanSymbol} trading pairs.`,
      source: "Financial Times"
    },
    {
      title: `${cleanSymbol} Intraday Volatility Decreases as Liquidations Stabilize`,
      body: `Volatility metrics for ${cleanSymbol} cooled down during early trading sessions today. Deleveraging events have largely run their course, paving the way for structured support levels to establish.`,
      source: "CoinDesk Terminal"
    }
  ];

  return newsTemplates.map((tpl, idx) => ({
    id: `fallback_${cleanSymbol}_${idx}_${nowSecs}`,
    title: tpl.title,
    url: "#",
    source_info: { name: tpl.source },
    published_on: nowSecs - (idx * 7200) - Math.floor(Math.random() * 3600),
    imageurl: (cleanSymbol === 'EUR' || cleanSymbol === 'USD' || cleanSymbol === 'SEK' || cleanSymbol === 'GBP')
      ? "https://images.unsplash.com/photo-1621416894569-0f39ed31d247?auto=format&fit=crop&w=600&q=80"
      : ((cleanSymbol === 'BTC' || cleanSymbol === 'ETH' || cleanSymbol === 'SOL' || cleanSymbol === 'USDT')
        ? "https://images.unsplash.com/photo-1516245834210-c4c142787335?auto=format&fit=crop&w=600&q=80"
        : "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=600&q=80"),
    body: tpl.body
  }));
};

const getGoogleFinanceNews = async (symbol: string): Promise<any[]> => {
  try {
    const query = encodeURIComponent(`${symbol} finance stock market`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Google News RSS failed: status ${response.status}`);
    }
    const xml = await response.text();
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g);
    if (!itemMatches) {
      return [];
    }

    const newsItems: any[] = [];
    const nowSecs = Math.floor(Date.now() / 1000);

    for (const itemXml of itemMatches.slice(0, 8)) {
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/);

      if (titleMatch) {
        let rawTitle = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
        const link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '#';
        const pubDateStr = pubDateMatch ? pubDateMatch[1].trim() : '';
        let sourceName = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : 'Google Finance News';

        let title = rawTitle;
        if (title.includes(' - ')) {
          const parts = title.split(' - ');
          const potentialSource = parts[parts.length - 1];
          if (potentialSource.toLowerCase() === sourceName.toLowerCase() || sourceName === 'Google Finance News') {
            sourceName = potentialSource;
            title = parts.slice(0, parts.length - 1).join(' - ');
          }
        }

        title = title
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        let publishedOn = nowSecs;
        if (pubDateStr) {
          try {
            publishedOn = Math.floor(new Date(pubDateStr).getTime() / 1000);
          } catch (e) {
            // ignore
          }
        }

        const id = `google_news_${symbol}_${Math.random().toString(36).substr(2, 9)}`;
        const stockImages = [
          "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80",
          "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=600&q=80",
          "https://images.unsplash.com/photo-1621416894569-0f39ed31d247?auto=format&fit=crop&w=600&q=80",
          "https://images.unsplash.com/photo-1642543492481-44e81e3914a7?auto=format&fit=crop&w=600&q=80"
        ];
        const imageurl = stockImages[Math.floor(Math.random() * stockImages.length)];

        newsItems.push({
          id,
          title,
          url: link,
          source_info: {
            name: sourceName
          },
          published_on: publishedOn,
          imageurl,
          body: `Latest developments regarding ${symbol} market action. Reported by ${sourceName} via Google Finance Syndicate.`
        });
      }
    }
    return newsItems;
  } catch (error) {
    console.error('Google Finance News parser failed:', error);
    return [];
  }
};

router.get('/news', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC');
  const cacheKey = `news_${symbol}`;
  
  try {
    const apiKeySuffix = process.env.CRYPTOCOMPARE_API_KEY ? `&api_key=${process.env.CRYPTOCOMPARE_API_KEY}` : '';
    const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${symbol}${apiKeySuffix}`;
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.Response !== 'Error' && Array.isArray(data.Data)) {
        cryptoCache[cacheKey] = { data, timestamp: Date.now() };
        return res.json({ data, source: 'live' });
      }
    }

    if (cryptoCache[cacheKey]) {
      return res.json({ data: cryptoCache[cacheKey].data, source: 'cache', warning: 'Upstream feed unavailable' });
    }

    // Instead of throwing an error, we log a status info line and try fallbacks directly.
    console.log(`[News Feed Info] Upstream feed status ${response.status}. Attempting fallbacks.`);
  } catch (err: any) {
    console.log(`[News Feed Info] Upstream connection issue: ${err.message || err}. Attempting fallbacks.`);
  }

  // Fallback chain:
  // 1. Google Finance RSS
  try {
    const googleNews = await getGoogleFinanceNews(symbol);
    if (googleNews && googleNews.length > 0) {
      const payload = { Data: googleNews };
      cryptoCache[cacheKey] = { data: payload, timestamp: Date.now() };
      return res.json({ data: payload, source: 'google_finance_fallback' });
    }
  } catch (googleNewsErr: any) {
    console.log('[News Feed Info] Google Finance news fallback did not yield results:', googleNewsErr.message || googleNewsErr);
  }

  // 2. Gemini fallback
  try {
    const geminiNews = await getGeminiFallbackNews(symbol, req);
    if (geminiNews && geminiNews.length > 0) {
      const payload = { Data: geminiNews };
      cryptoCache[cacheKey] = { data: payload, timestamp: Date.now() };
      return res.json({ data: payload, source: 'gemini_fallback' });
    }
  } catch (geminiErr: any) {
    console.log('[News Feed Info] Gemini news fallback did not yield results:', geminiErr.message || geminiErr);
  }

  // 3. Cache fallback
  if (cryptoCache[cacheKey]) {
    return res.json({ data: cryptoCache[cacheKey].data, source: 'cache', info: 'returned cached data' });
  }

  // 4. Programmatic high-fidelity news fallback
  const programmaticNews = getProgrammaticFallbackNews(symbol);
  const payload = { Data: programmaticNews };
  cryptoCache[cacheKey] = { data: payload, timestamp: Date.now() };
  return res.json({ data: payload, source: 'programmatic_fallback' });
});


  return router;
};
