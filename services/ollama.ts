import { MediaItem, Message } from "../types";

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export type OllamaErrorKind =
  | 'mixed_content'
  | 'html_response'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'parse_error';

export class OllamaError extends Error {
  constructor(
    public kind: OllamaErrorKind,
    message: string,
    public originalError?: any
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export interface OllamaTestResult {
  ok: boolean;
  detail: string;
  models: OllamaModel[];
  latencyMs: number;
  via: 'server-proxy' | 'vite-proxy' | 'browser-direct';
  normalizedEndpoint: string;
  kind?: OllamaErrorKind;
}

export const cleanOllamaEndpoint = (endpoint: string): string => {
  let cleaned = (endpoint || '').replace(/[\s"'`<>]+/g, '').replace(/\/+$/, '');
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^(https?):\/([^/])/i, '$1://$2');
  if (cleaned.startsWith('/')) return cleaned;
  if (!/^https?:\/\//i.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cleaned);
    cleaned = `${isLocal || /:\d+/.test(cleaned) ? 'http' : 'https'}://${cleaned}`;
  }
  cleaned = cleaned.replace(/\/(api\/tags|api\/chat|api\/generate|api|v1)$/i, '').replace(/\/+$/, '');
  return cleaned;
};

export const isLoopbackOrPrivateEndpoint = (endpoint: string): boolean => {
  const cleaned = cleanOllamaEndpoint(endpoint);
  if (!cleaned || cleaned.startsWith('/')) return true;
  try {
    const url = new URL(cleaned);
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      h === 'localhost'
      || h === '0.0.0.0'
      || h === '::1'
      || h.endsWith('.local')
      || h.endsWith('.internal')
      || /^127\./.test(h)
      || /^10\./.test(h)
      || /^192\.168\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
      || /^169\.254\./.test(h)
    );
  } catch {
    return false;
  }
};

const isBrowserHttps = (): boolean =>
  typeof window !== 'undefined' && window.location.protocol === 'https:';

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.trim().startsWith('<')) {
    throw new OllamaError('html_response', 'Endpoint returned HTML (Tunnel Warning or wrong URL). Open URL in browser to verify.');
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new OllamaError('parse_error', 'Failed to parse JSON response from Ollama.', err);
  }
}

const parseSafeJson = async (res: Response): Promise<{ json: any; rawText: string; isHtml: boolean }> => {
  const rawText = await res.text().catch(() => '');
  const trimmed = rawText.trim();
  const isHtml = trimmed.startsWith('<') || (res.headers.get('content-type') || '').includes('text/html');
  if (!trimmed || isHtml) {
    return { json: null, rawText, isHtml };
  }
  try {
    return { json: JSON.parse(rawText), rawText, isHtml: false };
  } catch {
    return { json: null, rawText, isHtml: false };
  }
};

const normaliseModelList = (rawModels: unknown): OllamaModel[] => {
  if (!Array.isArray(rawModels)) return [];
  return rawModels
    .map((m: any) =>
      typeof m === 'string'
        ? { name: m, modified_at: '', size: 0 }
        : {
            name: String(m?.name || m?.model || ''),
            modified_at: String(m?.modified_at || ''),
            size: Number(m?.size || 0),
          }
    )
    .filter((m) => Boolean(m.name));
};

const buildMixedContentHelp = (endpoint: string): string => {
  const inIframe = typeof window !== 'undefined' && window.self !== window.top;
  return (
    "**Ollama Connection Failed (Mixed Content / Local Loopback Blocked)**\n\n" +
    (inIframe
      ? `This app is running on **HTTPS inside an iframe**, so the browser blocks direct requests to local HTTP (\`${endpoint}\`) and the cloud server cannot reach your machine's localhost.\n\n`
      : `This app is running on **HTTPS**, and the browser blocked direct access to \`${endpoint}\`.\n\n`) +
    "**Fix 1 — HTTPS Tunnel (works inside preview, no CORS flags needed):**\n" +
    "1. Install `cloudflared` (or `ngrok`).\n" +
    "2. Run: `cloudflared tunnel --url http://localhost:11434`\n" +
    "3. Paste the `https://....trycloudflare.com` URL above and click **Test Connection**.\n\n" +
    "**Fix 2 — Open outside iframe (Chrome/Edge):**\n" +
    "Start Ollama with `OLLAMA_ORIGINS=\"*\" ollama serve`, open the app in a **New Tab**, and use `http://127.0.0.1:11434`."
  );
};

async function browserDirectFetch(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  timeoutMs = 90_000
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const isNgrok = baseUrl.toLowerCase().includes('ngrok');
  const mergedHeaders: Record<string, string> = {
    ...(isNgrok ? { 'ngrok-skip-browser-warning': 'true' } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const fetchOptions: RequestInit = {
    ...options,
    signal: controller.signal,
    mode: 'cors',
    referrerPolicy: 'no-referrer',
    ...(Object.keys(mergedHeaders).length > 0 ? { headers: mergedHeaders } : {}),
  };

  try {
    const res = await fetch(`${baseUrl}${path}`, fetchOptions);
    clearTimeout(timeoutId);
    if (!res.ok) {
      if ((res.status === 504 || res.status === 502 || res.status === 500) && baseUrl === '/ollama') {
        throw new OllamaError(
          'network',
          "**Ollama Connection Failed**\n\nThe local proxy could not reach Ollama at `http://localhost:11434`. Ensure `ollama serve` is running."
        );
      }
      throw new OllamaError('http_error', `Ollama API returned ${res.status}: ${res.statusText}`);
    }
    return res;
  } catch (err: any) {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) throw err;
    if (err instanceof OllamaError) throw err;
    if (err?.name === 'AbortError') {
      throw new OllamaError('timeout', `Ollama request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    if (isBrowserHttps() && baseUrl.startsWith('http://')) {
      throw new OllamaError('mixed_content', buildMixedContentHelp(baseUrl), err);
    }
    throw new OllamaError(
      'network',
      "**Ollama Connection Failed**\n\n" +
        `Could not reach \`${baseUrl}\` from the browser.\n\n` +
        "**Troubleshooting:**\n" +
        "1. Ensure Ollama is running (`OLLAMA_ORIGINS=\"*\" ollama serve`).\n" +
        "2. If using a tunnel, paste the full `https://....trycloudflare.com` URL and click **Test Connection**.",
      err
    );
  }
}

async function fetchLoopbackWithFallback(
  endpoint: string,
  path: string,
  options: RequestInit = {},
  timeoutMs = 90_000
): Promise<{ response: Response; via: 'vite-proxy' | 'browser-direct' }> {
  const cleaned = cleanOllamaEndpoint(endpoint) || 'http://localhost:11434';
  const isHttps = isBrowserHttps();

  // On local HTTP dev, try Vite proxy first for localhost:11434 / 127.0.0.1:11434
  if (!isHttps && (cleaned === 'http://localhost:11434' || cleaned === 'http://127.0.0.1:11434')) {
    try {
      const response = await browserDirectFetch('/ollama', path, options, timeoutMs);
      return { response, via: 'vite-proxy' };
    } catch {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // Fall through to direct loopback attempts
    }
  }

  try {
    const response = await browserDirectFetch(cleaned, path, options, timeoutMs);
    return { response, via: 'browser-direct' };
  } catch (err: any) {
    if (options.signal?.aborted) throw err;
    if (cleaned.includes('localhost')) {
      const fallbackUrl = cleaned.replace('localhost', '127.0.0.1');
      try {
        const response = await browserDirectFetch(fallbackUrl, path, options, timeoutMs);
        return { response, via: 'browser-direct' };
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

export const testOllamaConnection = async (endpoint: string): Promise<OllamaTestResult> => {
  const normalizedEndpoint = cleanOllamaEndpoint(endpoint) || 'http://localhost:11434';
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (!isLoopbackOrPrivateEndpoint(normalizedEndpoint)) {
    let serverDetail = '';
    let serverKind: OllamaErrorKind = 'network';

    // 1. Primary: /api/ollama/probe
    try {
      const proxyRes = await fetch('/api/ollama/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: normalizedEndpoint }),
      });
      const { json: payload, rawText, isHtml } = await parseSafeJson(proxyRes);
      const latencyMs = payload?.latencyMs ?? Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);

      if (proxyRes.ok && payload?.ok === true) {
        const models = normaliseModelList(payload.models);
        return {
          ok: true,
          detail: payload.detail || `Connected — ${models.length} models available (${latencyMs}ms)`,
          models,
          latencyMs,
          via: 'server-proxy',
          normalizedEndpoint,
        };
      }

      if (payload && typeof payload.ok === 'boolean') {
        serverDetail = payload.detail || `Server proxy returned HTTP ${proxyRes.status}`;
        serverKind =
          payload.code === 'HTML_RESPONSE'
            ? 'html_response'
            : payload.code === 'HTTP_ERROR'
              ? 'http_error'
              : 'network';
      } else {
        // Proxy route returned HTML (e.g. SPA fallback / stale preview build) or non-JSON; try MAGGI probe fallback next
        serverDetail = isHtml
          ? `Server proxy returned HTML (HTTP ${proxyRes.status})`
          : `Server proxy returned non-JSON HTTP ${proxyRes.status}${rawText ? `: ${rawText.slice(0, 120)}` : ''}`;

        try {
          const maggiRes = await fetch('/api/maggi/probe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'ollama', baseUrl: normalizedEndpoint }),
          });
          const { json: maggiJson } = await parseSafeJson(maggiRes);
          const maggiLatency = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
          if (maggiRes.ok && maggiJson?.ok === true) {
            const models = normaliseModelList(maggiJson.models);
            return {
              ok: true,
              detail: maggiJson.detail || `Connected — ${models.length} models available (${maggiLatency}ms)`,
              models,
              latencyMs: maggiLatency,
              via: 'server-proxy',
              normalizedEndpoint,
            };
          }
          if (maggiJson?.detail) {
            serverDetail = maggiJson.detail;
          }
        } catch {
          // Proceed to browser-direct fallback
        }
      }
    } catch (err: any) {
      serverDetail = err?.message || 'Server proxy request failed.';
    }

    // 2. Fallback for HTTPS endpoints: try browser-direct fetch (works whenever OLLAMA_ORIGINS="*" or CORS headers are present)
    if (normalizedEndpoint.startsWith('https://')) {
      try {
        const directRes = await browserDirectFetch(normalizedEndpoint, '/api/tags', { method: 'GET' }, 8000);
        const data = await parseJson<{ models: OllamaModel[] }>(directRes);
        const models = normaliseModelList(data.models);
        const directLatency = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
        return {
          ok: true,
          detail: `Connected directly — ${models.length} model${models.length === 1 ? '' : 's'} available (${directLatency}ms)`,
          models,
          latencyMs: directLatency,
          via: 'browser-direct',
          normalizedEndpoint,
        };
      } catch (directErr: any) {
        const directMsg = directErr instanceof Error ? directErr.message.split('\n')[0] : String(directErr);
        const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
        return {
          ok: false,
          detail: `${serverDetail}. Browser-direct check also failed (${directMsg}). Ensure Ollama is running and the tunnel URL is active.`,
          models: [],
          latencyMs,
          via: 'server-proxy',
          normalizedEndpoint,
          kind: serverKind,
        };
      }
    }

    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return {
      ok: false,
      detail: serverDetail || 'Could not reach Ollama via server proxy.',
      models: [],
      latencyMs,
      via: 'server-proxy',
      normalizedEndpoint,
      kind: serverKind,
    };
  }

  // Loopback / private host: try Vite proxy (if HTTP) or direct loopback fetch from browser
  try {
    const { response, via } = await fetchLoopbackWithFallback(normalizedEndpoint, '/api/tags', { method: 'GET' }, 7000);
    const data = await parseJson<{ models: OllamaModel[] }>(response);
    const models = normaliseModelList(data.models);
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return {
      ok: true,
      detail: `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available (${latencyMs}ms)`,
      models,
      latencyMs,
      via,
      normalizedEndpoint,
    };
  } catch (err: any) {
    const latencyMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    const kind: OllamaErrorKind = err instanceof OllamaError ? err.kind : 'network';
    console.warn(
      'Ollama connection test:',
      err instanceof Error ? err.message.split('\n')[0] : String(err)
    );
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      models: [],
      latencyMs,
      via: 'browser-direct',
      normalizedEndpoint,
      kind,
    };
  }
};

export const getOllamaModels = async (endpoint: string): Promise<OllamaModel[]> => {
  const result = await testOllamaConnection(endpoint);
  if (!result.ok) {
    throw new OllamaError(result.kind || 'network', result.detail);
  }
  return result.models;
};

export const generateOllamaResponse = async function* (
  endpoint: string,
  modelName: string,
  currentPrompt: string,
  history: Message[],
  mediaItems: MediaItem[],
  options?: { signal?: AbortSignal; maxTokens?: number },
): AsyncGenerator<string, void, unknown> {
  const images = mediaItems
    .filter((item) => item.type === "image")
    .map((item) => item.data);

  const otherFiles = mediaItems.filter(item => item.type !== 'image' && item.type !== 'text');
  let promptContext = currentPrompt;

  if (otherFiles.length > 0) {
    promptContext += `\n\n[Note: The user also attached the following files which you cannot see directly: ${otherFiles.map(f => f.name).join(', ')}]`;
  }

  const textFiles = mediaItems.filter(item => item.type === 'text' || item.type === 'link' || item.type === 'document' || item.type === 'sql');
  if (textFiles.length > 0) {
    promptContext += "\n\nAttached Content:\n";
    textFiles.forEach(f => {
      promptContext += `--- ${f.name} ---\n${f.data}\n\n`;
    });
  }

  const messages = history.map((msg) => ({
    role: msg.role === "model" ? "assistant" : "user",
    content: msg.content,
  }));

  messages.unshift({
    role: "system",
    content: "Do NOT start your replies with phrases like 'Based on the provided report,' or 'Based on the provided sources,'. Just answer the question directly.",
  } as any);

  messages.push({
    role: "user",
    content: promptContext,
    images: images.length > 0 ? images : undefined,
  } as any);

  const normalizedEndpoint = cleanOllamaEndpoint(endpoint) || 'http://localhost:11434';
  let response: Response | null = null;

  if (!isLoopbackOrPrivateEndpoint(normalizedEndpoint)) {
    const proxyRes = await fetch('/api/ollama/chat', {
      method: 'POST',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: normalizedEndpoint,
        model: modelName,
        messages,
        stream: true,
        ...(options?.maxTokens ? { options: { num_predict: options.maxTokens } } : {}),
      }),
    });

    const contentType = (proxyRes.headers.get('content-type') || '').toLowerCase();
    const looksLikeHtmlProxy = contentType.includes('text/html');

    if (proxyRes.ok && !looksLikeHtmlProxy) {
      response = proxyRes;
    } else {
      const errBody = looksLikeHtmlProxy
        ? { detail: `Server proxy returned HTML (HTTP ${proxyRes.status})` }
        : await proxyRes.json().catch(async () => ({ detail: await proxyRes.text().catch(() => '') }));

      // Try browser-direct for https:// endpoints if proxy was unreachable or returned HTML
      if (normalizedEndpoint.startsWith('https://')) {
        try {
          response = await browserDirectFetch(normalizedEndpoint, '/api/chat', {
            method: 'POST',
            signal: options?.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, messages, stream: true, ...(options?.maxTokens ? { options: { num_predict: options.maxTokens } } : {}) }),
          });
        } catch {
          if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          // Fall through to MAGGI non-streaming relay
        }
      }

      if (!response) {
        const maggiRes = await fetch('/api/maggi/chat', {
          method: 'POST',
          signal: options?.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'ollama',
            baseUrl: normalizedEndpoint,
            model: modelName,
            messages,
            ...(options?.maxTokens ? { maxTokens: options.maxTokens } : {}),
          }),
        });
        const { json: maggiJson } = await parseSafeJson(maggiRes);
        if (maggiRes.ok && typeof maggiJson?.text === 'string') {
          yield maggiJson.text;
          return;
        }
        const kind: OllamaErrorKind =
          errBody?.code === 'HTML_RESPONSE' || looksLikeHtmlProxy
            ? 'html_response'
            : proxyRes.status >= 400 && proxyRes.status < 500
              ? 'http_error'
              : 'network';
        throw new OllamaError(kind, maggiJson?.error || errBody?.detail || `Ollama proxy returned HTTP ${proxyRes.status}`);
      }
    }
  } else {
    const result = await fetchLoopbackWithFallback(normalizedEndpoint, '/api/chat', {
      method: "POST",
      signal: options?.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        ...(options?.maxTokens ? { options: { num_predict: options.maxTokens } } : {}),
      }),
    });
    response = result.response;
  }

  if (!response?.body) {
    throw new OllamaError('parse_error', 'No response body from Ollama.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFirstChunk = true;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkText = decoder.decode(value, { stream: true });

      if (isFirstChunk) {
        isFirstChunk = false;
        if (chunkText.trim().startsWith('<')) {
          throw new OllamaError('html_response', 'Endpoint returned HTML (Tunnel Warning). Open URL in browser.');
        }
      }

      buffer += chunkText;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              yield data.message.content;
            }
          } catch {
            console.warn('Failed to parse NDJSON line:', line);
          }
        }
      }
    }
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.message?.content) {
          yield data.message.content;
        }
      } catch {
        console.warn('Failed to parse NDJSON line:', buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export const generateOllamaSuggestions = async (
  endpoint: string,
  modelName: string,
  mediaItems: MediaItem[]
): Promise<string[]> => {
  const images = mediaItems.filter((item) => item.type === "image").map((item) => item.data);
  const textFiles = mediaItems.filter(item => item.type === 'text' || item.type === 'link' || item.type === 'document' || item.type === 'sql');

  let content = "Analyze the available context and list 3 short, insightful questions a user might want to ask. Return ONLY the questions as a JSON array string e.g. [\"Q1\", \"Q2\", \"Q3\"].";

  if (textFiles.length > 0) {
    content += "\n\nContext:\n" + textFiles.map(f => f.data).join("\n\n");
  }

  const messages = [{
    role: "user",
    content,
    images: images.length > 0 ? images : undefined,
  }];

  try {
    const normalizedEndpoint = cleanOllamaEndpoint(endpoint) || 'http://localhost:11434';
    let response: Response;

    if (!isLoopbackOrPrivateEndpoint(normalizedEndpoint)) {
      response = await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: normalizedEndpoint,
          model: modelName,
          messages,
          stream: false,
        }),
      });
      const ct = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || ct.includes('text/html')) {
        if (normalizedEndpoint.startsWith('https://')) {
          response = await browserDirectFetch(normalizedEndpoint, '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, messages, stream: false, format: 'json' }),
          });
        } else {
          return [];
        }
      }
    } else {
      const result = await fetchLoopbackWithFallback(normalizedEndpoint, '/api/chat', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: false,
          format: "json",
        }),
      });
      response = result.response;
    }

    const data = await parseJson<any>(response);
    const resultText = data.message?.content || '';

    try {
      const parsed = JSON.parse(resultText);
      if (Array.isArray(parsed)) return parsed.slice(0, 3);
      if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions.slice(0, 3);
      return [];
    } catch {
      return resultText.match(/"([^"]+)"/g)?.map((s: string) => s.replace(/"/g, '')).slice(0, 3) || [];
    }
  } catch (error) {
    console.warn("Ollama suggestion failed", error);
    return [];
  }
};
