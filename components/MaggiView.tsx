import React, { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMaggi } from '../hooks/useMaggi';
import { PROVIDER_LABELS } from '../maggi/config';
import MaggiChat from './maggi/MaggiChat';
import MaggiSources from './maggi/MaggiSources';
import MaggiSettingsPanel from './maggi/MaggiSettings';
import MaggiKeyDefaults from './maggi/MaggiKeyDefaults';
import { SavedMaggiQuery } from '../services/maggi/types';

export type MaggiTab = 'chat' | 'sources' | 'saved' | 'defaults' | 'settings';

interface MaggiViewProps {
  onBack: () => void;
  /** Items from the active workspace session, offered as a one-click import. */
  workspaceItems?: Array<{ id: string; name: string; type: string; mimeType?: string; data: string }>;
  workspaceName?: string;
  onSaveToSession?: (title: string, content: string) => void;
  initialTab?: MaggiTab;
  onOpenPodcast?: () => void;
}

type Tab = MaggiTab;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const inferType = (file: File): string => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return 'document';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.csv')) return 'text';
  return 'text';
};

const TAB_META: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'sources', label: 'Sources', icon: '📚' },
  { id: 'saved', label: 'Saved', icon: '🔖' },
  { id: 'defaults', label: 'Defaults', icon: '🔑' },
  { id: 'settings', label: 'Settings', icon: '⚙︎' },
];

const downloadMarkdown = (q: SavedMaggiQuery) => {
  const lines = [
    `# ${q.title}`,
    '',
    `**Saved:** ${new Date(q.updatedAt).toLocaleString()}`,
    q.workspaceName ? `**Workspace:** ${q.workspaceName}` : '',
    q.usage?.model ? `**Model:** ${q.usage.model}${q.usage.routedVia ? ` (${q.usage.routedVia})` : ''}` : '',
    '',
    '## Query',
    q.query,
    '',
    '## Answer',
    q.answer,
  ].filter(Boolean);

  if (q.citations?.length) {
    lines.push('', '## Citations');
    q.citations.forEach((c) => {
      lines.push(`- **[${c.marker}] ${c.docName}** — ${c.snippet}`);
    });
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${q.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'maggi-query'}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const MaggiView: React.FC<MaggiViewProps> = ({
  onBack,
  workspaceItems = [],
  workspaceName,
  onSaveToSession,
  initialTab = 'chat',
  onOpenPodcast,
}) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [toast, setToast] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ docId: string; chunkId: string } | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  // Saved queries UI state
  const [savedSearch, setSavedSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const maggi = useMaggi({ workspaceItems, workspaceName });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const handleIngestFiles = useCallback(async (files: File[]) => {
    const sources = await Promise.all(files.map(async (file) => ({
      name: file.name,
      type: inferType(file),
      mimeType: file.type,
      data: await fileToBase64(file),
    })));
    const results = await maggi.ingest(sources);
    const indexed = results.filter((r) => r.docId && !r.skipped);
    const skipped = results.filter((r) => r.skipped);
    const failed = results.filter((r) => r.error);
    const parts: string[] = [];
    if (indexed.length) parts.push(`✅ ${indexed.length} indexed (${indexed.reduce((n, r) => n + r.chunks, 0)} chunks)`);
    if (skipped.length) parts.push(`⏭ ${skipped.length} unchanged`);
    if (failed.length) parts.push(`⚠️ ${failed.length} failed: ${failed[0].error?.slice(0, 90)}`);
    showToast(parts.join(' · ') || 'Nothing to ingest.');
    return results;
  }, [maggi, showToast]);

  const handleIngestUrl = useCallback(async (url: string) => {
    const results = await maggi.ingest([{ name: url, type: 'link', data: url }]);
    const r = results[0];
    if (r?.error) showToast(`⚠️ ${r.error.slice(0, 140)}`);
    else showToast(`✅ Indexed ${url} → ${r?.chunks ?? 0} chunks`);
    return results;
  }, [maggi, showToast]);

  const handleAddNote = useCallback(async (title: string, text: string) => {
    const r = await maggi.addNote(title, text);
    showToast(r.error ? `⚠️ ${r.error}` : `✅ Note indexed → ${r.chunks} chunks`);
    return r;
  }, [maggi, showToast]);

  const handleImportWorkspace = useCallback(async () => {
    const results = await maggi.importWorkspace();
    if (!results.length) {
      showToast('No sources in the active workspace.');
      return results;
    }
    const chunks = results.reduce((n, r) => n + r.chunks, 0);
    showToast(`⚡ Imported ${results.length} workspace sources → ${chunks} chunks`);
    return results;
  }, [maggi, showToast]);

  const handleJump = useCallback((chunkId: string, docId: string) => {
    setHighlight({ chunkId, docId });
    setTab('sources');
  }, []);

  const handleSaveMessage = useCallback(async (assistantMsgId: string) => {
    const saved = await maggi.saveMessageAsQuery(assistantMsgId);
    if (saved) showToast(`🔖 Saved "${saved.title}"`);
  }, [maggi, showToast]);

  const handleSaveLatest = useCallback(async () => {
    const saved = await maggi.saveCurrentChatAsQuery();
    if (saved) showToast(`💾 Saved "${saved.title}"`);
  }, [maggi, showToast]);

  const stats = maggi.stats;
  const hasIndex = stats.chunks > 0;

  const chunkLookup = useMemo(() => {
    if (!highlight) return null;
    const chunks = maggi.getChunks(highlight.docId);
    return chunks.find((c) => c.id === highlight.chunkId) ?? null;
  }, [highlight, maggi]);

  const filteredSavedQueries = useMemo(() => {
    const q = savedSearch.trim().toLowerCase();
    return maggi.savedQueries.filter((item) => {
      if (pinnedOnly && !item.pinned) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.query.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
      );
    });
  }, [maggi.savedQueries, savedSearch, pinnedOnly]);

  const settingsForChat = maggi.settings;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app-bg" data-theme="maggi">
      {/* ---------------- top bar ---------------- */}
      <header className="flex flex-wrap items-center gap-2 border-b border-app-border bg-app-panel px-4 py-2.5">
        <button
          onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-lg border border-app-border text-app-dim transition-colors hover:text-app-text"
          title="Back to library"
        >
          ←
        </button>

        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-sm font-black text-black">
            M
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-black tracking-tight text-app-text">MAGGI</h1>
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
                RAG engine
              </span>
            </div>
            <p className="text-[9px] text-app-dim">Modular Augmented Generation &amp; Grounded Intelligence</p>
          </div>
        </div>

        {/* tabs */}
        <nav className="ml-4 flex rounded-lg border border-app-border bg-app-bg p-0.5">
          {TAB_META.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1 text-[11px] font-bold transition-colors ${tab === t.id ? 'bg-app-text text-app-bg' : 'text-app-dim hover:text-app-text'}`}
            >
              <span className="mr-1">{t.icon}</span>
              {t.label}
              {t.id === 'saved' && maggi.savedQueries.length > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] ${tab === t.id ? 'bg-app-bg/20 text-app-bg' : 'bg-emerald-500/15 text-emerald-400'}`}>
                  {maggi.savedQueries.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {onOpenPodcast && (
            <button
              type="button"
              onClick={onOpenPodcast}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-[11px] font-bold text-rose-300 transition-colors hover:bg-rose-500/25 hover:text-white"
              title="Open Podcast Studio"
            >
              <span>🎙️</span>
              <span>Podcast</span>
            </button>
          )}
          <button
            onClick={() => setStatsOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-app-border px-2.5 py-1.5 text-[10px] font-bold text-app-dim hover:text-app-text"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${hasIndex ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {stats.documents} docs · {stats.chunks} chunks
          </button>
          <span className="hidden rounded-lg bg-app-bg px-2 py-1.5 text-[10px] font-bold text-app-dim sm:block">
            🧠 {PROVIDER_LABELS[settingsForChat.provider]}
          </span>
        </div>
      </header>

      {/* ---------------- stats drawer ---------------- */}
      {statsOpen && (
        <div className="grid grid-cols-2 gap-2 border-b border-app-border bg-app-panel/60 px-4 py-3 sm:grid-cols-4 lg:grid-cols-8">
          {[
            ['Documents', stats.documents],
            ['Chunks', stats.chunks],
            ['Characters', stats.characters.toLocaleString()],
            ['Vocabulary', stats.vocabulary.toLocaleString()],
            ['Vectors', `${stats.chunks} × ${stats.dims || 0}`],
            ['Index size', `${(stats.approxBytes / 1024).toFixed(0)} KB`],
            ['Queries', maggi.usage.queries],
            ['Saved', maggi.savedQueries.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-app-border bg-app-bg/60 px-2.5 py-1.5">
              <div className="text-[8px] font-bold uppercase tracking-wide text-app-dim">{label}</div>
              <div className="text-xs font-bold tabular-nums text-app-text">{value}</div>
            </div>
          ))}
          <div className="col-span-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1.5 sm:col-span-4 lg:col-span-8">
            <div className="text-[8px] font-bold uppercase tracking-wide text-emerald-400">Embedding backend</div>
            <div className="text-[10px] text-app-text">
              {maggi.backendLabel}
              {maggi.usage.lastQueryMs ? ` · last retrieval ${maggi.usage.lastQueryMs}ms` : ''}
              {maggi.usage.lastTrace.length ? ` · ${maggi.usage.lastTrace.join(', ')}` : ''}
              {maggi.usage.lastRoutedVia ? ` · routed via ${maggi.usage.lastRoutedVia}` : ''}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- highlighted chunk ---------------- */}
      {highlight && chunkLookup && tab === 'sources' && (
        <div className="border-b border-emerald-500/30 bg-emerald-500/5 px-4 py-2">
          <div className="flex items-start gap-2">
            <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
              chunk #{chunkLookup.index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] font-bold text-app-text">{chunkLookup.docName}</div>
              <p className="line-clamp-3 text-[10px] leading-relaxed text-app-dim">{chunkLookup.text}</p>
            </div>
            <button onClick={() => setHighlight(null)} className="text-[10px] text-app-dim hover:text-app-text">✕</button>
          </div>
        </div>
      )}

      {/* ---------------- body ---------------- */}
      <main className="min-h-0 flex-1">
        {tab === 'chat' && (
          <MaggiChat
            messages={maggi.messages}
            isAnswering={maggi.isAnswering}
            hasIndex={hasIndex}
            stats={{ documents: stats.documents, chunks: stats.chunks }}
            backendLabel={maggi.backendLabel}
            providerLabel={PROVIDER_LABELS[settingsForChat.provider]}
            savedQueries={maggi.savedQueries}
            onAsk={maggi.ask}
            onStop={maggi.stop}
            onClear={maggi.clearChat}
            onOpenSettings={() => setTab('settings')}
            onOpenSaved={() => setTab('saved')}
            onSaveMessage={handleSaveMessage}
            onSaveLatest={handleSaveLatest}
            onJumpToSource={handleJump}
          />
        )}

        {tab === 'sources' && (
          <MaggiSources
            documents={maggi.documents}
            isIngesting={maggi.isIngesting}
            progress={maggi.progress}
            workspaceCount={workspaceItems.length}
            onIngestFiles={handleIngestFiles}
            onIngestUrl={handleIngestUrl}
            onAddNote={handleAddNote}
            onImportWorkspace={handleImportWorkspace}
            onRemove={maggi.removeDocument}
            onClear={maggi.clearIndex}
            getChunks={maggi.getChunks}
            getRelated={maggi.getRelated}
          />
        )}

        {tab === 'saved' && (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-app-border px-4 py-3">
              <input
                type="text"
                value={savedSearch}
                onChange={(e) => setSavedSearch(e.target.value)}
                placeholder="Search saved queries, answers, or titles…"
                className="min-w-[200px] flex-1 rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs text-app-text outline-none focus:border-app-text/50"
              />
              <button
                type="button"
                onClick={() => setPinnedOnly((v) => !v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                  pinnedOnly
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-app-border bg-app-bg text-app-dim hover:text-app-text'
                }`}
              >
                📌 Pinned only
              </button>
              {maggi.savedQueries.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    maggi.clearSavedQueries();
                    showToast('Cleared saved queries.');
                  }}
                  className="rounded-lg border border-app-border px-2.5 py-1.5 text-[11px] font-bold text-app-dim hover:border-red-400/40 hover:text-red-400 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4">
              {filteredSavedQueries.length === 0 ? (
                <div className="mx-auto max-w-md py-12 text-center">
                  <div className="text-3xl">🔖</div>
                  <h3 className="mt-2 text-sm font-bold text-app-text">
                    {maggi.savedQueries.length === 0 ? 'No saved MAGGI queries yet' : 'No matching saved queries'}
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-app-dim">
                    {maggi.savedQueries.length === 0
                      ? 'Click "🔖 Save Query" on any answer in MAGGI Chat or the main workspace to preserve questions, grounded answers, and citations permanently.'
                      : 'Try clearing the search box or disabling the pinned filter.'}
                  </p>
                </div>
              ) : (
                <div className="mx-auto max-w-4xl space-y-3">
                  {filteredSavedQueries.map((item) => {
                    const isExpanded = !!expandedIds[item.id];
                    const isEditing = editingId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border p-3.5 transition-colors ${
                          item.pinned
                            ? 'border-amber-500/40 bg-amber-500/[0.03]'
                            : 'border-app-border bg-app-panel/50'
                        }`}
                      >
                        {/* Title + Meta */}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={editingTitle}
                                  onChange={(e) => setEditingTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      void maggi.renameSavedQuery(item.id, editingTitle);
                                      setEditingId(null);
                                    } else if (e.key === 'Escape') {
                                      setEditingId(null);
                                    }
                                  }}
                                  autoFocus
                                  className="flex-1 rounded-lg border border-app-border bg-app-bg px-2.5 py-1 text-xs font-bold text-app-text outline-none focus:border-emerald-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    void maggi.renameSavedQuery(item.id, editingTitle);
                                    setEditingId(null);
                                  }}
                                  className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-black"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="rounded-lg border border-app-border px-2 py-1 text-[10px] text-app-dim"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                {item.pinned && (
                                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                                    📌 Pinned
                                  </span>
                                )}
                                <h3 className="text-xs font-bold text-app-text">{item.title}</h3>
                              </div>
                            )}

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-app-dim">
                              <span>{new Date(item.updatedAt).toLocaleString()}</span>
                              {item.workspaceName && (
                                <span className="rounded bg-app-bg px-1.5 py-0.5 text-app-text/80">
                                  {item.workspaceName}
                                </span>
                              )}
                              {item.usage?.model && <span>{item.usage.model}</span>}
                              {item.usage?.routedVia && (
                                <span className="text-emerald-400/90">via {item.usage.routedVia}</span>
                              )}
                              {item.citations?.length > 0 && (
                                <span>{item.citations.length} citations</span>
                              )}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void maggi.togglePinQuery(item.id)}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors ${
                                item.pinned
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                  : 'border-app-border bg-app-bg text-app-dim hover:text-app-text'
                              }`}
                            >
                              {item.pinned ? 'Unpin' : 'Pin'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(item.id);
                                setEditingTitle(item.title);
                              }}
                              className="rounded-lg border border-app-border bg-app-bg px-2 py-1 text-[10px] font-bold text-app-dim hover:text-app-text"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await maggi.loadSavedQueryIntoChat(item);
                                setTab('chat');
                              }}
                              className="rounded-lg border border-app-border bg-app-bg px-2 py-1 text-[10px] font-bold text-app-dim hover:text-app-text"
                            >
                              Open in Chat
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTab('chat');
                                void maggi.ask(item.query, true);
                              }}
                              disabled={!hasIndex}
                              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                            >
                              Re-run
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadMarkdown(item)}
                              className="rounded-lg border border-app-border bg-app-bg px-2 py-1 text-[10px] font-bold text-app-dim hover:text-app-text"
                            >
                              Export MD
                            </button>
                            {onSaveToSession && (
                              <button
                                type="button"
                                onClick={() => {
                                  const body = `Q: ${item.query}\n\n${item.answer}`;
                                  onSaveToSession(`MAGGI: ${item.title}`, body);
                                  showToast(`📥 Saved "${item.title}" to active workspace!`);
                                }}
                                className="rounded-lg border border-app-border bg-app-bg px-2 py-1 text-[10px] font-bold text-app-dim hover:text-emerald-400"
                              >
                                Save to Session
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void maggi.deleteSavedQuery(item.id)}
                              className="rounded-lg border border-app-border bg-app-bg px-2 py-1 text-[10px] font-bold text-app-dim hover:border-red-400/40 hover:text-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {/* Query */}
                        <div className="mt-2.5 rounded-lg border border-app-border/70 bg-app-bg/70 px-3 py-2 text-[11px] text-app-text">
                          <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">Query:</span>
                          {item.query}
                        </div>

                        {/* Answer */}
                        <div className={`mt-2 prose prose-sm prose-invert max-w-none text-xs leading-relaxed text-app-text/90 ${isExpanded ? '' : 'line-clamp-4'}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {item.answer}
                          </ReactMarkdown>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                            }
                            className="text-[10px] font-bold text-emerald-400 hover:underline"
                          >
                            {isExpanded ? 'Show less ▲' : 'Show full answer ▼'}
                          </button>

                          {item.retrieval?.docNames?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {item.retrieval.docNames.slice(0, 4).map((name, i) => (
                                <span key={i} className="rounded bg-app-bg px-1.5 py-0.5 text-[9px] text-app-dim">
                                  📄 {name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'defaults' && (
          <MaggiKeyDefaults
            settings={maggi.settings}
            onChange={maggi.updateSettings}
            onToast={showToast}
          />
        )}

        {tab === 'settings' && (
          <div className="h-full overflow-y-auto custom-scrollbar p-4">
            <div className="mx-auto max-w-2xl">
              {!maggi.isReady && <div className="mb-3 text-[10px] text-app-dim">Loading index…</div>}
              {workspaceName && (
                <div className="mb-3 rounded-lg border border-app-border bg-app-panel/50 px-3 py-2 text-[10px] text-app-dim">
                  Workspace in context: <span className="font-bold text-app-text">{workspaceName}</span>
                  {' · '}{workspaceItems.length} sources available to import
                </div>
              )}
              <MaggiSettingsPanel
                settings={maggi.settings}
                onChange={maggi.updateSettings}
                onReset={maggi.resetSettings}
                onOpenDefaults={() => setTab('defaults')}
              />
            </div>
          </div>
        )}
      </main>

      {/* ---------------- toast ---------------- */}
      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-xl border border-app-border bg-app-panel px-4 py-2 text-[11px] font-semibold text-app-text shadow-2xl">
          {toast}
        </div>
      )}

      {maggi.error && tab === 'chat' && (
        <div className="absolute bottom-24 left-1/2 z-[110] -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-300">
          {maggi.error}
        </div>
      )}
    </div>
  );
};

export default MaggiView;

