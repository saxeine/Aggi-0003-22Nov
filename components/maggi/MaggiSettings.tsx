import TestSubmission from '../TestSubmission';
import React, { useRef, useState } from 'react';
import { MaggiSettings as Settings, FreeLlmKeyEntry, PROVIDER_LABELS } from '../../maggi/config';
import { createBrain } from '../../services/maggi/brain';
import GeminiModelDrawer from '../GeminiModelDrawer';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onOpenDefaults?: () => void;
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block space-y-1.5">
    <span className="text-[11px] font-bold uppercase tracking-wider text-app-dim">{label}</span>
    {children}
    {hint && <span className="block text-[10px] leading-relaxed text-app-dim/80">{hint}</span>}
  </label>
);

const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={`w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-app-text outline-none focus:border-app-text/60 transition-colors placeholder:text-app-dim/60 ${props.className ?? ''}`}
  />
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex w-full items-start gap-3 rounded-lg border border-app-border bg-app-bg/50 p-3 text-left transition-colors hover:border-app-text/40"
  >
    <span className={`mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'bg-app-text' : 'bg-app-border'}`}>
      <span className={`block h-3 w-3 rounded-full bg-app-panel transition-transform ${checked ? 'translate-x-3' : ''}`} />
    </span>
    <span className="min-w-0">
      <span className="block text-xs font-semibold text-app-text">{label}</span>
      {hint && <span className="mt-0.5 block text-[10px] leading-relaxed text-app-dim">{hint}</span>}
    </span>
  </button>
);

const MAGGI_SETTINGS_SECTIONS = ['brain', 'retrieval', 'chunking', 'answer'] as const;
type Section = typeof MAGGI_SETTINGS_SECTIONS[number];

const SECTION_LABELS: Record<Section, string> = {
  brain: '🧠 Brain & Embeddings',
  retrieval: '🔎 Retrieval',
  chunking: '✂️ Chunking',
  answer: '💬 Answering',
};

const maskKey = (k: string): string => {
  const s = (k || '').trim();
  if (s.length <= 10) return '••••••••';
  return `${s.slice(0, 6)}••••${s.slice(-4)}`;
};

const parseFreeLlmKeysPayload = (rawText: string): FreeLlmKeyEntry[] => {
  const parsed = JSON.parse(rawText);
  const rawList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.keys) ? parsed.keys : []);
  if (!Array.isArray(rawList)) throw new Error('Expected a JSON object with a "keys" array.');
  const cleaned: FreeLlmKeyEntry[] = [];
  for (const item of rawList) {
    if (!item || typeof item.platform !== 'string' || typeof item.key !== 'string') continue;
    const platform = item.platform.trim().toLowerCase();
    const key = item.key.trim();
    if (!platform || !key) continue;
    cleaned.push({
      platform,
      key,
      ...(item.label ? { label: String(item.label).trim() } : {}),
      ...(item.baseUrl ? { baseUrl: String(item.baseUrl).replace(/\s+/g, '') } : {}),
      enabled: item.enabled !== false,
    });
  }
  if (!cleaned.length) throw new Error('No valid { platform, key } entries found in JSON.');
  return cleaned;
};

const KEYPOOL_TTS_SUGGESTIONS: Record<string, string[]> = {
  google: ['google:gemini-3.8-flash-tts', 'google:gemini-3.8-flash-lite-tts'],
  openai: ['openai:gpt-4o-mini-tts', 'openai:tts-1'],
  groq: ['groq:playai-tts', 'groq:canopylabs/orpheus-v1-english'],
  cloudflare: ['cloudflare:@cf/myshell-ai/melotts'],
  together: ['together:cartesia/sonic'],
};

const MaggiSettingsPanel: React.FC<Props> = ({ settings, onChange, onReset, onOpenDefaults }) => {
  const [section, setSection] = useState<Section>('brain');
  const [probe, setProbe] = useState<{ ok: boolean; detail: string; models?: string[]; voiceModels?: string[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const [showJsonPaste, setShowJsonPaste] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importStatus, setImportStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement>(null);

  const importKeysFromText = (rawText: string) => {
    try {
      const entries = parseFreeLlmKeysPayload(rawText);
      onChange({
        provider: 'freellmapi',
        freeLlmMode: 'keypool',
        freeLlmOverwriteDefaults: true,
        freeLlmKeys: entries,
      });
      const platforms = Array.from(new Set(entries.map((e) => e.platform))).join(', ');
      setImportStatus({ ok: true, text: `Imported ${entries.length} keys (${platforms}) — overwriting defaults. Click "Test connection" below.` });
      setJsonInput('');
      setShowJsonPaste(false);
      setProbe(null);
    } catch (err: any) {
      setImportStatus({ ok: false, text: err?.message || 'Failed to parse FreeLLMAPI keys JSON.' });
    }
  };

  const handleKeyFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    importKeysFromText(text);
  };

  const toggleKeyEnabled = (index: number) => {
    const next = (settings.freeLlmKeys || []).map((entry, idx) =>
      idx === index ? { ...entry, enabled: entry.enabled === false } : entry,
    );
    onChange({ freeLlmKeys: next });
  };

  const removeKeyEntry = (index: number) => {
    const next = (settings.freeLlmKeys || []).filter((_, idx) => idx !== index);
    onChange({ freeLlmKeys: next });
  };

  const runProbe = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const brain = createBrain(settings);
      setProbe(await brain.probe());
    } finally {
      setProbing(false);
    }
  };

  const keyPoolPlatformsForVoice = settings.freeLlmMode === 'keypool'
    ? (
      (settings.freeLlmKeys || []).length > 0
        ? (settings.freeLlmKeys || []).filter((k) => k.enabled !== false).map((k) => k.platform.toLowerCase())
        : ['google', 'groq', 'cloudflare']
    )
    : [];

  const suggestedVoiceModels = Array.from(
    new Set<string>([
      ...(probe?.voiceModels ?? []),
      ...(settings.freeLlmMode === 'keypool'
        ? keyPoolPlatformsForVoice.flatMap((plat) => KEYPOOL_TTS_SUGGESTIONS[plat] ?? [])
        : ['tts-1', 'gpt-4o-mini-tts', 'tts-1-hd']),
    ]),
  ).filter((m) => m && m !== 'auto');

  const assignNextVoiceInSequence = () => {
    if (!suggestedVoiceModels.length) return;
    const current = (settings.freeLlmVoiceModel || 'auto').trim();
    const currentIdx = suggestedVoiceModels.indexOf(current);
    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % suggestedVoiceModels.length : 0;
    onChange({ freeLlmVoiceModel: suggestedVoiceModels[nextIdx] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {MAGGI_SETTINGS_SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${section === s ? 'bg-app-text text-app-bg' : 'bg-app-bg text-app-dim hover:text-app-text border border-app-border'}`}
          >
            {SECTION_LABELS[s]}
          </button>
        ))}
        <button
          onClick={onReset}
          className="ml-auto rounded-lg border border-app-border px-3 py-1.5 text-[11px] font-bold text-app-dim hover:text-red-400 hover:border-red-400/40 transition-colors"
        >
          Reset defaults
        </button>
      </div>

      {section === 'brain' && (
        <div className="space-y-4">
          <Field label="Brain provider" hint="FreeLLMAPI pools ~80 free providers behind one OpenAI-compatible key and handles failover for you.">
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PROVIDER_LABELS) as Array<keyof typeof PROVIDER_LABELS>).map((p) => (
                <button
                  key={p}
                  onClick={() => onChange({ provider: p })}
                  className={`rounded-lg px-2 py-2 text-[11px] font-bold transition-colors ${settings.provider === p ? 'bg-app-text text-app-bg' : 'bg-app-bg border border-app-border text-app-dim hover:text-app-text'}`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </Field>

          {settings.provider === 'freellmapi' && (
            <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-bold text-emerald-400">FreeLLMAPI · Multi-Provider Router</div>
                <div className="flex rounded-lg border border-app-border bg-app-bg p-0.5 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => onChange({ freeLlmMode: 'keypool' })}
                    className={`rounded-md px-2 py-1 transition-colors ${settings.freeLlmMode === 'keypool' ? 'bg-emerald-500 text-black' : 'text-app-dim hover:text-app-text'}`}
                  >
                    Key Pool ({settings.freeLlmKeys?.length || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ freeLlmMode: 'url' })}
                    className={`rounded-md px-2 py-1 transition-colors ${settings.freeLlmMode !== 'keypool' ? 'bg-app-text text-app-bg' : 'text-app-dim hover:text-app-text'}`}
                  >
                    Proxy URL
                  </button>
                </div>
              </div>

              {settings.freeLlmMode === 'keypool' ? (
                <div className="space-y-2.5">
                  <p className="text-[10px] leading-relaxed text-app-dim">
                    Routes directly through your imported provider keys (OpenRouter, NVIDIA, Cloudflare, Zhipu, Google, Groq, custom) with automatic failover — no local proxy required.
                  </p>

                  <input
                    ref={keyFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleKeyFileUpload}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => keyFileInputRef.current?.click()}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-black hover:bg-emerald-400 transition-colors"
                    >
                      Import freellmapi-keys.json
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowJsonPaste((v) => !v)}
                      className="rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 text-[11px] font-semibold text-app-text hover:border-app-text/40 transition-colors"
                    >
                      {showJsonPaste ? 'Hide JSON paste' : 'Paste JSON'}
                    </button>
                    {onOpenDefaults && (
                      <button
                        type="button"
                        onClick={onOpenDefaults}
                        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                      >
                        🔑 Edit Defaults Page →
                      </button>
                    )}
                    {((settings.freeLlmKeys?.length || 0) > 0 || settings.freeLlmOverwriteDefaults) && (
                      <button
                        type="button"
                        onClick={() => {
                          onChange({ freeLlmKeys: [], freeLlmOverwriteDefaults: false });
                          setImportStatus(null);
                          setProbe(null);
                        }}
                        className="ml-auto rounded-lg border border-app-border px-2 py-1.5 text-[10px] font-bold text-app-dim hover:text-amber-300 hover:border-amber-400/40"
                      >
                        Restore env defaults
                      </button>
                    )}
                  </div>

                  {showJsonPaste && (
                    <div className="space-y-1.5">
                      <textarea
                        rows={4}
                        value={jsonInput}
                        onChange={(e) => setJsonInput(e.target.value)}
                        placeholder={'Paste freellmapi-keys.json contents: {"version":1,"keys":[...]}'}
                        className="w-full rounded-lg border border-app-border bg-app-bg p-2 font-mono text-[10px] text-app-text outline-none focus:border-emerald-500/60"
                      />
                      <button
                        type="button"
                        onClick={() => importKeysFromText(jsonInput)}
                        disabled={!jsonInput.trim()}
                        className="rounded-lg bg-app-text px-2.5 py-1 text-[10px] font-bold text-app-bg disabled:opacity-40"
                      >
                        Load Keys JSON
                      </button>
                    </div>
                  )}

                  {importStatus && (
                    <div className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold ${importStatus.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
                      {importStatus.text}
                    </div>
                  )}

                  {(settings.freeLlmKeys?.length || 0) > 0 && (
                    <div className="max-h-36 space-y-1 overflow-y-auto custom-scrollbar rounded-lg border border-app-border bg-app-bg/70 p-2">
                      {settings.freeLlmKeys.map((entry, idx) => (
                        <div key={`${entry.platform}-${idx}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-app-panel">
                          <input
                            type="checkbox"
                            checked={entry.enabled !== false}
                            onChange={() => toggleKeyEnabled(idx)}
                            className="accent-emerald-500"
                            title="Enable/disable this key"
                          />
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono font-bold uppercase text-emerald-300">
                            {entry.platform}
                          </span>
                          <span className="truncate font-mono text-app-dim">{maskKey(entry.key)}</span>
                          {(entry.label || entry.baseUrl) && (
                            <span className="truncate text-app-dim/70">{entry.label || entry.baseUrl}</span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeKeyEntry(idx)}
                            className="ml-auto text-app-dim hover:text-red-400"
                            title="Remove key"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <Field label="Model / routing" hint={'Use "auto", "auto:fast", "auto:smart", or click a model after Test connection (e.g. nvidia:meta/llama-3.3-70b-instruct).'}>
                    <TextInput
                      value={settings.freeLlmApiModel}
                      onChange={(e) => onChange({ freeLlmApiModel: e.target.value.trim() })}
                      placeholder="auto"
                    />
                  </Field>

                  <Field
                    label="Podcast Voice / TTS Model"
                    hint={'Used to synthesize podcast audio when AI Engine is MAGGI. Leave "auto" or assign a specific model; if synthesis fails, FreeLLMAPI automatically steps to the next available TTS in sequence.'}
                  >
                    <div className="flex gap-1.5">
                      <TextInput
                        value={settings.freeLlmVoiceModel ?? 'auto'}
                        onChange={(e) => onChange({ freeLlmVoiceModel: e.target.value.trim() })}
                        placeholder="auto"
                      />
                      {suggestedVoiceModels.length > 0 && (
                        <button
                          type="button"
                          onClick={assignNextVoiceInSequence}
                          className="shrink-0 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                          title="Assign the next available TTS model in sequence"
                        >
                          Assign next TTS
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {['auto', ...suggestedVoiceModels.slice(0, 8)].map((vm) => {
                        const active = (settings.freeLlmVoiceModel || 'auto') === vm;
                        return (
                          <button
                            key={vm}
                            type="button"
                            onClick={() => onChange({ freeLlmVoiceModel: vm })}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${active ? 'bg-emerald-500 text-black font-bold' : 'bg-app-bg border border-app-border text-app-dim hover:text-app-text'}`}
                            title="Assign voice model for podcast generation"
                          >
                            {vm}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="Base URL" hint="Self-hosted default is http://localhost:3001/v1 (or http://127.0.0.1:31415/v1).">
                    <TextInput
                      value={settings.freeLlmApiBaseUrl}
                      onChange={(e) => onChange({ freeLlmApiBaseUrl: e.target.value.replace(/\s+/g, '') })}
                      placeholder="http://127.0.0.1:31415/v1"
                    />
                  </Field>
                  <Field label="Unified API key" hint="The freellmapi-… key from the FreeLLMAPI Keys page. Sent only to your own /api/maggi proxy.">
                    <TextInput
                      type="password"
                      value={settings.freeLlmApiKey}
                      onChange={(e) => onChange({ freeLlmApiKey: e.target.value.trim() })}
                      placeholder="freellmapi-••••••••"
                    />
                  </Field>
                  <Field label="Model" hint={'“auto” lets the router pick. Try auto:fast, auto:smart, or a concrete model id.'}>
                    <TextInput
                      value={settings.freeLlmApiModel}
                      onChange={(e) => onChange({ freeLlmApiModel: e.target.value.trim() })}
                      placeholder="auto"
                    />
                  </Field>
                  <Field
                    label="Podcast Voice / TTS Model"
                    hint={'Assigned TTS voice model for Podcast audio via /audio/speech (or "auto" to route sequentially through available voice models).'}
                  >
                    <div className="flex gap-1.5">
                      <TextInput
                        value={settings.freeLlmVoiceModel ?? 'auto'}
                        onChange={(e) => onChange({ freeLlmVoiceModel: e.target.value.trim() })}
                        placeholder="auto"
                      />
                      {suggestedVoiceModels.length > 0 && (
                        <button
                          type="button"
                          onClick={assignNextVoiceInSequence}
                          className="shrink-0 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                          title="Assign the next available TTS model in sequence"
                        >
                          Assign next TTS
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {['auto', ...suggestedVoiceModels.slice(0, 8)].map((vm) => {
                        const active = (settings.freeLlmVoiceModel || 'auto') === vm;
                        return (
                          <button
                            key={vm}
                            type="button"
                            onClick={() => onChange({ freeLlmVoiceModel: vm })}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${active ? 'bg-emerald-500 text-black font-bold' : 'bg-app-bg border border-app-border text-app-dim hover:text-app-text'}`}
                            title="Assign voice model for podcast generation"
                          >
                            {vm}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <button
                    type="button"
                    onClick={() => onChange({ freeLlmMode: 'keypool' })}
                    className="text-[10px] font-semibold text-emerald-400 underline hover:text-emerald-300"
                  >
                    Have a freellmapi-keys.json export? Switch to Key Pool to import keys directly →
                  </button>
                </>
              )}
            </div>
          )}

          {settings.provider === 'openai-compatible' && (
            <div className="space-y-3">
              <Field label="Base URL"><TextInput value={settings.openAiBaseUrl} onChange={(e) => onChange({ openAiBaseUrl: e.target.value.replace(/\s+/g, '') })} placeholder="https://api.openai.com/v1" /></Field>
              <Field label="API key"><TextInput type="password" value={settings.openAiApiKey} onChange={(e) => onChange({ openAiApiKey: e.target.value.trim() })} /></Field>
              <Field label="Model"><TextInput value={settings.openAiModel} onChange={(e) => onChange({ openAiModel: e.target.value.trim() })} /></Field>
            </div>
          )}

          {settings.provider === 'ollama' && (
            <div className="space-y-3">
              <Field
                label="Ollama URL"
                hint="For HTTPS preview, run: cloudflared tunnel --url http://localhost:11434 and paste the https://....trycloudflare.com URL here."
              >
                <TextInput
                  value={settings.ollamaBaseUrl}
                  onChange={(e) => onChange({ ollamaBaseUrl: e.target.value.replace(/\s+/g, '') })}
                  placeholder="https://your-tunnel.trycloudflare.com"
                />
              </Field>
              <Field label="Model"><TextInput value={settings.ollamaModel} onChange={(e) => onChange({ ollamaModel: e.target.value.trim() })} /></Field>
            </div>
          )}

          {settings.provider === 'gemini' && (
            <div className="space-y-2">
              <GeminiModelDrawer
                compact
                label="Gemini model"
                value={settings.geminiModel}
                onChange={(geminiModel) => onChange({ geminiModel })}
              />
              <p className="text-[10px] leading-relaxed text-app-dim/80">
                Uses the server&apos;s GEMINI_API_KEY automatically.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runProbe}
              disabled={probing}
              className="shrink-0 rounded-lg bg-app-text px-3 py-2 text-[11px] font-bold text-app-bg disabled:opacity-50"
            >
              {probing ? 'Probing…' : 'Test connection'}
            </button>
            {probe && (
              <span className={`text-[11px] font-semibold break-words ${probe.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                {probe.ok ? '✓ ' : '⚠ '}{probe.detail}
              </span>
            )}
          </div>
          <TestSubmission config={{ provider: 'maggi', settings }} />
          {probe?.voiceModels?.length ? (
            <div className="max-h-24 overflow-y-auto custom-scrollbar rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
              <div className="mb-1 text-[10px] font-bold uppercase text-emerald-400">
                {probe.voiceModels.length} voice / TTS models (click to assign for podcasts)
              </div>
              <div className="flex flex-wrap gap-1">
                {probe.voiceModels.slice(0, 30).map((vm) => (
                  <button
                    key={vm}
                    type="button"
                    onClick={() => onChange({ freeLlmVoiceModel: vm })}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${(settings.freeLlmVoiceModel || 'auto') === vm ? 'bg-emerald-500 text-black font-bold' : 'bg-app-panel text-emerald-300 hover:bg-emerald-500/20'}`}
                    title="Assign this voice model for podcast generation"
                  >
                    {vm}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {probe?.models?.length ? (
            <div className="max-h-28 overflow-y-auto custom-scrollbar rounded-lg border border-app-border bg-app-bg p-2">
              <div className="mb-1 text-[10px] font-bold uppercase text-app-dim">{probe.models.length} models</div>
              <div className="flex flex-wrap gap-1">
                {probe.models.slice(0, 40).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      if (settings.provider === 'ollama') onChange({ ollamaModel: m });
                      else if (settings.provider === 'openai-compatible') onChange({ openAiModel: m });
                      else onChange({ freeLlmApiModel: m });
                    }}
                    className="rounded bg-app-panel px-1.5 py-0.5 text-[10px] text-app-dim hover:text-app-text"
                    title="Use this model"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <Field label="Embedding backend" hint="“auto” tries Gemini embeddings then silently falls back to the built-in offline hash embedder — RAG never breaks.">
            <select
              value={settings.embeddingBackend}
              onChange={(e) => onChange({ embeddingBackend: e.target.value as Settings['embeddingBackend'] })}
              className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-app-text outline-none"
            >
              <option value="auto">Auto (best available)</option>
              <option value="gemini">Gemini text-embedding-004</option>
              <option value="hash">Local hash embedder (offline)</option>
            </select>
          </Field>
        </div>
      )}

      {section === 'retrieval' && (
        <div className="space-y-3">
          <Field label="Mode">
            <select
              value={settings.retrievalMode}
              onChange={(e) => onChange({ retrievalMode: e.target.value as Settings['retrievalMode'] })}
              className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-app-text outline-none"
            >
              <option value="hybrid">Hybrid (BM25 + vectors) — recommended</option>
              <option value="vector">Dense vectors only</option>
              <option value="keyword">BM25 keywords only</option>
            </select>
          </Field>

          <Field label={`Passages to the model: ${settings.topK}`} hint="More passages = more recall but more tokens. 6–10 is the sweet spot.">
            <input type="range" min={2} max={20} value={settings.topK} onChange={(e) => onChange({ topK: Number(e.target.value) })} className="w-full accent-current" />
          </Field>

          <Field label={`Candidate pool: ${settings.candidateK}`} hint="How many chunks each retrieval leg pulls before fusion and re-ranking.">
            <input type="range" min={10} max={120} step={5} value={settings.candidateK} onChange={(e) => onChange({ candidateK: Number(e.target.value) })} className="w-full accent-current" />
          </Field>

          <Field label={`Vector weight: ${Math.round(settings.vectorWeight * 100)}%`} hint="Higher favours semantic matches; lower favours exact keyword/entity matches.">
            <input type="range" min={0} max={100} value={Math.round(settings.vectorWeight * 100)} onChange={(e) => onChange({ vectorWeight: Number(e.target.value) / 100 })} className="w-full accent-current" />
          </Field>

          <div className="grid grid-cols-1 gap-2">
            <Toggle
              checked={settings.diversify}
              onChange={(v) => onChange({ diversify: v })}
              label="MMR diversification"
              hint="Picks passages that add new information instead of near-duplicates."
            />
            <Toggle
              checked={settings.rerank}
              onChange={(v) => onChange({ rerank: v })}
              label="LLM re-ranking"
              hint="One extra cheap call to reorder candidates by true relevance. Slower, sharper."
            />
            <Toggle
              checked={settings.multiQuery}
              onChange={(v) => onChange({ multiQuery: v })}
              label="Multi-query expansion"
              hint="Rewrites the question into 2 paraphrases and fuses the results."
            />
            <Toggle
              checked={settings.useHyde}
              onChange={(v) => onChange({ useHyde: v })}
              label="HyDE (hypothetical document)"
              hint="Drafts an answer first, then searches with it. Great for vague questions."
            />
          </div>
        </div>
      )}

      {section === 'chunking' && (
        <div className="space-y-3">
          <Field label="Strategy">
            <select
              value={settings.chunkStrategy}
              onChange={(e) => onChange({ chunkStrategy: e.target.value as Settings['chunkStrategy'] })}
              className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-app-text outline-none"
            >
              <option value="recursive">Recursive + heading breadcrumbs — recommended</option>
              <option value="markdown">Markdown headings</option>
              <option value="sentence">Sentence windows</option>
              <option value="fixed">Fixed size</option>
            </select>
          </Field>
          <Field label={`Chunk size: ${settings.chunkSize} chars`} hint="≈300 tokens. Smaller = precise citations, larger = more context per passage.">
            <input type="range" min={400} max={3000} step={100} value={settings.chunkSize} onChange={(e) => onChange({ chunkSize: Number(e.target.value) })} className="w-full accent-current" />
          </Field>
          <Field label={`Overlap: ${settings.chunkOverlap} chars`} hint="Keeps facts that straddle a boundary retrievable.">
            <input type="range" min={0} max={500} step={20} value={settings.chunkOverlap} onChange={(e) => onChange({ chunkOverlap: Number(e.target.value) })} className="w-full accent-current" />
          </Field>
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-amber-300/90">
            Changing chunking only affects <strong>newly ingested</strong> documents. Use “Re-index all” in the Sources tab to apply it to everything.
          </p>
        </div>
      )}

      {section === 'answer' && (
        <div className="space-y-3">
          <Field label="Grounding">
            <select
              value={settings.groundingMode}
              onChange={(e) => onChange({ groundingMode: e.target.value as Settings['groundingMode'] })}
              className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-app-text outline-none"
            >
              <option value="strict">Strict — refuse if not in sources</option>
              <option value="balanced">Balanced — allows flagged world knowledge</option>
            </select>
          </Field>
          <Field label={`Temperature: ${settings.temperature.toFixed(2)}`}>
            <input type="range" min={0} max={100} value={settings.temperature * 100} onChange={(e) => onChange({ temperature: Number(e.target.value) / 100 })} className="w-full accent-current" />
          </Field>
          <Field label={`Max context: ${Math.round(settings.maxContextChars / 1000)}k chars`}>
            <input type="range" min={4000} max={80000} step={2000} value={settings.maxContextChars} onChange={(e) => onChange({ maxContextChars: Number(e.target.value) })} className="w-full accent-current" />
          </Field>
          <Field label="Answer language" hint="“auto” mirrors the question.">
            <TextInput value={settings.answerLanguage} onChange={(e) => onChange({ answerLanguage: e.target.value })} placeholder="auto" />
          </Field>
          <p className="rounded-lg border border-app-border bg-app-bg/60 p-2.5 text-[10px] leading-relaxed text-app-dim">
            Model: {settings.provider === 'freellmapi' ? settings.freeLlmApiModel : settings.provider === 'gemini' ? settings.geminiModel : settings.provider === 'ollama' ? settings.ollamaModel : settings.openAiModel}
            {' · '}defaults come from the app's existing Gemini setup.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-app-border bg-app-bg/40 p-2.5 text-[10px] leading-relaxed text-app-dim">
        <strong className="text-app-text">Tip:</strong> FreeLLMAPI runs locally (<code className="text-app-text">npx freellmapi</code> → :3001). Point MAGGI at <code className="text-app-text">http://localhost:3001/v1</code> and every answer is free. Or set <code className="text-app-text">FREELLMAPI_BASE_URL</code> / <code className="text-app-text">FREELLMAPI_API_KEY</code> in the server env to keep keys off the browser entirely.
      </div>
    </div>
  );
};

export default MaggiSettingsPanel;
