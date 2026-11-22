/**
 * MAGGI engine helpers — environment key pool, model selection, base-URL
 * validation, streaming relay and text-extraction utilities.
 *
 * Extracted from maggiRoutes.ts so the router file stays focused on routes.
 */
import express from 'express';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const envFirst = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
};

export const FREELLM_ENV = {
  baseUrl: envFirst('FREELLMAPI_BASE_URL', 'FREELMAPI_BASE_URL', 'MAGGI_FREELLM_BASE_URL'),
  apiKey: envFirst('FREELLMAPI_API_KEY', 'FREELMAPI_API_KEY', 'MAGGI_FREELLM_API_KEY'),
};

export const normaliseBaseUrl = (url: string): string => {
  // Strip all accidental whitespace (e.g. "http: / /127.0.0.1:31415")
  let cleaned = (url || '').replace(/\s+/g, '').replace(/\/+$/, '');
  if (!cleaned) return '';

  // Fix single-slash typo after protocol (e.g. "http:/127.0.0.1" -> "http://127.0.0.1")
  cleaned = cleaned.replace(/^(https?):\/([^/])/i, '$1://$2');

  // Add default protocol if omitted
  if (!/^https?:\/\//i.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cleaned);
    cleaned = `${isLocal || /:\d+/.test(cleaned) ? 'http' : 'https'}://${cleaned}`;
  }

  // Strip full endpoint suffixes if pasted by mistake
  cleaned = cleaned
    .replace(/\/(chat\/completions|completions|embeddings|models|audio\/speech)$/i, '')
    .replace(/\/+$/, '');

  // Accept both "http://host:3001" and "http://host:3001/v1", while preserving
  // custom endpoints that already contain a version segment like "/api/v1/inference".
  let hasVersionSegment = false;
  try {
    const pathname = new URL(cleaned).pathname;
    hasVersionSegment = /\/v\d+(?:\.\d+)?(?:\/|$)/i.test(pathname);
  } catch {
    hasVersionSegment = /\/v\d+(?:\.\d+)?(?:\/|$)/i.test(cleaned);
  }
  if (!hasVersionSegment) {
    cleaned = `${cleaned}/v1`;
  }

  return cleaned;
};

export const validateBaseUrl = (base: string): string | null => {
  if (!base) return 'Base URL is empty.';
  try {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return `Unsupported URL protocol "${parsed.protocol}". Use http:// or https://.`;
    }
    return null;
  } catch {
    return `Invalid Base URL "${base}". Expected format like http://127.0.0.1:31415/v1 or https://your-host/v1.`;
  }
};

export const isLoopbackHost = (base: string): boolean => {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
};

export const formatFetchError = (err: any, targetUrl: string): { message: string; isLoopbackUnreachable: boolean } => {
  const causeCode = err?.cause?.code || err?.code || '';
  const causeMsg = err?.cause?.message || '';
  const baseMsg = err?.name === 'AbortError'
    ? 'Request timed out — is FreeLLMAPI running and responsive?'
    : (err?.message || 'Network request failed');
  const detail = causeCode ? `${baseMsg} (${causeCode}${causeMsg ? `: ${causeMsg}` : ''})` : baseMsg;
  const isConnIssue = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(causeCode)
    || /fetch failed|ECONNREFUSED/i.test(detail);
  const loopback = isLoopbackHost(targetUrl) && isConnIssue;
  return {
    message: loopback
      ? `Server could not reach ${targetUrl} (${causeCode || 'connection refused'}). If FreeLLMAPI runs on your local PC, trying browser-direct connection or use an HTTPS tunnel.`
      : detail,
    isLoopbackUnreachable: loopback,
  };
};

export const withTimeout = (ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

export const FRIENDLY_ERROR = (status: number, raw: string): string => {
  const msg = raw || `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return `Authentication failed (${status}). Check the FreeLLMAPI unified key / provider key. Raw: ${msg.slice(0, 200)}`;
  }
  if (status === 429) return `Rate limited (429). FreeLLMAPI will fail over to another provider — retry shortly. Raw: ${msg.slice(0, 200)}`;
  if (status === 404) return `Endpoint not found (404). Is FreeLLMAPI running and is the base URL …/v1? Raw: ${msg.slice(0, 200)}`;
  if (status >= 500) return `Upstream provider error (${status}). Raw: ${msg.slice(0, 200)}`;
  return msg.slice(0, 400);
};

/** Decode an OpenAI-style SSE body and relay normalised deltas. */
export const relayOpenAiStream = async (
  upstream: Response,
  res: express.Response,
  meta: { model?: string },
) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const routedVia = upstream.headers.get('x-routed-via') || undefined;
  if (routedVia) res.write(`data: ${JSON.stringify({ routedVia })}\n\n`);

  const reader = upstream.body?.getReader();
  if (!reader) {
    res.write(`data: ${JSON.stringify({ error: 'Upstream returned no stream body' })}\n\n`);
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const pump = async (): Promise<void> => {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          finished = true;
          res.write('data: [DONE]\n\n');
          break;
        }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content
            ?? json.choices?.[0]?.text
            ?? json.delta
            ?? '';
          const model = json.model || meta.model;
          if (delta) res.write(`data: ${JSON.stringify({ delta, model, routedVia })}\n\n`);
          if (json.usage) res.write(`data: ${JSON.stringify({ usage: json.usage })}\n\n`);
        } catch {
          /* keep-alive or non-JSON frame */
        }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  };

  try {
    await pump();
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ error: e?.message || 'stream error' })}\n\n`);
    res.end();
  }
};

export const isBlockedIpOrHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (
    h === 'localhost'
    || h === '0.0.0.0'
    || h === '::1'
    || h === 'metadata.google.internal'
    || h.endsWith('.local')
    || h.endsWith('.internal')
  ) {
    return true;
  }
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^(fc|fd|fe80)/i.test(h)) return true;
  return false;
};

export const blockPrivateHost = (rawUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return 'Only http(s) URLs are supported';
  if (isBlockedIpOrHost(url.hostname)) return 'Blocked private or metadata URL host';
  return null;
};

// ---------------------------------------------------------------------------
// Built-in FreeLLMAPI Key-Pool Router
// ---------------------------------------------------------------------------

export interface KeyPoolEntry {
  platform: string;
  key: string;
  label?: string;
  baseUrl?: string;
  enabled?: boolean;
}

export interface ResolvedTarget {
  platform: string;
  kind: 'openai' | 'google';
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  defaultModels: string[];
}

export const parseEnvKeyPool = (): KeyPoolEntry[] => {
  const raw = envFirst('FREELLMAPI_KEYS_JSON', 'MAGGI_FREELLM_KEYS_JSON');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.keys) ? parsed.keys : []);
    return list.filter((e: any) => e && typeof e.platform === 'string' && typeof e.key === 'string' && e.key.trim());
  } catch {
    return [];
  }
};

export const maskKeyServer = (key: string): string => {
  const s = (key || '').trim();
  if (!s) return '';
  if (s.length <= 10) return '••••••••';
  return `${s.slice(0, 6)}••••${s.slice(-4)}`;
};

export interface MaskedDefaultKeyEntry {
  platform: string;
  label?: string;
  baseUrl?: string;
  enabled: boolean;
  hasKey: boolean;
  maskedKey: string;
  source: 'env';
}

export const getMaskedEnvKeyPool = (): MaskedDefaultKeyEntry[] =>
  parseEnvKeyPool().map((entry) => ({
    platform: (entry.platform || '').trim().toLowerCase(),
    ...(entry.label ? { label: String(entry.label).trim() } : {}),
    ...(entry.baseUrl ? { baseUrl: String(entry.baseUrl).replace(/\s+/g, '') } : {}),
    enabled: entry.enabled !== false,
    hasKey: Boolean(entry.key && entry.key.trim()),
    maskedKey: maskKeyServer(entry.key),
    source: 'env' as const,
  }));

export const PLATFORM_PRIORITY = [
  'openrouter',
  'nvidia',
  'cloudflare',
  'zhipu',
  'groq',
  'cerebras',
  'together',
  'sambanova',
  'mistral',
  'deepseek',
  'google',
  'custom',
  'openai',
];

export const pickModelForPlatform = (platform: string, requestedModel: string, customBaseUrl = ''): { model: string; defaults: string[] } => {
  const req = (requestedModel || 'auto').trim();
  const isAuto = !req || req === 'auto' || req.startsWith('auto:');
  const tier = req === 'auto:fast' || req === 'auto:cheap' ? 'fast' : 'smart';

  switch (platform) {
    case 'openrouter': {
      const defaults = ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free'];
      return { model: isAuto ? 'openrouter/free' : req, defaults };
    }
    case 'nvidia': {
      const defaults = ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct', 'mistralai/mixtral-8x7b-instruct-v0.1'];
      return { model: isAuto ? (tier === 'fast' ? 'meta/llama-3.1-8b-instruct' : 'meta/llama-3.3-70b-instruct') : req, defaults };
    }
    case 'cloudflare': {
      const defaults = ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
      return { model: isAuto ? (tier === 'fast' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/meta/llama-3.3-70b-instruct-fp8-fast') : req, defaults };
    }
    case 'zhipu': {
      const defaults = ['glm-4-flash', 'glm-4-air', 'glm-4-plus'];
      return { model: isAuto ? 'glm-4-flash' : req, defaults };
    }
    case 'google': {
      const defaults = ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-3.1-flash-lite'];
      return { model: isAuto ? 'gemini-4-hydrogen' : req, defaults };
    }
    case 'groq': {
      const defaults = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
      return { model: isAuto ? (tier === 'fast' ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile') : req, defaults };
    }
    case 'cerebras': {
      const defaults = ['llama-3.3-70b', 'llama3.1-8b'];
      return { model: isAuto ? (tier === 'fast' ? 'llama3.1-8b' : 'llama-3.3-70b') : req, defaults };
    }
    case 'mistral': {
      const defaults = ['mistral-small-latest', 'open-mistral-nemo'];
      return { model: isAuto ? 'mistral-small-latest' : req, defaults };
    }
    case 'deepseek': {
      const defaults = ['deepseek-chat'];
      return { model: isAuto ? 'deepseek-chat' : req, defaults };
    }
    case 'together': {
      const defaults = ['meta-llama/Llama-3.3-70B-Instruct-Turbo'];
      return { model: isAuto ? 'meta-llama/Llama-3.3-70B-Instruct-Turbo' : req, defaults };
    }
    case 'sambanova': {
      const defaults = ['Meta-Llama-3.3-70B-Instruct'];
      return { model: isAuto ? 'Meta-Llama-3.3-70B-Instruct' : req, defaults };
    }
    case 'openai': {
      const defaults = ['gpt-4o-mini', 'gpt-4o'];
      return { model: isAuto ? 'gpt-4o-mini' : req, defaults };
    }
    default: {
      if (customBaseUrl.includes('nvidia.com')) {
        const defaults = ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct'];
        return { model: isAuto ? (tier === 'fast' ? 'meta/llama-3.1-8b-instruct' : 'meta/llama-3.3-70b-instruct') : req, defaults };
      }
      return { model: isAuto ? 'gpt-4o-mini' : req, defaults: ['gpt-4o-mini'] };
    }
  }
};

export const resolveKeyPoolEntry = (entry: KeyPoolEntry, requestedModel: string): ResolvedTarget | null => {
  if (entry.enabled === false) return null;
  const platform = (entry.platform || '').trim().toLowerCase();
  const rawKey = (entry.key || '').trim();
  if (!platform || !rawKey) return null;

  if (platform === 'google') {
    const picked = pickModelForPlatform('google', requestedModel);
    return {
      platform: 'google',
      kind: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: rawKey,
      model: picked.model,
      defaultModels: picked.defaults,
    };
  }

  let baseUrl = '';
  let apiKey = rawKey;
  let extraHeaders: Record<string, string> | undefined;

  if (platform === 'openrouter') {
    baseUrl = 'https://openrouter.ai/api/v1';
    extraHeaders = { 'HTTP-Referer': 'https://aistudio.google.com', 'X-Title': 'MAGGI RAG' };
  } else if (platform === 'nvidia') {
    baseUrl = 'https://integrate.api.nvidia.com/v1';
  } else if (platform === 'cloudflare') {
    const sep = rawKey.indexOf(':');
    if (sep <= 0 || sep === rawKey.length - 1) return null;
    const accountId = rawKey.slice(0, sep).trim();
    apiKey = rawKey.slice(sep + 1).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) return null;
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  } else if (platform === 'zhipu') {
    baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  } else if (platform === 'groq') {
    baseUrl = 'https://api.groq.com/openai/v1';
  } else if (platform === 'cerebras') {
    baseUrl = 'https://api.cerebras.ai/v1';
  } else if (platform === 'mistral') {
    baseUrl = 'https://api.mistral.ai/v1';
  } else if (platform === 'deepseek') {
    baseUrl = 'https://api.deepseek.com/v1';
  } else if (platform === 'together') {
    baseUrl = 'https://api.together.xyz/v1';
  } else if (platform === 'sambanova') {
    baseUrl = 'https://api.sambanova.ai/v1';
  } else if (platform === 'openai') {
    baseUrl = 'https://api.openai.com/v1';
  } else if (platform === 'custom') {
    const norm = normaliseBaseUrl(entry.baseUrl || '');
    if (!norm || validateBaseUrl(norm)) return null;
    try {
      const parsed = new URL(norm);
      if (isBlockedIpOrHost(parsed.hostname)) return null;
    } catch {
      return null;
    }
    baseUrl = norm;
  } else {
    return null;
  }

  const picked = pickModelForPlatform(platform, requestedModel, baseUrl);
  return {
    platform,
    kind: 'openai',
    baseUrl,
    apiKey,
    model: picked.model,
    extraHeaders,
    defaultModels: picked.defaults,
  };
};

const slotKeyForEntry = (entry: KeyPoolEntry): string => {
  const platform = (entry.platform || '').trim().toLowerCase();
  const base = entry.baseUrl ? normaliseBaseUrl(entry.baseUrl).toLowerCase() : '';
  return `${platform}::${base}`;
};

const combineClientAndEnvEntries = (clientEntries: unknown, overwriteDefaults = false): KeyPoolEntry[] => {
  const clientList = Array.isArray(clientEntries) ? (clientEntries as KeyPoolEntry[]) : [];
  if (overwriteDefaults) {
    return clientList;
  }

  const disabledSlots = new Set<string>();
  const overriddenSlotsWithKeys = new Set<string>();
  for (const item of clientList) {
    if (!item || typeof item.platform !== 'string') continue;
    const slot = slotKeyForEntry(item);
    if (item.enabled === false) {
      disabledSlots.add(slot);
    } else if (item.key && item.key.trim()) {
      overriddenSlotsWithKeys.add(slot);
    }
  }

  const envEntries = parseEnvKeyPool().filter((envItem) => {
    const slot = slotKeyForEntry(envItem);
    return !disabledSlots.has(slot) && !overriddenSlotsWithKeys.has(slot);
  });

  return [...clientList, ...envEntries];
};

export const buildKeyPoolTargets = (
  clientEntries: unknown,
  requestedModel = 'auto',
  overwriteDefaults = false,
): ResolvedTarget[] => {
  const combined = combineClientAndEnvEntries(clientEntries, overwriteDefaults);

  // Support explicit "platform:modelId" pinning (e.g. "nvidia:meta/llama-3.3-70b-instruct")
  let pinnedPlatform: string | null = null;
  let actualModel = (requestedModel || 'auto').trim();
  const colonIdx = actualModel.indexOf(':');
  if (colonIdx > 0) {
    const prefix = actualModel.slice(0, colonIdx).toLowerCase();
    if (PLATFORM_PRIORITY.includes(prefix)) {
      pinnedPlatform = prefix;
      actualModel = actualModel.slice(colonIdx + 1) || 'auto';
    }
  }

  const resolved: ResolvedTarget[] = [];
  const seen = new Set<string>();

  for (const item of combined) {
    const target = resolveKeyPoolEntry(item as KeyPoolEntry, actualModel);
    if (!target) continue;
    const dedupeKey = `${target.baseUrl}::${target.apiKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    resolved.push(target);
  }

  resolved.sort((a, b) => {
    if (pinnedPlatform) {
      if (a.platform === pinnedPlatform && b.platform !== pinnedPlatform) return -1;
      if (b.platform === pinnedPlatform && a.platform !== pinnedPlatform) return 1;
    }
    const idxA = PLATFORM_PRIORITY.indexOf(a.platform);
    const idxB = PLATFORM_PRIORITY.indexOf(b.platform);
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });

  if (pinnedPlatform) {
    const matching = resolved.filter((t) => t.platform === pinnedPlatform);
    if (matching.length > 0) return matching;
  }

  return resolved;
};

// ---------------------------------------------------------------------------
// Voice / TTS model discovery & key-pool routing for Podcast audio
// ---------------------------------------------------------------------------

export const PLATFORM_TTS_DEFAULTS: Record<string, string[]> = {
  google: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
  openai: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
  groq: ['playai-tts', 'canopylabs/orpheus-v1-english'],
  cloudflare: ['@cf/myshell-ai/melotts'],
  together: ['cartesia/sonic'],
};

export const VOICE_PLATFORM_PRIORITY = [
  'google',
  'openai',
  'groq',
  'together',
  'cloudflare',
  'custom',
  'openrouter',
  'nvidia',
];

export const isVoiceModelId = (modelId: string): boolean => {
  const id = (modelId || '').toLowerCase();
  if (!id) return false;
  if (id.includes('transcribe') || id.includes('whisper') || id.includes('stt')) return false;
  return /(?:^|[-_:/])(tts|speech|kokoro|orpheus|playai|melotts|bark|cartesia|sonic|parler|chatterbox|f5-tts|xtts|piper|eleven|aura|sesame|csm|vits)(?:$|[-_:/0-9])/i.test(id)
    || id.includes('-tts')
    || id.includes('tts-1')
    || id.includes('audio-preview');
};

export const pickVoiceModelForPlatform = (
  platform: string,
  requestedVoiceModel: string,
  speakers = 1,
): { model: string; defaults: string[] } => {
  const req = (requestedVoiceModel || 'auto').trim();
  const isAuto = !req || req === 'auto' || req.startsWith('auto:');
  const defaults = PLATFORM_TTS_DEFAULTS[platform] ?? ['tts-1'];

  if (platform === 'google') {
    const autoModel = speakers >= 2 ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts';
    return { model: isAuto ? autoModel : req, defaults };
  }
  if (platform === 'openai') {
    return { model: isAuto ? 'gpt-4o-mini-tts' : req, defaults };
  }
  if (platform === 'groq') {
    return { model: isAuto ? 'playai-tts' : req, defaults };
  }
  if (platform === 'cloudflare') {
    return { model: isAuto ? '@cf/myshell-ai/melotts' : req, defaults };
  }
  if (platform === 'together') {
    return { model: isAuto ? 'cartesia/sonic' : req, defaults };
  }
  return { model: isAuto ? defaults[0] || 'tts-1' : req, defaults };
};

export const buildVoicePoolTargets = (
  clientEntries: unknown,
  requestedVoiceModel = 'auto',
  speakers = 1,
  overwriteDefaults = false,
): ResolvedTarget[] => {
  const combined = combineClientAndEnvEntries(clientEntries, overwriteDefaults);

  let pinnedPlatform: string | null = null;
  let actualModel = (requestedVoiceModel || 'auto').trim();
  const colonIdx = actualModel.indexOf(':');
  if (colonIdx > 0) {
    const prefix = actualModel.slice(0, colonIdx).toLowerCase();
    if (PLATFORM_PRIORITY.includes(prefix)) {
      pinnedPlatform = prefix;
      actualModel = actualModel.slice(colonIdx + 1) || 'auto';
    }
  }

  // If user selected a Gemini TTS model without prefix, prefer Google keys first.
  if (!pinnedPlatform && actualModel.toLowerCase().includes('gemini') && actualModel.toLowerCase().includes('tts')) {
    pinnedPlatform = 'google';
  }

  const resolved: ResolvedTarget[] = [];
  const seen = new Set<string>();

  for (const item of combined) {
    const entry = item as KeyPoolEntry;
    const base = resolveKeyPoolEntry(entry, 'auto');
    if (!base) continue;
    const dedupeKey = `${base.baseUrl}::${base.apiKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const picked = pickVoiceModelForPlatform(base.platform, actualModel, speakers);
    resolved.push({
      ...base,
      model: picked.model,
      defaultModels: picked.defaults,
    });
  }

  resolved.sort((a, b) => {
    if (pinnedPlatform) {
      if (a.platform === pinnedPlatform && b.platform !== pinnedPlatform) return -1;
      if (b.platform === pinnedPlatform && a.platform !== pinnedPlatform) return 1;
    }
    const idxA = VOICE_PLATFORM_PRIORITY.indexOf(a.platform);
    const idxB = VOICE_PLATFORM_PRIORITY.indexOf(b.platform);
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });

  if (pinnedPlatform) {
    const matching = resolved.filter((t) => t.platform === pinnedPlatform);
    if (matching.length > 0) return matching;
  }

  // Only include platforms that either support TTS natively or are custom proxies
  // unless none of those exist.
  const ttsCapable = resolved.filter(
    (t) => Boolean(PLATFORM_TTS_DEFAULTS[t.platform]) || t.platform === 'custom',
  );
  return ttsCapable.length > 0 ? ttsCapable : resolved;
};

export const formatVoiceModelKey = (platform: string, model: string): string => {
  const cleanModel = (model || '').trim();
  const cleanPlatform = (platform || '').trim().toLowerCase();
  if (!cleanModel) return cleanPlatform || 'auto';
  if (!cleanPlatform) return cleanModel;
  return cleanModel.toLowerCase().startsWith(`${cleanPlatform}:`)
    ? cleanModel
    : `${cleanPlatform}:${cleanModel}`;
};

export const cleanTtsText = (text: string): string => {
  const raw = String(text || '');
  const base = raw
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/<\/?[a-zA-Z!/?][^>]*>/g, ' ')
    .replace(/#{1,6}\s?/g, '');

  const withoutBrackets = base
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (withoutBrackets) return withoutBrackets;

  // If bracket stripping removed everything (e.g. a line written wholly inside [...]),
  // keep the inner words without the brackets so valid input never degrades to "".
  return base
    .replace(/[\[\]]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Build an ordered sequence of `(target, model)` TTS candidates across the entire
 * FreeLLMAPI key pool. Unlike `buildVoicePoolTargets`, if a pinned platform or model
 * fails, this yields every remaining model on that platform and then the next
 * TTS-capable platforms & models in sequential priority order.
 */
export const buildSequentialVoiceCandidates = (
  clientEntries: unknown,
  requestedVoiceModel = 'auto',
  speakers = 1,
  overwriteDefaults = false,
): ResolvedTarget[] => {
  const combined = combineClientAndEnvEntries(clientEntries, overwriteDefaults);

  let pinnedPlatform: string | null = null;
  let actualModel = (requestedVoiceModel || 'auto').trim();
  const isAuto = !actualModel || actualModel === 'auto' || actualModel.startsWith('auto:');

  if (!isAuto) {
    const colonIdx = actualModel.indexOf(':');
    if (colonIdx > 0) {
      const prefix = actualModel.slice(0, colonIdx).toLowerCase();
      if (PLATFORM_PRIORITY.includes(prefix)) {
        pinnedPlatform = prefix;
        actualModel = actualModel.slice(colonIdx + 1).trim() || 'auto';
      }
    }
    if (!pinnedPlatform && actualModel.toLowerCase().includes('gemini') && actualModel.toLowerCase().includes('tts')) {
      pinnedPlatform = 'google';
    }
  }

  const resolvedAll: ResolvedTarget[] = [];
  const seenTargets = new Set<string>();
  for (const item of combined) {
    const base = resolveKeyPoolEntry(item as KeyPoolEntry, 'auto');
    if (!base) continue;
    const dedupeKey = `${base.platform}::${base.baseUrl}::${base.apiKey}`;
    if (seenTargets.has(dedupeKey)) continue;
    seenTargets.add(dedupeKey);
    resolvedAll.push(base);
  }

  // Keep native TTS platforms + custom proxies (excluding known chat-only custom nvidia URLs)
  const ttsCapable = resolvedAll.filter((t) => {
    if (PLATFORM_TTS_DEFAULTS[t.platform]) return true;
    if (t.platform === 'custom' && !t.baseUrl.includes('nvidia.com')) return true;
    return pinnedPlatform !== null && t.platform === pinnedPlatform;
  });

  const pool = ttsCapable.length > 0 ? ttsCapable : resolvedAll;

  pool.sort((a, b) => {
    if (pinnedPlatform) {
      if (a.platform === pinnedPlatform && b.platform !== pinnedPlatform) return -1;
      if (b.platform === pinnedPlatform && a.platform !== pinnedPlatform) return 1;
    }
    const idxA = VOICE_PLATFORM_PRIORITY.indexOf(a.platform);
    const idxB = VOICE_PLATFORM_PRIORITY.indexOf(b.platform);
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });

  const candidates: ResolvedTarget[] = [];
  const seenCandidateKeys = new Set<string>();

  const pushCandidate = (base: ResolvedTarget, modelId: string, defaults: string[]) => {
    const cleanModel = (modelId || '').trim();
    if (!cleanModel || cleanModel === 'auto' || cleanModel.startsWith('auto:')) return;
    const key = `${base.platform}::${base.baseUrl}::${base.apiKey}::${cleanModel}`;
    if (seenCandidateKeys.has(key)) return;
    seenCandidateKeys.add(key);
    candidates.push({
      ...base,
      model: cleanModel,
      defaultModels: defaults,
    });
  };

  for (const target of pool) {
    const rawDefaults = target.platform === 'google'
      ? (speakers >= 2
          ? ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
          : ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'])
      : (PLATFORM_TTS_DEFAULTS[target.platform] ?? ['tts-1', 'gpt-4o-mini-tts']);

    // Requested explicit model goes first on matching platform (or custom/unpinned platforms)
    if (!isAuto && actualModel && (!pinnedPlatform || target.platform === pinnedPlatform)) {
      pushCandidate(target, actualModel, rawDefaults);
    }

    for (const defModel of rawDefaults) {
      pushCandidate(target, defModel, rawDefaults);
    }
  }

  return candidates;
};

export const mapGeminiVoiceToOpenAi = (voiceName?: string): string => {
  const v = (voiceName || '').trim().toLowerCase();
  switch (v) {
    case 'kore': return 'nova';
    case 'zephyr': return 'shimmer';
    case 'aoede': return 'alloy';
    case 'puck': return 'echo';
    case 'charon': return 'onyx';
    case 'fenrir': return 'fable';
    default:
      return v || 'alloy';
  }
};

export const detectAudioMimeType = (buf: Buffer, headerType?: string | null): string => {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'RIFF') return 'audio/wav';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac';
  if (
    (buf.length >= 3 && buf.subarray(0, 3).toString('ascii') === 'ID3')
    || (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg';
  }
  const ct = (headerType || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('audio/')) return ct;
  return 'audio/mpeg';
};

export const addWavHeaderBuffer = (pcm: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/** Concatenates multiple RIFF/WAV buffers (stripping headers after the first). Returns null if incompatible. */
export const concatWavBuffers = (buffers: Buffer[]): Buffer | null => {
  if (!buffers.length) return null;
  if (buffers.length === 1) return buffers[0];
  const pcmParts: Buffer[] = [];
  let sampleRate = 24000;
  let numChannels = 1;
  let bitsPerSample = 16;

  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i];
    if (b.length < 44 || b.subarray(0, 4).toString('ascii') !== 'RIFF' || b.subarray(8, 12).toString('ascii') !== 'WAVE') {
      return null;
    }
    const ch = b.readUInt16LE(22);
    const sr = b.readUInt32LE(24);
    const bps = b.readUInt16LE(34);
    if (i === 0) {
      numChannels = ch;
      sampleRate = sr;
      bitsPerSample = bps;
    } else if (ch !== numChannels || sr !== sampleRate || bps !== bitsPerSample) {
      return null;
    }
    // Find the 'data' subchunk safely (normally at offset 36)
    let offset = 12;
    let dataStart = 44;
    let dataSize = b.length - 44;
    while (offset + 8 <= b.length) {
      const chunkId = b.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = b.readUInt32LE(offset + 4);
      if (chunkId === 'data') {
        dataStart = offset + 8;
        dataSize = Math.min(chunkSize, b.length - dataStart);
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    pcmParts.push(b.subarray(dataStart, dataStart + dataSize));
  }

  return addWavHeaderBuffer(Buffer.concat(pcmParts), sampleRate, numChannels, bitsPerSample);
};


export const htmlToText = (html: string): { text: string; title?: string } => {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let work = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) =>
      `\n\n${'#'.repeat(Number(lvl))} ${inner.replace(/<[^>]+>/g, ' ').trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  const text = work
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&#(\d+);/g, (_m, c: string) => String.fromCharCode(Number(c)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title: titleMatch ? titleMatch[1].trim() : undefined };
};

