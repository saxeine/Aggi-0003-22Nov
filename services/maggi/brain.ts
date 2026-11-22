/**
 * MAGGI brain — one interface, four backends.
 *
 * Primary target is **FreeLLMAPI** (github.com/tashfeenahmed/freellmapi): a
 * self-hosted, OpenAI-compatible proxy that pools the free tiers of ~80
 * providers behind one endpoint with smart routing + automatic failover.
 *
 * Because it speaks the OpenAI protocol we implement one client and get:
 *   - model "auto" / "auto:fast" / "auto:smart" / "auto:cheap" routing
 *   - cross-provider failover handled upstream (no retry storms here)
 *   - per-key rate-limit tracking upstream
 *   - tool calling + streaming for free
 *
 * All network calls go through `/api/maggi/chat` so the unified key can live
 * either in localStorage (browser-only setups) or purely in the server env.
 */

import { MaggiSettings, MaggiProvider, PROVIDER_LABELS } from '../../maggi/config';
import type { VoiceSettings } from '../../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  provider: MaggiProvider;
  model: string;
  routedVia?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  latencyMs: number;
}

export type StreamHandler = (delta: string) => void;

export interface MaggiBrain {
  provider: MaggiProvider;
  label: string;
  complete: (messages: ChatMessage[], opts?: CompletionOptions) => Promise<CompletionResult>;
  stream: (messages: ChatMessage[], opts: CompletionOptions, onDelta: StreamHandler) => Promise<CompletionResult>;
  /** Cheap connectivity probe used by the settings panel. */
  probe: () => Promise<{
    ok: boolean;
    detail: string;
    models?: string[];
    voiceModels?: string[];
    providerResults?: Array<{ platform: string; ok: boolean; error?: string }>;
  }>;
}

const normaliseBaseUrl = (url: string): string => {
  let cleaned = (url || '').replace(/\s+/g, '').replace(/\/+$/, '');
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^(https?):\/([^/])/i, '$1://$2');
  if (!/^https?:\/\//i.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cleaned);
    cleaned = `${isLocal || /:\d+/.test(cleaned) ? 'http' : 'https'}://${cleaned}`;
  }
  cleaned = cleaned
    .replace(/\/(chat\/completions|completions|embeddings|models|audio\/speech)$/i, '')
    .replace(/\/+$/, '');
  let hasVersionSegment = false;
  try {
    hasVersionSegment = /\/v\d+(?:\.\d+)?(?:\/|$)/i.test(new URL(cleaned).pathname);
  } catch {
    hasVersionSegment = /\/v\d+(?:\.\d+)?(?:\/|$)/i.test(cleaned);
  }
  if (!hasVersionSegment) {
    cleaned = `${cleaned}/v1`;
  }
  return cleaned;
};

const isLoopbackUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
};

const formatLoopbackBrowserError = (baseUrl: string, err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not reach ${baseUrl} from the cloud server or directly from your browser (${msg}). `
    + `Make sure FreeLLMAPI is running on that port with CORS enabled, or expose it with an HTTPS tunnel `
    + `(e.g. \`cloudflared tunnel --url ${baseUrl.replace(/\/v1$/i, '')}\`) and paste the https:// URL in Base URL.`;
};

const postJson = async (url: string, body: unknown, signal?: AbortSignal) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* raw text */ }
    const err = new Error(parsed?.error || `HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`) as Error & { code?: string };
    if (parsed?.code) err.code = parsed.code;
    throw err;
  }
  return res;
};

const normaliseProvider = (p: MaggiProvider): 'freellmapi' | 'gemini' | 'openai' | 'ollama' => {
  switch (p) {
    case 'freellmapi': return 'freellmapi';
    case 'gemini': return 'gemini';
    case 'ollama': return 'ollama';
    default: return 'openai';
  }
};

const buildPayload = (settings: MaggiSettings, messages: ChatMessage[], opts: CompletionOptions) => {
  const provider = normaliseProvider(settings.provider);
  const payload: Record<string, unknown> = {
    provider,
    messages,
    temperature: opts.temperature ?? settings.temperature,
    maxTokens: opts.maxTokens ?? 1200,
  };

  if (provider === 'freellmapi') {
    const mode = settings.freeLlmMode || (settings.freeLlmKeys?.length ? 'keypool' : 'url');
    payload.freeLlmMode = mode;
    if (mode === 'keypool') {
      payload.keyPool = settings.freeLlmKeys || [];
      payload.overwriteDefaults = !!settings.freeLlmOverwriteDefaults;
    } else {
      payload.baseUrl = normaliseBaseUrl(settings.freeLlmApiBaseUrl);
      payload.apiKey = settings.freeLlmApiKey.trim();
    }
    payload.model = opts.model || settings.freeLlmApiModel || 'auto';
  } else if (provider === 'openai') {
    payload.baseUrl = normaliseBaseUrl(settings.openAiBaseUrl);
    payload.apiKey = settings.openAiApiKey.trim();
    payload.model = opts.model || settings.openAiModel;
  } else if (provider === 'ollama') {
    payload.baseUrl = settings.ollamaBaseUrl.replace(/\s+/g, '').replace(/\/+$/, '');
    payload.model = opts.model || settings.ollamaModel;
  } else {
    payload.model = opts.model || settings.geminiModel;
  }
  return payload;
};

const isLoopbackFallbackCandidate = (err: unknown, baseUrl?: string): boolean => {
  if (!baseUrl || !isLoopbackUrl(baseUrl)) return false;
  const code = (err as any)?.code || '';
  const msg = err instanceof Error ? err.message : String(err);
  return code === 'LOOPBACK_UNREACHABLE' || /ECONNREFUSED|LOOPBACK_UNREACHABLE|fetch failed|not reach/i.test(msg);
};

export const createBrain = (settings: MaggiSettings): MaggiBrain => {
  const provider = settings.provider;
  const label = PROVIDER_LABELS[provider];

  const complete = async (messages: ChatMessage[], opts: CompletionOptions = {}): Promise<CompletionResult> => {
    const started = performance.now();
    const payload = buildPayload(settings, messages, opts);
    const normProvider = payload.provider as string;
    const targetBase = typeof payload.baseUrl === 'string' ? payload.baseUrl : undefined;
    const targetKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';

    let data: any;
    let headerRoutedVia: string | undefined;

    try {
      const res = await postJson('/api/maggi/chat', payload, opts.signal);
      headerRoutedVia = res.headers.get('x-routed-via') || undefined;
      data = await res.json();
    } catch (proxyErr) {
      if ((normProvider === 'freellmapi' || normProvider === 'openai') && isLoopbackFallbackCandidate(proxyErr, targetBase)) {
        try {
          const directRes = await fetch(`${targetBase}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(targetKey ? { Authorization: `Bearer ${targetKey}` } : {}),
            },
            body: JSON.stringify({
              model: payload.model || 'auto',
              messages,
              temperature: payload.temperature,
              max_tokens: payload.maxTokens,
              stream: false,
            }),
            signal: opts.signal,
          });
          if (!directRes.ok) {
            const raw = await directRes.text().catch(() => '');
            throw new Error(`HTTP ${directRes.status}: ${raw.slice(0, 300) || directRes.statusText}`);
          }
          headerRoutedVia = directRes.headers.get('x-routed-via') || undefined;
          data = await directRes.json();
        } catch (directErr) {
          if (directErr instanceof TypeError) {
            throw new Error(formatLoopbackBrowserError(targetBase!, directErr));
          }
          throw directErr;
        }
      } else {
        throw proxyErr;
      }
    }

    // The /api/maggi/chat route returns a normalised {text,...} envelope, but
    // tolerate a raw OpenAI/Chat shape too in case the endpoint is pointed
    // straight at an upstream-compatible gateway.
    const rawContent = data.choices?.[0]?.message?.content
      ?? data.choices?.[0]?.text
      ?? data.message?.content
      ?? '';
    const text = typeof data.text === 'string'
      ? data.text
      : typeof rawContent === 'string' ? rawContent : '';

    return {
      text: text.trim(),
      provider,
      model: data.model || String(payload.model || ''),
      routedVia: data.routedVia || data.routed_via || headerRoutedVia,
      usage: data.usage
        ? {
          promptTokens: data.usage.promptTokens ?? data.usage.prompt_tokens,
          completionTokens: data.usage.completionTokens ?? data.usage.completion_tokens,
        }
        : undefined,
      latencyMs: Math.round(performance.now() - started),
    };
  };

  const stream = async (
    messages: ChatMessage[],
    opts: CompletionOptions,
    onDelta: StreamHandler,
  ): Promise<CompletionResult> => {
    const started = performance.now();
    const payload: Record<string, unknown> = { ...buildPayload(settings, messages, opts), stream: true };
    const normProvider = payload.provider as string;
    const targetBase = typeof payload.baseUrl === 'string' ? payload.baseUrl : undefined;
    const targetKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';

    let res = await fetch('/api/maggi/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* raw text */ }

      if (
        (normProvider === 'freellmapi' || normProvider === 'openai')
        && targetBase
        && isLoopbackUrl(targetBase)
        && (parsed?.code === 'LOOPBACK_UNREACHABLE' || /ECONNREFUSED|LOOPBACK_UNREACHABLE|fetch failed/i.test(text))
      ) {
        try {
          res = await fetch(`${targetBase}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(targetKey ? { Authorization: `Bearer ${targetKey}` } : {}),
            },
            body: JSON.stringify({
              model: payload.model || 'auto',
              messages,
              temperature: payload.temperature,
              max_tokens: payload.maxTokens,
              stream: true,
            }),
            signal: opts.signal,
          });
        } catch (directErr) {
          throw new Error(formatLoopbackBrowserError(targetBase, directErr));
        }
      } else {
        throw new Error(`Stream failed (${res.status}): ${parsed?.error || text.slice(0, 300)}`);
      }
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Stream failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let model = String(payload.model || '');
    let routedVia: string | undefined = res.headers.get('x-routed-via') || undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const json = trimmed.slice(5).trim();
        if (!json || json === '[DONE]') continue;
        try {
          const evt = JSON.parse(json);
          if (evt.model) model = evt.model;
          if (evt.routedVia) routedVia = evt.routedVia;
          const delta = evt.delta ?? evt.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            onDelta(delta);
          }
          if (evt.error) throw new Error(evt.error);
        } catch {
          /* ignore malformed keep-alive frames */
        }
      }
    }

    return {
      text: full.trim(),
      provider,
      model,
      routedVia,
      latencyMs: Math.round(performance.now() - started),
    };
  };

  const probe = async () => {
    const normProvider = normaliseProvider(provider);
    const mode = normProvider === 'freellmapi'
      ? (settings.freeLlmMode || (settings.freeLlmKeys?.length ? 'keypool' : 'url'))
      : 'url';
    const rawBase = provider === 'freellmapi' && mode !== 'keypool' ? settings.freeLlmApiBaseUrl
      : provider === 'openai-compatible' ? settings.openAiBaseUrl
        : provider === 'ollama' ? settings.ollamaBaseUrl : undefined;
    const cleanBase = rawBase
      ? (normProvider === 'ollama' ? rawBase.replace(/\s+/g, '').replace(/\/+$/, '') : normaliseBaseUrl(rawBase))
      : undefined;
    const cleanKey = (provider === 'freellmapi' && mode !== 'keypool' ? settings.freeLlmApiKey
      : provider === 'openai-compatible' ? settings.openAiApiKey : '').trim();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const geminiKey = readCustomGeminiKeyHeader();
      if (geminiKey) headers['x-gemini-key'] = geminiKey;
      const res = await fetch('/api/maggi/probe', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider: normProvider,
          ...(normProvider === 'freellmapi' ? {
            freeLlmMode: mode,
            keyPool: mode === 'keypool' ? (settings.freeLlmKeys || []) : undefined,
            overwriteDefaults: mode === 'keypool' ? !!settings.freeLlmOverwriteDefaults : undefined,
          } : {}),
          baseUrl: cleanBase,
          apiKey: cleanKey || undefined,
          model: provider === 'freellmapi' ? settings.freeLlmApiModel
            : provider === 'openai-compatible' ? settings.openAiModel : settings.ollamaModel,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`);
      }
      const data = await res.json();

      if (!data.ok && mode !== 'keypool' && (normProvider === 'freellmapi' || normProvider === 'openai') && cleanBase && isLoopbackUrl(cleanBase)
        && (data.code === 'LOOPBACK_UNREACHABLE' || /ECONNREFUSED|LOOPBACK_UNREACHABLE|fetch failed/i.test(data.detail || ''))) {
        try {
          const direct = await fetch(`${cleanBase}/models`, {
            headers: cleanKey ? { Authorization: `Bearer ${cleanKey}` } : {},
          });
          if (!direct.ok) {
            const raw = await direct.text().catch(() => '');
            return { ok: false, detail: `Local endpoint returned HTTP ${direct.status}: ${raw.slice(0, 200) || direct.statusText}` };
          }
          const directJson = await direct.json();
          const models = (directJson.data ?? directJson.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean);
          const voiceModels = models.filter((id: string) => isVoiceModelId(id));
          return {
            ok: true,
            detail: `Connected directly from browser — ${models.length} models available${cleanKey ? '' : ' (no key: anonymous providers only)'}`,
            models: models.slice(0, 200),
            voiceModels: voiceModels.slice(0, 60),
          };
        } catch (directErr) {
          return { ok: false, detail: formatLoopbackBrowserError(cleanBase, directErr) };
        }
      }

      return {
        ok: !!data.ok,
        detail: data.detail || (data.ok ? 'Connected' : 'Unreachable'),
        models: data.models,
        voiceModels: data.voiceModels,
        providerResults: data.providerResults,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  };

  return { provider, label, complete, stream, probe };
};

/**
 * Cheap helper for pipelines that only need a `complete` function
 * (query expansion, HyDE, re-ranking).
 */
export const brainAsLlm = (brain: MaggiBrain) => ({
  complete: async (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => {
    const res = await brain.complete(
      [
        { role: 'system', content: 'You are a precise retrieval assistant. Follow the output format exactly.' },
        { role: 'user', content: prompt },
      ],
      { temperature: opts?.temperature ?? 0.2, maxTokens: opts?.maxTokens ?? 300 },
    );
    return res.text;
  },
});

export const isVoiceModelId = (modelId: string): boolean => {
  const id = (modelId || '').toLowerCase();
  if (!id) return false;
  if (id.includes('transcribe') || id.includes('whisper') || id.includes('stt')) return false;
  return /(?:^|[-_:/])(tts|speech|kokoro|orpheus|playai|melotts|bark|cartesia|sonic|parler|chatterbox|f5-tts|xtts|piper|eleven|aura|sesame|csm|vits)(?:$|[-_:/0-9])/i.test(id)
    || id.includes('-tts')
    || id.includes('tts-1')
    || id.includes('audio-preview');
};

const readCustomGeminiKeyHeader = (): string | undefined => {
  try {
    const saved = localStorage.getItem('gemini_media_aggregator_settings');
    if (!saved) return undefined;
    const parsed = JSON.parse(saved);
    return typeof parsed?.geminiApiKey === 'string' && parsed.geminiApiKey.trim()
      ? parsed.geminiApiKey.trim()
      : undefined;
  } catch {
    return undefined;
  }
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export interface MaggiSpeechResult {
  audioBase64: string;
  mimeType: string;
  model?: string;
  routedVia?: string;
  assignedVoiceModel?: string;
  fallbackUsed?: boolean;
}

export const generateMaggiSpeech = async (
  text: string,
  speakers: number,
  voiceSettings: VoiceSettings,
  maggiSettings: MaggiSettings,
): Promise<MaggiSpeechResult> => {
  const normProvider = normaliseProvider(maggiSettings.provider);
  const mode = normProvider === 'freellmapi'
    ? (maggiSettings.freeLlmMode || (maggiSettings.freeLlmKeys?.length ? 'keypool' : 'url'))
    : 'url';
  const targetBase = normProvider === 'freellmapi' && mode !== 'keypool'
    ? normaliseBaseUrl(maggiSettings.freeLlmApiBaseUrl)
    : normProvider === 'openai'
      ? normaliseBaseUrl(maggiSettings.openAiBaseUrl)
      : undefined;
  const targetKey = normProvider === 'freellmapi' && mode !== 'keypool'
    ? maggiSettings.freeLlmApiKey.trim()
    : normProvider === 'openai'
      ? maggiSettings.openAiApiKey.trim()
      : '';

  const payload = {
    provider: normProvider,
    freeLlmMode: mode,
    ...(mode === 'keypool' ? {
      keyPool: maggiSettings.freeLlmKeys || [],
      overwriteDefaults: !!maggiSettings.freeLlmOverwriteDefaults,
    } : {}),
    ...(targetBase ? { baseUrl: targetBase } : {}),
    ...(targetKey ? { apiKey: targetKey } : {}),
    voiceModel: maggiSettings.freeLlmVoiceModel || 'auto',
    text,
    speakers,
    voiceSettings,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const geminiKey = readCustomGeminiKeyHeader();
  if (geminiKey) headers['x-gemini-key'] = geminiKey;

  const res = await fetch('/api/maggi/tts', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const data = await res.json();
    if (!data?.audioBase64) throw new Error('MAGGI TTS returned empty audio.');
    return {
      audioBase64: data.audioBase64,
      mimeType: data.mimeType || 'audio/wav',
      model: data.model,
      routedVia: data.routedVia,
      assignedVoiceModel: data.assignedVoiceModel,
      fallbackUsed: Boolean(data.fallbackUsed),
    };
  }

  const errText = await res.text().catch(() => '');
  let parsed: any = null;
  try { parsed = JSON.parse(errText); } catch { /* raw text */ }

  if (
    (normProvider === 'freellmapi' || normProvider === 'openai')
    && mode !== 'keypool'
    && targetBase
    && isLoopbackUrl(targetBase)
    && (parsed?.code === 'LOOPBACK_UNREACHABLE' || /ECONNREFUSED|LOOPBACK_UNREACHABLE|fetch failed/i.test(errText))
  ) {
    const directModel = payload.voiceModel !== 'auto'
      ? (payload.voiceModel.includes(':') && !payload.voiceModel.includes('/') ? payload.voiceModel.split(':')[1] : payload.voiceModel)
      : 'tts-1';
    const hostVoiceMap: Record<string, string> = {
      kore: 'nova',
      zephyr: 'shimmer',
      aoede: 'alloy',
      puck: 'echo',
      charon: 'onyx',
      fenrir: 'fable',
    };
    const mappedVoice = hostVoiceMap[(voiceSettings?.host || '').toLowerCase()] || 'alloy';
    const directRes = await fetch(`${targetBase}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(targetKey ? { Authorization: `Bearer ${targetKey}` } : {}),
      },
      body: JSON.stringify({
        model: directModel,
        input: text.slice(0, 4000),
        voice: mappedVoice,
      }),
    });
    if (!directRes.ok) {
      const raw = await directRes.text().catch(() => '');
      throw new Error(`Local FreeLLMAPI TTS failed (${directRes.status}): ${raw.slice(0, 200) || directRes.statusText}`);
    }
    const buf = await directRes.arrayBuffer();
    const ct = (directRes.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim();
    return {
      audioBase64: arrayBufferToBase64(buf),
      mimeType: ct.startsWith('audio/') ? ct : 'audio/mpeg',
      model: directModel,
      routedVia: `browser-direct/${directModel}`,
    };
  }

  throw new Error(parsed?.error || `MAGGI TTS failed (${res.status}): ${errText.slice(0, 240)}`);
};

export interface MaskedEnvDefaultEntry {
  platform: string;
  label?: string;
  baseUrl?: string;
  enabled: boolean;
  hasKey: boolean;
  maskedKey: string;
  source: 'env';
}

export const fetchMaggiEnvDefaults = async (): Promise<{
  hasEnvPool: boolean;
  entries: MaskedEnvDefaultEntry[];
}> => {
  try {
    const res = await fetch('/api/maggi/defaults');
    if (!res.ok) return { hasEnvPool: false, entries: [] };
    const data = await res.json();
    return {
      hasEnvPool: !!data?.hasEnvPool,
      entries: Array.isArray(data?.entries) ? data.entries : [],
    };
  } catch {
    return { hasEnvPool: false, entries: [] };
  }
};
