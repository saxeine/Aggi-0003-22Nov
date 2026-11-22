import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_KEY_POOL_PROVIDERS,
  FreeLlmKeyEntry,
  MaggiSettings,
} from '../../maggi/config';
import {
  createBrain,
  fetchMaggiEnvDefaults,
  MaskedEnvDefaultEntry,
} from '../../services/maggi/brain';

interface MaggiKeyDefaultsProps {
  settings: MaggiSettings;
  onChange: (patch: Partial<MaggiSettings>) => void;
  onToast?: (msg: string) => void;
}

const SUPPORTED_PLATFORMS = [
  'cloudflare',
  'custom',
  'google',
  'groq',
  'nvidia',
  'openrouter',
  'zhipu',
  'openai',
  'cerebras',
  'together',
  'sambanova',
  'mistral',
  'deepseek',
];

const PLATFORM_BASE_HINTS: Record<string, string> = {
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1 (use key as ACCOUNT_ID:TOKEN)',
  custom: 'https://integrate.api.nvidia.com/v1 or https://api.inferbase.ai/api/v1/inference',
  google: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com/openai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  openai: 'https://api.openai.com/v1',
};

interface EditableRow extends FreeLlmKeyEntry {
  rowId: string;
  maskedEnvKey?: string;
  isEnvBacked?: boolean;
}

const makeRowId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const slotKey = (platform: string, baseUrl?: string) =>
  `${(platform || '').trim().toLowerCase()}::${(baseUrl || '').replace(/\s+/g, '').replace(/\/+$/, '').toLowerCase()}`;

export const parseUploadedKeyPoolJson = (rawText: string): FreeLlmKeyEntry[] => {
  const parsed = JSON.parse(rawText);
  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.keys)
      ? parsed.keys
      : [];
  if (!Array.isArray(rawList)) {
    throw new Error('Expected a JSON object with a "keys" array (or a JSON array).');
  }
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
  if (!cleaned.length) {
    throw new Error('No valid { platform, key } entries found in JSON.');
  }
  return cleaned;
};

const buildInitialRows = (
  settings: MaggiSettings,
  envEntries: MaskedEnvDefaultEntry[],
): EditableRow[] => {
  const localKeys = settings.freeLlmKeys || [];
  if (settings.freeLlmOverwriteDefaults && localKeys.length > 0) {
    return localKeys.map((entry) => ({
      ...entry,
      rowId: makeRowId(),
      isEnvBacked: false,
    }));
  }

  const rows: EditableRow[] = [];
  const usedSlots = new Set<string>();

  const envMap = new Map<string, MaskedEnvDefaultEntry>();
  for (const envEntry of envEntries) {
    envMap.set(slotKey(envEntry.platform, envEntry.baseUrl), envEntry);
  }

  // First include any custom / local entries already saved
  for (const local of localKeys) {
    const sk = slotKey(local.platform, local.baseUrl);
    const matchingEnv = envMap.get(sk);
    usedSlots.add(sk);
    rows.push({
      ...local,
      rowId: makeRowId(),
      isEnvBacked: !!matchingEnv && !(local.key && local.key.trim()),
      maskedEnvKey: matchingEnv?.maskedKey,
    });
  }

  // Next include any server env entries not yet represented locally
  for (const envEntry of envEntries) {
    const sk = slotKey(envEntry.platform, envEntry.baseUrl);
    if (usedSlots.has(sk)) continue;
    usedSlots.add(sk);
    rows.push({
      platform: envEntry.platform,
      key: '',
      label: envEntry.label || '',
      baseUrl: envEntry.baseUrl || '',
      enabled: envEntry.enabled,
      rowId: makeRowId(),
      isEnvBacked: envEntry.hasKey,
      maskedEnvKey: envEntry.maskedKey,
    });
  }

  // Ensure the 9 default provider template slots are visible for manual editing
  for (const tpl of DEFAULT_KEY_POOL_PROVIDERS) {
    const sk = slotKey(tpl.platform, tpl.baseUrl);
    if (usedSlots.has(sk)) continue;
    usedSlots.add(sk);
    rows.push({
      ...tpl,
      rowId: makeRowId(),
      isEnvBacked: false,
    });
  }

  return rows;
};

const MaggiKeyDefaults: React.FC<MaggiKeyDefaultsProps> = ({
  settings,
  onChange,
  onToast,
}) => {
  const [envDefaults, setEnvDefaults] = useState<MaskedEnvDefaultEntry[]>([]);
  const [hasEnvPool, setHasEnvPool] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(true);
  const [rows, setRows] = useState<EditableRow[]>(() => buildInitialRows(settings, []));
  const [dirty, setDirty] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    detail: string;
    providerResults?: Array<{ platform: string; ok: boolean; error?: string }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEnv(true);
    fetchMaggiEnvDefaults()
      .then((data) => {
        if (cancelled) return;
        setHasEnvPool(data.hasEnvPool);
        setEnvDefaults(data.entries);
        setRows((prev) => (dirty ? prev : buildInitialRows(settings, data.entries)));
      })
      .finally(() => {
        if (!cancelled) setLoadingEnv(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.freeLlmKeys, settings.freeLlmOverwriteDefaults, dirty]);

  const activeCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.enabled !== false &&
          ((r.key && r.key.trim().length > 0) || (r.isEnvBacked && !settings.freeLlmOverwriteDefaults)),
      ).length,
    [rows, settings.freeLlmOverwriteDefaults],
  );

  const notify = (ok: boolean, text: string) => {
    setStatusMsg({ ok, text });
    onToast?.(text);
  };

  const commitRows = (nextRows: EditableRow[], overwriteDefaults: boolean, label: string) => {
    const cleaned: FreeLlmKeyEntry[] = [];
    for (const r of nextRows) {
      const platform = (r.platform || '').trim().toLowerCase();
      if (!platform) continue;
      const key = (r.key || '').trim();
      const baseUrl = (r.baseUrl || '').replace(/\s+/g, '');
      // Keep rows that either have a key, are custom-configured, or disable a server env slot
      if (overwriteDefaults && !key) continue;
      if (!overwriteDefaults && !key && !r.isEnvBacked) continue;
      cleaned.push({
        platform,
        key,
        ...(r.label?.trim() ? { label: r.label.trim() } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        enabled: r.enabled !== false,
      });
    }

    onChange({
      provider: 'freellmapi',
      freeLlmMode: 'keypool',
      freeLlmOverwriteDefaults: overwriteDefaults,
      freeLlmKeys: cleaned,
    });
    setDirty(false);
    notify(true, label);
  };

  const applyUploadedJson = (rawText: string) => {
    try {
      const imported = parseUploadedKeyPoolJson(rawText);
      const nextRows: EditableRow[] = imported.map((entry) => ({
        ...entry,
        rowId: makeRowId(),
        isEnvBacked: false,
      }));
      setRows(nextRows);
      commitRows(
        nextRows,
        true,
        `Uploaded ${imported.length} provider keys — active defaults overwritten.`,
      );
      setPasteText('');
      setShowPaste(false);
      setProbeResult(null);
    } catch (err: any) {
      notify(false, err?.message || 'Failed to parse JSON keys.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    applyUploadedJson(text);
  };

  const handleExportJson = () => {
    const exportKeys: FreeLlmKeyEntry[] = rows
      .filter((r) => r.platform.trim() && r.key.trim())
      .map((r) => ({
        platform: r.platform.trim().toLowerCase(),
        key: r.key.trim(),
        label: r.label?.trim() || '',
        ...(r.baseUrl?.trim() ? { baseUrl: r.baseUrl.replace(/\s+/g, '') } : {}),
        ...(r.enabled === false ? { enabled: false } : {}),
      }));

    if (!exportKeys.length) {
      notify(
        false,
        'No editable keys entered in this browser to export (server-env keys stay hidden on the server).',
      );
      return;
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      source: 'freellmapi',
      keys: exportKeys,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'freellmapi-keys.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify(true, `Exported ${exportKeys.length} keys to freellmapi-keys.json.`);
  };

  const handleRestoreDefaults = () => {
    setDirty(false);
    setProbeResult(null);
    onChange({
      provider: 'freellmapi',
      freeLlmMode: 'keypool',
      freeLlmOverwriteDefaults: false,
      freeLlmKeys: [],
    });
    setRows(buildInitialRows({ ...settings, freeLlmKeys: [], freeLlmOverwriteDefaults: false }, envDefaults));
    notify(
      true,
      hasEnvPool
        ? 'Restored server FREELLMAPI_KEYS_JSON defaults.'
        : 'Cleared manual overrides and restored the 9 default provider slots.',
    );
  };

  const handleTestAll = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const stagedKeys: FreeLlmKeyEntry[] = rows
        .filter((r) => r.platform.trim() && (r.key.trim() || r.enabled === false))
        .map((r) => ({
          platform: r.platform.trim().toLowerCase(),
          key: r.key.trim(),
          ...(r.label?.trim() ? { label: r.label.trim() } : {}),
          ...(r.baseUrl?.trim() ? { baseUrl: r.baseUrl.replace(/\s+/g, '') } : {}),
          enabled: r.enabled !== false,
        }));
      const brain = createBrain({
        ...settings,
        provider: 'freellmapi',
        freeLlmMode: 'keypool',
        freeLlmKeys: stagedKeys,
      });
      const res = await brain.probe();
      setProbeResult({
        ok: res.ok,
        detail: res.detail,
        providerResults: res.providerResults,
      });
    } finally {
      setProbing(false);
    }
  };

  const updateRow = (rowId: string, patch: Partial<EditableRow>) => {
    setDirty(true);
    setRows((prev) =>
      prev.map((r) =>
        r.rowId === rowId
          ? {
              ...r,
              ...patch,
              ...(typeof patch.key === 'string' && patch.key.trim() ? { isEnvBacked: false } : {}),
            }
          : r,
      ),
    );
  };

  const moveRow = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= rows.length) return;
    setDirty(true);
    setRows((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const removeRow = (rowId: string) => {
    setDirty(true);
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const addRow = () => {
    setDirty(true);
    setRows((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        platform: 'custom',
        key: '',
        label: '',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
        isEnvBacked: false,
      },
    ]);
  };

  const probeStatusForPlatform = (platform: string) =>
    probeResult?.providerResults?.find((p) => p.platform === platform.trim().toLowerCase());

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header Card */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-black text-app-text">
                  MAGGI Default Providers &amp; Key Pool
                </h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    settings.freeLlmOverwriteDefaults
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : hasEnvPool
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-app-panel text-app-dim border border-app-border'
                  }`}
                >
                  {settings.freeLlmOverwriteDefaults
                    ? 'Overwritten by uploaded / manual keys'
                    : hasEnvPool
                      ? `Auto-loaded from server defaults (${envDefaults.length})`
                      : `${activeCount} active providers`}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-app-dim">
                MAGGI loads in Key Pool mode by default across Cloudflare, Custom endpoints (NVIDIA NIM, Aihubmix, Inferbase), Google, Groq, NVIDIA, OpenRouter, and Zhipu. Edit any row manually below, or upload a new <code className="text-app-text">freellmapi-keys.json</code> to overwrite the defaults.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition-colors"
              >
                Upload New Keys (Overwrite)
              </button>
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                className="rounded-lg border border-app-border bg-app-panel px-3 py-1.5 text-xs font-semibold text-app-text hover:border-app-text/40 transition-colors"
              >
                {showPaste ? 'Hide JSON Paste' : 'Paste JSON'}
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="rounded-lg border border-app-border bg-app-panel px-3 py-1.5 text-xs font-semibold text-app-text hover:border-app-text/40 transition-colors"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={handleRestoreDefaults}
                className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-dim hover:text-amber-300 hover:border-amber-400/40 transition-colors"
              >
                Restore Defaults
              </button>
            </div>
          </div>

          {!loadingEnv && !hasEnvPool && activeCount === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              <strong className="text-amber-100">No keys active yet:</strong> Paste or upload your <code className="text-white">freellmapi-keys.json</code> above (or set <code className="text-white">FREELLMAPI_KEYS_JSON</code> in server Secrets) to activate the default pool, or type keys directly into the provider rows below.
            </div>
          )}

          {showPaste && (
            <div className="space-y-2 rounded-xl border border-app-border bg-app-bg p-3">
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'Paste freellmapi-keys.json contents: {"version":1,"keys":[{"platform":"groq","key":"..."}]}'}
                className="w-full rounded-lg border border-app-border bg-app-panel p-2.5 font-mono text-[11px] text-app-text outline-none focus:border-emerald-500/60"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!pasteText.trim()}
                  onClick={() => applyUploadedJson(pasteText)}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40"
                >
                  Overwrite Defaults with JSON
                </button>
                <span className="text-[10px] text-app-dim">
                  Replaces current key pool overrides and activates Key Pool mode.
                </span>
              </div>
            </div>
          )}

          {statusMsg && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                statusMsg.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border bg-app-panel px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-bold text-app-text hover:border-emerald-400/50 transition-colors"
            >
              + Add Provider
            </button>
            <button
              type="button"
              onClick={handleTestAll}
              disabled={probing}
              className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-bold text-app-text hover:border-app-text/50 disabled:opacity-50 transition-colors"
            >
              {probing ? 'Testing Pool…' : 'Test Active Pool'}
            </button>
            {probeResult && (
              <span className={`text-xs font-semibold ${probeResult.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                {probeResult.ok ? '✓ ' : '⚠ '}{probeResult.detail}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-[11px] font-semibold text-amber-400">
                Unsaved edits
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                commitRows(
                  rows,
                  settings.freeLlmOverwriteDefaults,
                  'Saved manual provider changes.',
                )
              }
              className="rounded-lg bg-app-text px-3 py-1.5 text-xs font-bold text-app-bg hover:opacity-90 transition-opacity"
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={() =>
                commitRows(
                  rows,
                  true,
                  'Saved manual list and set as overwriting defaults.',
                )
              }
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 transition-colors"
              title="Use ONLY the entries below with keys, ignoring server env defaults"
            >
              Overwrite Defaults with List
            </button>
          </div>
        </div>

        {/* Editable Provider Rows */}
        <div className="space-y-2.5">
          {rows.map((row, idx) => {
            const pResult = probeStatusForPlatform(row.platform);
            const showBaseUrl = row.platform === 'custom' || Boolean(row.baseUrl);
            const isRevealed = !!revealed[row.rowId];

            return (
              <div
                key={row.rowId}
                className={`rounded-xl border p-3.5 transition-colors ${
                  row.enabled === false
                    ? 'border-app-border/60 bg-app-panel/30 opacity-65'
                    : 'border-app-border bg-app-panel/70'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.enabled !== false}
                      onChange={(e) => updateRow(row.rowId, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-emerald-500"
                      title="Enable or disable this provider"
                    />
                    <span className="text-[11px] font-mono font-bold text-app-dim">
                      #{idx + 1}
                    </span>
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-emerald-300">
                      {row.platform || 'custom'}
                    </span>
                    {row.label && (
                      <span className="text-xs font-semibold text-app-text">
                        {row.label}
                      </span>
                    )}
                    {row.isEnvBacked && !settings.freeLlmOverwriteDefaults && (
                      <span className="rounded bg-teal-500/15 px-2 py-0.5 text-[10px] font-bold text-teal-300 border border-teal-500/30">
                        Server env key ({row.maskedEnvKey})
                      </span>
                    )}
                    {pResult && (
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          pResult.ok
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {pResult.ok ? '✓ Active' : `⚠ ${pResult.error || 'Failed'}`}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveRow(idx, -1)}
                      disabled={idx === 0}
                      className="rounded border border-app-border bg-app-bg px-2 py-0.5 text-[10px] text-app-dim hover:text-app-text disabled:opacity-30"
                      title="Move up in priority"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(idx, 1)}
                      disabled={idx === rows.length - 1}
                      className="rounded border border-app-border bg-app-bg px-2 py-0.5 text-[10px] text-app-dim hover:text-app-text disabled:opacity-30"
                      title="Move down in priority"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      className="rounded border border-app-border bg-app-bg px-2 py-0.5 text-[10px] text-app-dim hover:border-red-400/50 hover:text-red-400"
                      title="Remove provider entry"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-app-dim mb-1">
                      Platform
                    </label>
                    <select
                      value={row.platform}
                      onChange={(e) => updateRow(row.rowId, { platform: e.target.value })}
                      className="w-full rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 text-xs text-app-text outline-none focus:border-emerald-500/60"
                    >
                      {SUPPORTED_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      {!SUPPORTED_PLATFORMS.includes(row.platform) && (
                        <option value={row.platform}>{row.platform}</option>
                      )}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-app-dim mb-1">
                      Label
                    </label>
                    <input
                      type="text"
                      value={row.label ?? ''}
                      onChange={(e) => updateRow(row.rowId, { label: e.target.value })}
                      placeholder="e.g. GROK, aihubmix.com"
                      className="w-full rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 text-xs text-app-text outline-none focus:border-emerald-500/60"
                    />
                  </div>

                  <div className="sm:col-span-6">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-app-dim mb-1">
                      API Key
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type={isRevealed ? 'text' : 'password'}
                        value={row.key}
                        onChange={(e) => updateRow(row.rowId, { key: e.target.value })}
                        placeholder={
                          row.isEnvBacked && !settings.freeLlmOverwriteDefaults
                            ? `Using server env (${row.maskedEnvKey}) — type new key to override`
                            : row.platform === 'cloudflare'
                              ? 'ACCOUNT_ID:API_TOKEN'
                              : 'Enter provider API key…'
                        }
                        className="w-full rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 font-mono text-xs text-app-text outline-none focus:border-emerald-500/60"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setRevealed((prev) => ({ ...prev, [row.rowId]: !prev[row.rowId] }))
                        }
                        className="shrink-0 rounded-lg border border-app-border bg-app-bg px-2.5 py-1 text-[10px] font-bold text-app-dim hover:text-app-text"
                      >
                        {isRevealed ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {showBaseUrl && (
                    <div className="sm:col-span-12">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-app-dim mb-1">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={row.baseUrl ?? ''}
                        onChange={(e) =>
                          updateRow(row.rowId, { baseUrl: e.target.value.replace(/\s+/g, '') })
                        }
                        placeholder={PLATFORM_BASE_HINTS[row.platform] || 'https://api.example.com/v1'}
                        className="w-full rounded-lg border border-app-border bg-app-bg px-2.5 py-1.5 font-mono text-xs text-app-text outline-none focus:border-emerald-500/60"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MaggiKeyDefaults;
