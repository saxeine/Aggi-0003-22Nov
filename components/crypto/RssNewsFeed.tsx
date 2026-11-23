import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Newspaper, RefreshCw } from 'lucide-react';
import { fetchCryptoRssFeed, fetchStockRssFeed, type RssFeedItem, type RssFeedResponse, type RssSourceState } from '../../services/cryptoApi';

type Kind = 'crypto' | 'stock';
const SOURCES: Record<Kind, Array<{ id: string; name: string }>> = {
  crypto: [{ id: 'cointelegraph', name: 'Cointelegraph' }, { id: 'coindesk', name: 'CoinDesk' }, { id: 'decrypt', name: 'Decrypt' }, { id: 'cryptopotato', name: 'CryptoPotato' }, { id: 'google', name: 'Google News RSS' }],
  stock: [{ id: 'yahoo', name: 'Yahoo' }, { id: 'marketwatch', name: 'MarketWatch' }, { id: 'cnbc', name: 'CNBC Markets' }, { id: 'investing', name: 'Investing.com' }, { id: 'nasdaq', name: 'Nasdaq' }, { id: 'google', name: 'Google News RSS' }],
};

export function safeHttpUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function storyMatchesAsset(item: RssFeedItem, symbol: string, name?: string, kind?: Kind): boolean {
  if (kind === 'stock' && item.sourceId === 'yahoo') return true; // Yahoo feed is requested for this ticker only.
  const text = `${item.title} ${item.description}`;
  const ticker = symbol.trim().toUpperCase();
  const tickerMatch = ticker && text.split(/[^A-Za-z0-9.-]+/).some(word => word.replace(/^\.+|\.+$/g, '') === ticker);
  const assetName = (name || '').trim().split(/\s+/)[0];
  const nameMatch = assetName.length >= 4 && text.toLowerCase().includes(assetName.toLowerCase());
  return Boolean(tickerMatch || nameMatch);
}
export function relativeRssTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
const dot = (state?: RssSourceState) => state === 'live' || state === 'cache' ? 'bg-emerald-400' : state === 'stale' ? 'bg-amber-400' : 'bg-rose-500';

export function RssNewsFeed({ kind, symbol, name }: { kind: Kind; symbol: string; name?: string }) {
  const [enabled, setEnabled] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState('all');
  const [focus, setFocus] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<RssFeedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setData(null); setError(''); setShowAll(false);
    if (!enabled) { setLoading(false); return () => controller.abort(); }
    const load = async () => {
      setLoading(true);
      try {
        const result = await (kind === 'stock' ? fetchStockRssFeed(symbol, controller.signal) : fetchCryptoRssFeed(symbol, controller.signal));
        if (id === requestId.current && !controller.signal.aborted) { setData(result); setError(''); }
      } catch (err) {
        if (id === requestId.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load RSS feeds.');
      } finally { if (id === requestId.current && !controller.signal.aborted) setLoading(false); }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [enabled, kind, symbol, refresh]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return (data?.items || []).filter(item => {
      if ((selected !== 'all' && item.sourceId !== selected) || (focus && !storyMatchesAsset(item, symbol, name, kind))) return false;
      if (selected === 'all' && seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [data, selected, focus, symbol, name, kind]);
  const states = data?.sources || [];
  const selectedStatus = states.find(s => s.id === selected);
  const statusText = !enabled ? 'Paused' : loading && !data ? 'Connecting' : error ? 'Connection error' : !data ? 'Connecting' : selected !== 'all' && selectedStatus ? `${selectedStatus.state === 'error' ? 'Unavailable' : selectedStatus.state === 'stale' ? 'Stale cache' : 'Available'}` : states.every(s => s.state === 'error') ? 'Unavailable' : states.some(s => s.state === 'error' || s.state === 'stale') ? 'Partial / cached' : 'Available';
  const globalState: RssSourceState | undefined = !data ? undefined : selectedStatus?.state || (states.every(s => s.state === 'error') ? 'error' : states.some(s => s.state === 'error' || s.state === 'stale') ? 'stale' : 'live');
  const pill = (active: boolean) => `px-3 py-1.5 rounded-full text-[10px] font-bold border transition-colors ${active ? 'bg-blue-500/20 text-blue-200 border-blue-400/50' : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'}`;

  return <section className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl mt-8" aria-label={kind === 'stock' ? 'US Stock RSS News Feed' : 'Crypto RSS News Feed'}>
    <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3"><Newspaper className="w-5 h-5 text-blue-400" /><div><h3 className="text-sm font-black uppercase tracking-wider text-white">{kind === 'stock' ? 'US Stock RSS News Feed' : 'Crypto RSS News Feed'}</h3><p role="status" className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-1"><span className={`w-2 h-2 rounded-full ${!enabled || (loading && !data) ? 'bg-slate-500' : dot(globalState)}`} />{statusText}</p></div></div>
      <div className="flex gap-2 items-center">
        <button type="button" aria-pressed={enabled} onClick={() => setEnabled(v => !v)} className={pill(enabled)}>{enabled ? 'Feed on' : 'Feed off'}</button>
        <button type="button" aria-label="Refresh news" title="Refresh news" disabled={!enabled || loading} onClick={() => setRefresh(n => n + 1)} className="p-2 text-slate-400 disabled:opacity-40"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        <button type="button" aria-label={expanded ? 'Collapse news feed' : 'Expand news feed'} aria-expanded={expanded} onClick={() => setExpanded(v => !v)} className="p-2 text-slate-400">{expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
      </div>
    </div>
    {expanded && <div className="p-5 space-y-4">
      {!enabled ? <p className="text-sm text-slate-400">Feed paused. Turn it on to load stories.</p> : <>
        <div className="flex flex-wrap gap-2" aria-label="News source filter">
          <button type="button" aria-pressed={selected === 'all'} onClick={() => { setSelected('all'); setShowAll(false); }} className={pill(selected === 'all')}>All RSS</button>
          {SOURCES[kind].map(source => { const status = states.find(s => s.id === source.id); return <button type="button" key={source.id} aria-pressed={selected === source.id} title={`${source.name}: ${status?.state || 'not checked'}`} onClick={() => { setSelected(source.id); setShowAll(false); }} className={`${pill(selected === source.id)} flex items-center gap-1.5`}><span className={`w-2 h-2 rounded-full ${status ? dot(status.state) : 'bg-slate-500'}`} />{source.id === 'yahoo' ? `Yahoo (${symbol})` : source.name}</button>; })}
        </div>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className={pill(!focus)} aria-pressed={!focus} onClick={() => { setFocus(false); setShowAll(false); }}>All Market</button><button type="button" className={pill(focus)} aria-pressed={focus} onClick={() => { setFocus(true); setShowAll(false); }}>{symbol.toUpperCase()} Focus</button><span className="text-[10px] text-slate-500">{kind === 'stock' ? 'Yahoo headlines are ticker-specific. ' : ''}Focus matches titles and descriptions.</span></div>
        {error && <p role="alert" className="text-rose-400 text-xs">{error} {data ? 'Showing previous results.' : 'Try again later.'}</p>}
        {!loading && data && states.some(s => s.state === 'stale' || s.state === 'error') && <p className="text-amber-400 text-xs">Some sources are unavailable or serving older cached stories. Select a source for its status.</p>}
        {loading && !data ? <p className="text-slate-400 text-sm">Loading RSS feeds…</p> : !items.length ? <p className="text-slate-400 text-sm">{data ? 'No stories match this selection.' : 'No news is available.'}</p> : <div className="space-y-3">
          {items.slice(0, showAll ? undefined : 6).map(item => { const url = safeHttpUrl(item.url); const image = safeHttpUrl(item.image); return <article key={item.id} className="flex gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            {image && <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-16 h-16 object-cover rounded-lg" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            <div className="min-w-0 flex-1"><div className="text-[10px] uppercase font-bold text-blue-400">{item.source} <span className="text-slate-500 ml-2">{relativeRssTime(item.publishedAt)}</span></div>
              <h4 className="text-sm font-bold text-white mt-1">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-300">{item.title} <ExternalLink className="inline w-3 h-3" /></a> : item.title}</h4>
              {item.description && <p className="text-xs text-slate-400 mt-2 line-clamp-3">{item.description}</p>}
            </div></article>; })}
          {items.length > 6 && <button type="button" className={pill(false)} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer stories' : `Show all ${items.length} stories`}</button>}
        </div>}
      </>}
    </div>}
  </section>;
}
