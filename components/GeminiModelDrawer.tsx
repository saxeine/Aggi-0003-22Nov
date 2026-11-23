import React, { useMemo, useState } from 'react';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  GeminiModelOption,
  findGeminiModelOption,
  isPaidGeminiModel,
  normalizeGeminiModelId,
} from '../constants/geminiModels';

interface GeminiModelDrawerProps {
  value?: string;
  onChange: (modelId: string) => void;
  label?: string;
  compact?: boolean;
}

type TierFilter = 'all' | 'fast' | 'pro';

const TIER_BADGE: Record<GeminiModelOption['tier'], { label: string; cls: string }> = {
  fast: { label: 'Fast', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  lite: { label: 'Ultra Fast', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  pro: { label: 'Pro · Paid Key', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  deep: { label: 'Deep Reasoning · Paid Key', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  preview: { label: 'Preview', cls: 'bg-app-card text-app-muted border-app-border' },
};

const GeminiModelDrawer: React.FC<GeminiModelDrawerProps> = ({
  value,
  onChange,
  label = 'Gemini Model',
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<TierFilter>('all');
  const [customId, setCustomId] = useState('');

  const activeId = normalizeGeminiModelId(value || DEFAULT_GEMINI_MODEL);
  const activeOption = useMemo(() => findGeminiModelOption(activeId), [activeId]);
  const isCustomModel = !activeOption;

  const filteredModels = useMemo(() => {
    if (filter === 'all') return GEMINI_MODELS;
    if (filter === 'fast') return GEMINI_MODELS.filter((m) => m.tier === 'fast' || m.tier === 'lite');
    return GEMINI_MODELS.filter((m) => m.tier === 'pro' || m.tier === 'deep' || m.tier === 'preview');
  }, [filter]);

  const activeBadge = activeOption ? TIER_BADGE[activeOption.tier] : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-app-dim">{label}</span>
        <span className="text-[10px] font-mono text-app-dim">{GEMINI_MODELS.length} latest models</span>
      </div>

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between gap-3 rounded-xl border text-left transition-all ${
          isOpen
            ? 'border-app-text bg-app-bg shadow-lg'
            : 'border-app-border bg-app-bg/70 hover:border-app-text/50'
        } ${compact ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-app-text truncate">
              {activeOption ? activeOption.name : activeId}
            </span>
            {activeBadge && (
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${activeBadge.cls}`}>
                {activeOption?.id === DEFAULT_GEMINI_MODEL ? `${activeBadge.label} · Default` : activeBadge.label}
              </span>
            )}
            {isCustomModel && (
              <span className="rounded border border-app-border bg-app-card px-1.5 py-0.5 text-[9px] font-bold uppercase text-app-dim">
                Custom ID
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <code className="text-[10px] font-mono text-app-dim">{activeId}</code>
            {activeOption && !compact && (
              <span className="truncate text-[10px] text-app-dim/80">· {activeOption.description}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-semibold text-app-dim">{isOpen ? 'Close' : 'Select'}</span>
          <svg
            className={`h-4 w-4 text-app-text transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isPaidGeminiModel(activeId) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] leading-relaxed text-amber-300">
          <strong>Paid API Key Model:</strong> <code className="font-mono">{activeId}</code> requires a billing-enabled Gemini API key configured in <strong>Settings &gt; Secrets</strong>.
        </div>
      )}

      {/* Selection Drawer */}
      {isOpen && (
        <div className="rounded-xl border border-app-border bg-app-bg p-3 shadow-2xl space-y-3 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border/70 pb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-app-dim">
              Gemini Model Selection Drawer
            </span>
            <div className="flex rounded-lg border border-app-border bg-app-panel p-0.5 text-[10px] font-bold">
              {(
                [
                  ['all', 'All'],
                  ['fast', 'Fast / Flash'],
                  ['pro', 'Pro / Deep'],
                ] as Array<[TierFilter, string]>
              ).map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-md px-2 py-1 transition-colors ${
                    filter === key ? 'bg-app-text text-app-bg' : 'text-app-dim hover:text-app-text'
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-64 space-y-1.5 overflow-y-auto custom-scrollbar pr-1">
            {filteredModels.map((model) => {
              const selected = activeId === model.id;
              const badge = TIER_BADGE[model.tier];
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.id);
                    setIsOpen(false);
                  }}
                  className={`w-full rounded-lg border p-2.5 text-left transition-all ${
                    selected
                      ? 'border-app-text bg-app-text/10 shadow-sm'
                      : 'border-app-border/70 bg-app-panel/40 hover:border-app-text/40 hover:bg-app-panel/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-app-text">{model.name}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${badge.cls}`}>
                          {model.id === DEFAULT_GEMINI_MODEL ? `${badge.label} · Default` : badge.label}
                        </span>
                        {model.recommended && (
                          <span className="rounded bg-app-text/15 px-1.5 py-0.5 text-[9px] font-bold text-app-text">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-app-dim">{model.description}</p>
                      <code className="mt-1 inline-block text-[9px] font-mono text-app-dim/90">{model.id}</code>
                    </div>
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected ? 'border-app-text bg-app-text text-app-bg' : 'border-app-border'
                      }`}
                    >
                      {selected && (
                        <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom / Preview Model ID Input */}
          <div className="border-t border-app-border/70 pt-2.5 space-y-1.5">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-app-dim">
              Or enter an exact Gemini model ID
            </span>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customId.trim()) {
                    e.preventDefault();
                    onChange(customId.trim());
                    setCustomId('');
                    setIsOpen(false);
                  }
                }}
                placeholder="e.g. gemini-2.5-flash-preview-12-2025"
                className="flex-1 rounded-lg border border-app-border bg-app-input px-2.5 py-1.5 font-mono text-[11px] text-app-text outline-none focus:border-app-text"
              />
              <button
                type="button"
                disabled={!customId.trim()}
                onClick={() => {
                  if (!customId.trim()) return;
                  onChange(customId.trim());
                  setCustomId('');
                  setIsOpen(false);
                }}
                className="rounded-lg bg-app-text px-3 py-1.5 text-[10px] font-bold text-app-bg disabled:opacity-40"
              >
                Use ID
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GeminiModelDrawer;
