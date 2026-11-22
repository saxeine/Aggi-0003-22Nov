/**
 * MAGGI server routes.
 *
 * Keeps every secret server-side while letting the browser drive the pipeline:
 *
 *   POST /api/maggi/chat         — unified chat completion (FreeLLMAPI / OpenAI-compatible / Ollama / Gemini)
 *   POST /api/maggi/chat-stream  — same, but SSE-streamed
 *   POST /api/maggi/embed        — embeddings via Gemini or /v1/embeddings
 *   POST /api/maggi/extract      — PDF / DOCX / URL → text
 *   POST /api/maggi/probe        — connectivity + model discovery
 *   GET  /api/maggi/health       — capability report for the dashboard
 *
 * FreeLLMAPI (https://github.com/tashfeenahmed/freellmapi) is OpenAI-compatible,
 * so one code path covers it plus llama.cpp / LM Studio / vLLM / OpenRouter.
 */

import express from 'express';

type Router = express.Router;
import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback, normalizeModel } from './gemini';
import {
  FREELLM_ENV,
  normaliseBaseUrl,
  validateBaseUrl,
  formatFetchError,
  withTimeout,
  FRIENDLY_ERROR,
  relayOpenAiStream,
  blockPrivateHost,
  parseEnvKeyPool,
  getMaskedEnvKeyPool,
  buildKeyPoolTargets,
  PLATFORM_TTS_DEFAULTS,
  isVoiceModelId,
  buildVoicePoolTargets,
  buildSequentialVoiceCandidates,
  formatVoiceModelKey,
  cleanTtsText,
  mapGeminiVoiceToOpenAi,
  detectAudioMimeType,
  addWavHeaderBuffer,
  concatWavBuffers,
  htmlToText,
} from './maggi/keyPool';

// ---------------------------------------------------------------------------
// router factory
// ---------------------------------------------------------------------------

export const createMaggiRouter = (): Router => {
  const router = express.Router();

  // Plain JSON body parser for the large-ish payloads the indexer sends.
  router.use(express.json({ limit: '60mb' }));

  // ---------------------------------------------------------------- health --
  router.get('/health', (_req, res) => {
    const envPool = parseEnvKeyPool();
    res.json({
      ok: true,
      freeLlmApiConfigured: !!(FREELLM_ENV.baseUrl || FREELLM_ENV.apiKey || envPool.length),
      freeLlmApiBaseUrl: FREELLM_ENV.baseUrl || null,
      hasEnvKey: !!FREELLM_ENV.apiKey,
      envKeyPoolCount: envPool.length,
      geminiAvailable: !!process.env.GEMINI_API_KEY,
      voiceTts: true,
      pdf: true,
      docx: true,
      urlFetch: true,
      version: 1,
    });
  });

  // Return masked server-side env defaults (never exposes raw secrets).
  router.get('/defaults', (_req, res) => {
    const entries = getMaskedEnvKeyPool();
    res.json({
      ok: true,
      hasEnvPool: entries.length > 0,
      entries,
    });
  });

  // ------------------------------------------------------------------ chat --
  const handleChat = async (req: express.Request, res: express.Response) => {
    const {
      provider = 'freellmapi',
      messages = [],
      model,
      temperature = 0.25,
      maxTokens = 1200,
      baseUrl,
      apiKey,
      freeLlmMode,
      keyPool,
      overwriteDefaults = false,
      stream = false,
    } = req.body ?? {};

    try {
      // ---- Built-in FreeLLMAPI Key-Pool Router (with automatic failover) ----
      if (provider === 'freellmapi' && (freeLlmMode === 'keypool' || (Array.isArray(keyPool) && keyPool.length > 0 && !baseUrl))) {
        const targets = buildKeyPoolTargets(keyPool, model || 'auto', !!overwriteDefaults);
        if (!targets.length) {
          res.status(400).json({
            error: 'No enabled FreeLLMAPI keys found in the key pool. Import your freellmapi-keys.json in MAGGI Settings.',
            code: 'EMPTY_KEY_POOL',
          });
          return;
        }

        const failures: string[] = [];
        for (const target of targets) {
          const timeout = withTimeout(stream ? 120_000 : 45_000);
          try {
            if (target.kind === 'google') {
              const ai = new GoogleGenAI({ apiKey: target.apiKey });
              const systemMsg = messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n\n');
              const contents = messages
                .filter((m: any) => m.role !== 'system')
                .map((m: any) => ({
                  role: m.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: m.content }],
                }));
              const isGemini4 = String(target.model || '').toLowerCase().startsWith('gemini-4-');
              const response = await ai.models.generateContent({
                model: target.model,
                contents,
                config: {
                  ...(!isGemini4 ? { temperature } : {}),
                  maxOutputTokens: maxTokens,
                  ...(systemMsg ? { systemInstruction: systemMsg } : {}),
                },
              });
              timeout.clear();
              const text = (response.text ?? '').trim();
              if (!text) {
                failures.push(`${target.platform} (${target.model}): empty response`);
                continue;
              }
              const routedVia = `google/${target.model}`;
              if (stream) {
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders?.();
                res.write(`data: ${JSON.stringify({ routedVia, model: target.model, delta: text })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              res.json({
                text,
                model: target.model,
                routedVia,
                usage: {
                  promptTokens: (response as any).usageMetadata?.promptTokenCount,
                  completionTokens: (response as any).usageMetadata?.candidatesTokenCount,
                },
              });
              return;
            }

            const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${target.apiKey}`,
                ...(target.extraHeaders ?? {}),
              },
              body: JSON.stringify({
                model: target.model,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: !!stream,
              }),
              signal: timeout.signal,
            });

            if (!upstream.ok) {
              const raw = await upstream.text().catch(() => '');
              timeout.clear();
              failures.push(`${target.platform}: HTTP ${upstream.status} ${raw.slice(0, 120)}`);
              continue;
            }

            const routedVia = `${target.platform}/${target.model}`;
            if (stream) {
              res.setHeader('x-routed-via', routedVia);
              await relayOpenAiStream(upstream, res, { model: target.model });
              timeout.clear();
              return;
            }

            const data = await upstream.json();
            timeout.clear();
            const rawText = data.choices?.[0]?.message?.content
              ?? data.choices?.[0]?.text
              ?? data.output?.[0]?.content?.[0]?.text
              ?? '';
            const resolvedText = (typeof rawText === 'string' ? rawText : JSON.stringify(rawText)).trim();
            if (!resolvedText) {
              failures.push(`${target.platform} (${target.model}): empty response`);
              continue;
            }
            res.json({
              text: resolvedText,
              model: data.model || target.model,
              routedVia,
              usage: data.usage
                ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
                : undefined,
            });
            return;
          } catch (err: any) {
            timeout.clear();
            failures.push(`${target.platform}: ${err?.message || 'failed'}`);
          }
        }

        res.status(502).json({
          error: `All FreeLLMAPI key-pool providers failed:\n• ${failures.join('\n• ')}`,
          code: 'KEY_POOL_EXHAUSTED',
        });
        return;
      }

      // ---- FreeLLMAPI proxy URL / any OpenAI-compatible endpoint ----
      if (provider === 'freellmapi' || provider === 'openai') {
        const resolvedBase = normaliseBaseUrl(
          baseUrl || (provider === 'freellmapi' ? FREELLM_ENV.baseUrl ?? '' : ''),
        );
        const resolvedKey = apiKey || (provider === 'freellmapi' ? FREELLM_ENV.apiKey ?? '' : '');

        if (!resolvedBase) {
          res.status(400).json({
            error: provider === 'freellmapi'
              ? 'FreeLLMAPI base URL is not configured. Start FreeLLMAPI (default http://localhost:3001) and set it in MAGGI Settings, or set FREELLMAPI_BASE_URL.'
              : 'OpenAI-compatible base URL is not configured.',
            code: 'NO_BASE_URL',
          });
          return;
        }

        const urlErr = validateBaseUrl(resolvedBase);
        if (urlErr) {
          res.status(400).json({ error: urlErr, code: 'INVALID_BASE_URL' });
          return;
        }

        const timeout = withTimeout(stream ? 180_000 : 120_000);
        let upstream: Response;
        try {
          upstream = await fetch(`${resolvedBase}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(resolvedKey ? { Authorization: `Bearer ${resolvedKey}` } : {}),
            },
            body: JSON.stringify({
              model: model || 'auto',
              messages,
              temperature,
              max_tokens: maxTokens,
              stream: !!stream,
            }),
            signal: timeout.signal,
          });
        } catch (fetchErr: any) {
          timeout.clear();
          const formatted = formatFetchError(fetchErr, resolvedBase);
          res.status(502).json({
            error: formatted.message,
            code: formatted.isLoopbackUnreachable ? 'LOOPBACK_UNREACHABLE' : 'UPSTREAM_FETCH_FAILED',
          });
          return;
        } finally {
          // timeout cleared once headers arrive; body streaming keeps its own lifetime
          if (!stream) timeout.clear();
        }

        if (!upstream.ok) {
          const raw = await upstream.text().catch(() => '');
          timeout.clear();
          res.status(upstream.status).json({ error: FRIENDLY_ERROR(upstream.status, raw) });
          return;
        }

        if (stream) {
          await relayOpenAiStream(upstream, res, { model });
          timeout.clear();
          return;
        }

        const data = await upstream.json();
        timeout.clear();
        const text = data.choices?.[0]?.message?.content
          ?? data.choices?.[0]?.text
          ?? data.output?.[0]?.content?.[0]?.text
          ?? '';
        res.json({
          text: typeof text === 'string' ? text : JSON.stringify(text),
          model: data.model || model,
          routedVia: upstream.headers.get('x-routed-via') || data.routed_via || undefined,
          usage: data.usage
            ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
            : undefined,
        });
        return;
      }

      // ---- Ollama (direct / remote tunnel) ----
      if (provider === 'ollama') {
        const cleanedBase = (baseUrl || 'http://localhost:11434')
          .replace(/[\s"'`<>]+/g, '')
          .replace(/^(https?):\/([^/])/i, '$1://$2')
          .replace(/\/(api\/tags|api\/chat|api\/generate|api|v1)$/i, '')
          .replace(/\/+$/, '');
        const resolvedBase = /^https?:\/\//i.test(cleanedBase) ? cleanedBase : `https://${cleanedBase}`;
        const hostCheck = blockPrivateHost(resolvedBase);
        if (hostCheck) {
          res.status(400).json({
            error: 'Server cannot reach private/localhost Ollama directly. Start a Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:11434`) and paste the `https://....trycloudflare.com` URL in MAGGI Settings.',
            code: 'LOOPBACK_UNREACHABLE',
          });
          return;
        }
        const timeout = withTimeout(120_000);
        let upstream: Response;
        try {
          upstream = await fetch(`${resolvedBase}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'aggrigator-ollama-proxy/1.0',
              'ngrok-skip-browser-warning': 'true',
              'bypass-tunnel-reminder': 'true',
            },
            body: JSON.stringify({
              model: model || 'llama3',
              messages,
              stream: false,
              options: { temperature, num_predict: maxTokens },
            }),
            redirect: 'manual',
            signal: timeout.signal,
          });
        } catch (fetchErr: any) {
          timeout.clear();
          const formatted = formatFetchError(fetchErr, resolvedBase);
          res.status(502).json({ error: formatted.message, code: 'UPSTREAM_FETCH_FAILED' });
          return;
        }
        timeout.clear();
        if (!upstream.ok) {
          const raw = await upstream.text().catch(() => '');
          res.status(upstream.status).json({ error: FRIENDLY_ERROR(upstream.status, raw) });
          return;
        }
        const rawText = await upstream.text();
        if (rawText.trim().startsWith('<')) {
          res.status(502).json({ error: 'Ollama endpoint returned HTML instead of JSON (tunnel warning or wrong URL).' });
          return;
        }
        const data = JSON.parse(rawText);
        res.json({
          text: data.message?.content ?? '',
          model: data.model || model,
          usage: {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count,
          },
        });
        return;
      }

      // ---- Gemini (existing key path, incl. per-request x-gemini-key) ----
      const key = (req.headers['x-gemini-key'] as string) || process.env.GEMINI_API_KEY;
      if (!key) {
        res.status(401).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
        return;
      }
      const ai = new GoogleGenAI({ apiKey: key });
      const systemMsg = messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n\n');
      const contents = messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const resolvedGeminiModel = normalizeModel((model && model.trim()) ? model.trim() : 'gemini-4-hydrogen');
      const isGemini4 = resolvedGeminiModel.toLowerCase().startsWith('gemini-4-');
      const response = await generateContentWithFallback(ai, {
        model: resolvedGeminiModel,
        contents,
        config: {
          ...(!isGemini4 ? { temperature } : {}),
          maxOutputTokens: maxTokens,
          ...(systemMsg ? { systemInstruction: systemMsg } : {}),
        },
      });

      res.json({
        text: response.text ?? '',
        model: resolvedGeminiModel,
        usage: {
          promptTokens: (response as any).usageMetadata?.promptTokenCount,
          completionTokens: (response as any).usageMetadata?.candidatesTokenCount,
        },
      });
    } catch (e: any) {
      const message = e?.name === 'AbortError' ? 'Request timed out.' : (e?.message || 'Unknown error');
      if (!res.headersSent) res.status(500).json({ error: message });
      else res.end();
    }
  };

  router.post('/chat', handleChat);
  router.post('/chat-stream', (req, res) => {
    req.body = { ...(req.body ?? {}), stream: true };
    return handleChat(req, res);
  });

  // ----------------------------------------------------------------- embed --
  router.post('/embed', async (req, res) => {
    const { texts = [], backend = 'gemini', model, baseUrl, apiKey } = req.body ?? {};
    if (!Array.isArray(texts) || !texts.length) {
      res.status(400).json({ error: 'texts[] is required' });
      return;
    }

    try {
      if (backend === 'openai') {
        const resolvedBase = normaliseBaseUrl(baseUrl || FREELLM_ENV.baseUrl || '');
        const resolvedKey = apiKey || FREELLM_ENV.apiKey || '';
        if (!resolvedBase) {
          res.status(400).json({ error: 'No base URL for embeddings.' });
          return;
        }
        const urlErr = validateBaseUrl(resolvedBase);
        if (urlErr) {
          res.status(400).json({ error: urlErr, code: 'INVALID_BASE_URL' });
          return;
        }
        let upstream: Response;
        try {
          upstream = await fetch(`${resolvedBase}/embeddings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(resolvedKey ? { Authorization: `Bearer ${resolvedKey}` } : {}),
            },
            body: JSON.stringify({ model: model || 'auto', input: texts }),
          });
        } catch (fetchErr: any) {
          const formatted = formatFetchError(fetchErr, resolvedBase);
          res.status(502).json({
            error: formatted.message,
            code: formatted.isLoopbackUnreachable ? 'LOOPBACK_UNREACHABLE' : 'UPSTREAM_FETCH_FAILED',
          });
          return;
        }
        if (!upstream.ok) {
          const raw = await upstream.text().catch(() => '');
          res.status(upstream.status).json({ error: FRIENDLY_ERROR(upstream.status, raw) });
          return;
        }
        const data = await upstream.json();
        const vectors = (data.data ?? [])
          .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
          .map((d: any) => d.embedding);
        res.json({ vectors, provider: 'freellmapi' });
        return;
      }

      // Gemini embeddings
      const key = (req.headers['x-gemini-key'] as string) || process.env.GEMINI_API_KEY;
      if (!key) {
        res.status(401).json({ error: 'GEMINI_API_KEY missing — MAGGI will fall back to the local hash embedder.' });
        return;
      }
      const ai = new GoogleGenAI({ apiKey: key });
      const embedModel = model || 'text-embedding-004';

      const response = await ai.models.embedContent({
        model: embedModel,
        contents: texts,
      } as any);

      const embeddings: any = (response as any).embeddings ?? [];
      const vectors = Array.isArray(embeddings)
        ? embeddings.map((e: any) => e.values ?? e.embedding?.values ?? [])
        : [];

      if (!vectors.length || !vectors[0]?.length) {
        res.status(502).json({ error: 'Gemini returned no embeddings for this model.' });
        return;
      }
      res.json({ vectors, provider: 'gemini', model: embedModel });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Embedding failed' });
    }
  });

  // --------------------------------------------------------------- extract --
  router.post('/extract', async (req, res) => {
    const { kind, data, name, url } = req.body ?? {};
    const warnings: string[] = [];

    try {
      if (kind === 'url') {
        const blocked = blockPrivateHost(url);
        if (blocked) {
          res.status(400).json({ error: blocked });
          return;
        }
        const timeout = withTimeout(25_000);
        const upstream = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MAGGI-RAG/1.0; +https://github.com/tashfeenahmed/freellmapi)',
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          },
          redirect: 'follow',
          signal: timeout.signal,
        });
        timeout.clear();
        if (!upstream.ok) {
          res.status(upstream.status).json({ error: `Fetch failed with ${upstream.status}` });
          return;
        }
        const contentType = upstream.headers.get('content-type') || '';
        const raw = await upstream.text();
        if (contentType.includes('text/html')) {
          const { text, title } = htmlToText(raw);
          res.json({ text, title: title || name, warnings });
        } else {
          res.json({ text: raw, title: name, warnings });
        }
        return;
      }

      if (!data) {
        res.status(400).json({ error: 'data (base64) is required' });
        return;
      }

      const buffer = Buffer.from(data, 'base64');

      if (kind === 'pdf') {
        try {
          const pdfModule: any = await import('pdf-parse');
          const PDFParse = pdfModule.PDFParse ?? pdfModule.default?.PDFParse;
          if (!PDFParse) throw new Error('pdf-parse did not expose PDFParse');
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          const result: any = await parser.getText();
          let text: string = result?.text ?? '';
          if (!text && Array.isArray(result?.pages)) {
            text = result.pages.map((p: any) => p.text).join('\n\n');
          }
          await parser.destroy?.();
          if (!text.trim()) warnings.push('No text layer found — this PDF is probably a scan. OCR is not enabled.');
          res.json({ text, warnings });
        } catch (e: any) {
          res.status(500).json({ error: `PDF parsing failed: ${e.message}`, warnings });
        }
        return;
      }

      if (kind === 'docx') {
        try {
          const mammoth: any = await import('mammoth');
          const result = await mammoth.default.extractRawText({ buffer });
          res.json({ text: result.value || '', warnings: result.messages?.map((m: any) => m.message) ?? [] });
        } catch (e: any) {
          res.status(500).json({ error: `DOCX parsing failed: ${e.message}` });
        }
        return;
      }

      // generic text
      res.json({ text: buffer.toString('utf-8'), warnings });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Extraction failed' });
    }
  });

  // ----------------------------------------------------------------- probe --
  router.post('/probe', async (req, res) => {
    const { provider = 'freellmapi', baseUrl, apiKey, freeLlmMode, keyPool, overwriteDefaults = false } = req.body ?? {};
    try {
      if (provider === 'ollama') {
        const cleanedBase = (baseUrl || 'http://localhost:11434')
          .replace(/[\s"'`<>]+/g, '')
          .replace(/^(https?):\/([^/])/i, '$1://$2')
          .replace(/\/(api\/tags|api\/chat|api\/generate|api|v1)$/i, '')
          .replace(/\/+$/, '');
        const base = /^https?:\/\//i.test(cleanedBase) ? cleanedBase : `https://${cleanedBase}`;
        const hostCheck = blockPrivateHost(base);
        if (hostCheck) {
          res.json({
            ok: false,
            code: 'LOOPBACK_UNREACHABLE',
            detail: 'Cannot probe localhost/private Ollama from cloud server. Run `cloudflared tunnel --url http://localhost:11434` and paste the https://....trycloudflare.com URL.',
          });
          return;
        }
        const timeout = withTimeout(10_000);
        const upstream = await fetch(`${base}/api/tags`, {
          headers: {
            'User-Agent': 'aggrigator-ollama-proxy/1.0',
            'ngrok-skip-browser-warning': 'true',
            'bypass-tunnel-reminder': 'true',
            Accept: 'application/json',
          },
          redirect: 'manual',
          signal: timeout.signal,
        });
        timeout.clear();
        if (!upstream.ok) {
          res.json({ ok: false, detail: `Ollama responded HTTP ${upstream.status}` });
          return;
        }
        const rawText = await upstream.text();
        if (rawText.trim().startsWith('<')) {
          res.json({ ok: false, detail: 'Endpoint returned HTML instead of Ollama JSON (tunnel warning or wrong URL).' });
          return;
        }
        const data = JSON.parse(rawText);
        const models = (data.models ?? []).map((m: any) => m.name).filter(Boolean);
        res.json({ ok: true, detail: `Ollama reachable — ${models.length} models`, models });
        return;
      }

      if (provider === 'gemini') {
        res.json({
          ok: !!process.env.GEMINI_API_KEY,
          detail: process.env.GEMINI_API_KEY ? 'Server Gemini key present' : 'No server Gemini key',
        });
        return;
      }

      // ---- Built-in FreeLLMAPI Key-Pool probe ----
      if (provider === 'freellmapi' && (freeLlmMode === 'keypool' || (Array.isArray(keyPool) && keyPool.length > 0 && !baseUrl))) {
        const targets = buildKeyPoolTargets(keyPool, 'auto', !!overwriteDefaults);
        if (!targets.length) {
          res.json({ ok: false, detail: 'No enabled keys in pool. Import freellmapi-keys.json above.' });
          return;
        }

        const results = await Promise.all(targets.map(async (target) => {
          const timeout = withTimeout(7000);
          try {
            if (target.kind === 'google') {
              const ai = new GoogleGenAI({ apiKey: target.apiKey });
              await ai.models.generateContent({
                model: target.model,
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                config: { maxOutputTokens: 1 },
              });
              timeout.clear();
              const voiceModels = (PLATFORM_TTS_DEFAULTS.google ?? []).map((m) => `google:${m}`);
              return { platform: target.platform, ok: true, models: target.defaultModels.map((m) => `google:${m}`), voiceModels };
            }

            const modelsRes = await fetch(`${target.baseUrl}/models`, {
              headers: {
                Authorization: `Bearer ${target.apiKey}`,
                ...(target.extraHeaders ?? {}),
              },
              signal: timeout.signal,
            });
            if (modelsRes.ok) {
              const data = await modelsRes.json();
              timeout.clear();
              let rawIds: string[] = (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean);
              if (target.platform === 'openrouter') {
                const freeIds = rawIds.filter((id) => id.includes(':free') || id === 'openrouter/free');
                rawIds = ['openrouter/free', ...freeIds, ...rawIds.filter((id) => !freeIds.includes(id))];
              }
              const discoveredVoice = rawIds.filter((id) => isVoiceModelId(id));
              const fallbackVoice = PLATFORM_TTS_DEFAULTS[target.platform] ?? [];
              const voiceModels = Array.from(new Set([...discoveredVoice, ...fallbackVoice])).map((m) => `${target.platform}:${m}`);
              const list = (rawIds.length ? rawIds.slice(0, 30) : target.defaultModels).map((m) => `${target.platform}:${m}`);
              return { platform: target.platform, ok: true, models: list, voiceModels };
            }

            // Some endpoints (e.g. Zhipu) don't expose GET /models — verify with a 1-token chat ping
            if (modelsRes.status === 404 || modelsRes.status === 405) {
              const pingRes = await fetch(`${target.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${target.apiKey}`,
                  ...(target.extraHeaders ?? {}),
                },
                body: JSON.stringify({
                  model: target.model,
                  messages: [{ role: 'user', content: 'hi' }],
                  max_tokens: 1,
                }),
                signal: timeout.signal,
              });
              timeout.clear();
              if (pingRes.ok) {
                const voiceModels = (PLATFORM_TTS_DEFAULTS[target.platform] ?? []).map((m) => `${target.platform}:${m}`);
                return { platform: target.platform, ok: true, models: target.defaultModels.map((m) => `${target.platform}:${m}`), voiceModels };
              }
              return { platform: target.platform, ok: false, error: `HTTP ${pingRes.status}`, models: [] as string[], voiceModels: [] as string[] };
            }

            timeout.clear();
            return { platform: target.platform, ok: false, error: `HTTP ${modelsRes.status}`, models: [] as string[], voiceModels: [] as string[] };
          } catch (err: any) {
            timeout.clear();
            return { platform: target.platform, ok: false, error: err?.message || 'failed', models: [] as string[], voiceModels: [] as string[] };
          }
        }));

        const ready = results.filter((r) => r.ok);
        const failed = results.filter((r) => !r.ok);
        const allModels = Array.from(new Set(ready.flatMap((r) => r.models))).slice(0, 200);
        const rawVoiceModels = ready.flatMap((r) => r.voiceModels || []);
        const geminiHeaderKey = (req.headers['x-gemini-key'] as string) || process.env.GEMINI_API_KEY;
        if (geminiHeaderKey && !rawVoiceModels.some((m) => m.startsWith('google:'))) {
          for (const gm of PLATFORM_TTS_DEFAULTS.google ?? []) {
            rawVoiceModels.push(`google:${gm}`);
          }
        }
        const voiceModels = Array.from(new Set(rawVoiceModels)).slice(0, 60);
        const readyNames = ready.map((r) => r.platform).join(', ');
        const failedNames = failed.map((r) => `${r.platform} (${r.error})`).join(', ');

        res.json({
          ok: ready.length > 0,
          detail: ready.length > 0
            ? `Key pool ready: ${ready.length}/${results.length} providers active (${readyNames})${failed.length ? ` · Failed: ${failedNames}` : ''}`
            : `No providers responded (${failedNames})`,
          models: allModels,
          voiceModels,
          providerResults: results.map(({ platform, ok, error }) => ({ platform, ok, error })),
        });
        return;
      }

      const base = normaliseBaseUrl(baseUrl || FREELLM_ENV.baseUrl || '');
      const key = apiKey || FREELLM_ENV.apiKey || '';
      if (!base) {
        res.json({
          ok: false,
          detail: 'No base URL. Start FreeLLMAPI (`npx freellmapi` → http://localhost:3001) and set it above, or switch to Key Pool mode.',
        });
        return;
      }

      const urlErr = validateBaseUrl(base);
      if (urlErr) {
        res.json({ ok: false, code: 'INVALID_BASE_URL', detail: urlErr });
        return;
      }

      const timeout = withTimeout(10_000);
      let upstream: Response;
      try {
        upstream = await fetch(`${base}/models`, {
          headers: key ? { Authorization: `Bearer ${key}` } : {},
          signal: timeout.signal,
        });
      } catch (fetchErr: any) {
        const formatted = formatFetchError(fetchErr, base);
        res.json({
          ok: false,
          code: formatted.isLoopbackUnreachable ? 'LOOPBACK_UNREACHABLE' : 'UPSTREAM_FETCH_FAILED',
          detail: formatted.message,
        });
        return;
      } finally {
        timeout.clear();
      }

      if (!upstream.ok) {
        const raw = await upstream.text().catch(() => '');
        res.json({ ok: false, detail: FRIENDLY_ERROR(upstream.status, raw) });
        return;
      }
      const data = await upstream.json();
      const models = (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean);
      const discoveredVoice = models.filter((id: string) => isVoiceModelId(id));
      const geminiFallbackKey = (req.headers['x-gemini-key'] as string) || process.env.GEMINI_API_KEY;
      const voiceModels = Array.from(new Set([
        ...discoveredVoice,
        ...(geminiFallbackKey ? (PLATFORM_TTS_DEFAULTS.google ?? []) : []),
      ])).slice(0, 60);
      res.json({
        ok: true,
        detail: `Connected — ${models.length} models available${key ? '' : ' (no key: anonymous providers only)'}`,
        models: models.slice(0, 200),
        voiceModels,
      });
    } catch (e: any) {
      res.json({
        ok: false,
        detail: e?.name === 'AbortError'
          ? 'Probe timed out — is FreeLLMAPI running on that port?'
          : (e?.message || 'Probe failed'),
      });
    }
  });

  // ------------------------------------------------------------------- tts --
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  interface SpeakerTurn {
    role: 'host' | 'expert' | 'guest';
    geminiSpeaker: 'SaxeIn' | 'Expert';
    text: string;
  }

  const parseSpeakerTurns = (text: string, voiceSettings: any = {}): SpeakerTurn[] => {
    const cleaned = cleanTtsText(text);
    if (!cleaned) return [];

    const hostAliases = Array.from(new Set(['Host', 'SaxeIn', voiceSettings?.hostLabel].filter(Boolean)));
    const expertAliases = Array.from(new Set(['Expert', voiceSettings?.expertLabel].filter(Boolean)));
    const guestAliases = Array.from(new Set(['Guest', voiceSettings?.guestLabel].filter(Boolean)));

    const patternList = [
      ...hostAliases.map((a) => ({ role: 'host' as const, alias: a })),
      ...expertAliases.map((a) => ({ role: 'expert' as const, alias: a })),
      ...guestAliases.map((a) => ({ role: 'guest' as const, alias: a })),
    ];

    const matches: { index: number; endIndex: number; role: 'host' | 'expert' | 'guest' }[] = [];
    for (const item of patternList) {
      const rx = new RegExp(`(?:^|\\n)\\s*${escapeRegex(String(item.alias))}\\s*:`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = rx.exec(cleaned)) !== null) {
        matches.push({ index: m.index, endIndex: m.index + m[0].length, role: item.role });
      }
    }
    matches.sort((a, b) => a.index - b.index);

    const turns: SpeakerTurn[] = [];
    if (matches.length > 0) {
      if (matches[0].index > 0) {
        const intro = cleaned.slice(0, matches[0].index).replace(/\s+/g, ' ').trim();
        if (intro) turns.push({ role: 'host', geminiSpeaker: 'SaxeIn', text: intro });
      }
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].endIndex;
        const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
        const chunk = cleaned.slice(start, end).replace(/\s+/g, ' ').trim();
        if (chunk) {
          const role = matches[i].role;
          turns.push({ role, geminiSpeaker: role === 'host' ? 'SaxeIn' : 'Expert', text: chunk });
        }
      }
    } else {
      const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
      sentences.forEach((sentence, idx) => {
        const role = idx % 2 === 0 ? 'host' : 'expert';
        turns.push({ role, geminiSpeaker: role === 'host' ? 'SaxeIn' : 'Expert', text: sentence.trim() });
      });
    }
    return turns;
  };

  const synthesizeViaGoogleTts = async (
    apiKey: string,
    model: string,
    text: string,
    speakers: number,
    voiceSettings: any = {},
  ): Promise<{ audioBase64: string; mimeType: string; model: string }> => {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const hostVoice = voiceSettings?.host || 'Kore';
    const expertVoice = voiceSettings?.expert || 'Puck';
    const cleaned = cleanTtsText(text);
    const turns = speakers >= 2 ? parseSpeakerTurns(cleaned, voiceSettings) : [];

    const config: any = {
      responseModalities: ['AUDIO'],
      httpOptions: { apiVersion: 'v1beta' },
    };

    let resolvedModel = model && model.toLowerCase().includes('tts')
      ? model
      : (speakers >= 2 ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts');
    let requestParts: any[] = [];

    if (speakers >= 2 && turns.length >= 2) {
      resolvedModel = model && model.toLowerCase().includes('flash-tts') ? model : 'gemini-3.8-flash-tts';
      config.speechConfig = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'SaxeIn', voiceConfig: { prebuiltVoiceConfig: { voiceName: hostVoice } } },
            { speaker: 'Expert', voiceConfig: { prebuiltVoiceConfig: { voiceName: expertVoice } } },
          ],
        },
      };
      requestParts = turns.map((t) => ({ text: `${t.geminiSpeaker}: ${t.text}` }));
    } else {
      config.speechConfig = {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: hostVoice } },
      };
      const hostEsc = escapeRegex(String(voiceSettings?.hostLabel || 'Host'));
      const langHint = voiceSettings?.language === 'Swedish' ? 'in Swedish' : 'in English';
      const strippedSingle = cleaned
        .replace(new RegExp(`(^|\\n)\\s*(${hostEsc}|Host|SaxeIn)\\s*:`, 'gim'), '$1')
        .replace(/\s+/g, ' ')
        .trim();
      const singleText = strippedSingle || cleaned;
      requestParts = [{ text: `TTS the following content ${langHint}:\n${singleText}` }];
    }

    const response = await generateContentWithFallback(ai, {
      model: resolvedModel,
      contents: [{ role: 'user', parts: requestParts }],
      config,
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    let rawAudioBase64: string | null = null;
    for (const part of parts) {
      if (part.inlineData?.data) {
        rawAudioBase64 = part.inlineData.data;
        break;
      }
    }
    if (!rawAudioBase64) {
      throw new Error('Google TTS returned no audio data.');
    }

    const buf = Buffer.from(rawAudioBase64, 'base64');
    const isRiff = buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'RIFF';
    const wavBuf = isRiff ? buf : addWavHeaderBuffer(buf);
    return {
      audioBase64: wavBuf.toString('base64'),
      mimeType: 'audio/wav',
      model: resolvedModel,
    };
  };

  const synthesizeOpenAiSpeechTurn = async (
    baseUrl: string,
    apiKey: string,
    model: string,
    input: string,
    voice: string,
    extraHeaders?: Record<string, string>,
    timeoutMs = 60_000,
  ): Promise<{ buffer: Buffer; mimeType: string }> => {
    const attempt = async (withFormat: boolean) => {
      const timeout = withTimeout(timeoutMs);
      try {
        return await fetch(`${baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(extraHeaders ?? {}),
          },
          body: JSON.stringify({
            model,
            input,
            voice,
            ...(withFormat ? { response_format: 'wav' } : {}),
          }),
          signal: timeout.signal,
        });
      } finally {
        timeout.clear();
      }
    };

    let upstream = await attempt(true);
    if (upstream.status === 400) {
      // Some OpenAI-compatible TTS proxies reject response_format='wav'; retry default format
      const retry = await attempt(false);
      if (retry.ok) upstream = retry;
    }

    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => '');
      throw new Error(`HTTP ${upstream.status} ${raw.slice(0, 180)}`);
    }

    const arrayBuf = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (!buffer.length) throw new Error('Empty audio buffer returned.');
    const mimeType = detectAudioMimeType(buffer, upstream.headers.get('content-type'));
    return { buffer, mimeType };
  };

  const synthesizeViaOpenAiTts = async (
    baseUrl: string,
    apiKey: string,
    model: string,
    text: string,
    speakers: number,
    voiceSettings: any = {},
    extraHeaders?: Record<string, string>,
  ): Promise<{ audioBase64: string; mimeType: string; model: string }> => {
    const cleaned = cleanTtsText(text);
    const hostVoice = mapGeminiVoiceToOpenAi(voiceSettings?.host);
    const expertVoice = mapGeminiVoiceToOpenAi(voiceSettings?.expert);
    const guestVoice = mapGeminiVoiceToOpenAi(voiceSettings?.guest);

    const roleVoice = (role: 'host' | 'expert' | 'guest') =>
      role === 'expert' ? expertVoice : role === 'guest' ? guestVoice : hostVoice;

    if (speakers >= 2) {
      const turns = parseSpeakerTurns(cleaned, voiceSettings).slice(0, 12);
      if (turns.length >= 2) {
        const first = await synthesizeOpenAiSpeechTurn(
          baseUrl,
          apiKey,
          model,
          turns[0].text.slice(0, 1000),
          roleVoice(turns[0].role),
          extraHeaders,
        );
        if (first.mimeType === 'audio/wav') {
          const turnBuffers: Buffer[] = [first.buffer];
          for (let i = 1; i < turns.length; i++) {
            const next = await synthesizeOpenAiSpeechTurn(
              baseUrl,
              apiKey,
              model,
              turns[i].text.slice(0, 1000),
              roleVoice(turns[i].role),
              extraHeaders,
            );
            turnBuffers.push(next.buffer);
          }
          const combined = concatWavBuffers(turnBuffers);
          if (combined) {
            return { audioBase64: combined.toString('base64'), mimeType: 'audio/wav', model };
          }
        } else {
          // Endpoint returned non-WAV (e.g. MP3); cannot concat MP3 frames safely cleanly without re-encode,
          // so synthesize the whole script with host voice for a clean playable single track.
          const singleAll = await synthesizeOpenAiSpeechTurn(
            baseUrl,
            apiKey,
            model,
            cleaned.slice(0, 4000),
            hostVoice,
            extraHeaders,
            90_000,
          );
          return { audioBase64: singleAll.buffer.toString('base64'), mimeType: singleAll.mimeType, model };
        }
      }
    }

    const hostEsc = escapeRegex(String(voiceSettings?.hostLabel || 'Host'));
    const strippedSingle = cleaned
      .replace(new RegExp(`(^|\\n)\\s*(${hostEsc}|Host|SaxeIn)\\s*:`, 'gim'), '$1')
      .replace(/\s+/g, ' ')
      .trim();
    const singleText = (strippedSingle || cleaned).slice(0, 4000);
    const single = await synthesizeOpenAiSpeechTurn(baseUrl, apiKey, model, singleText, hostVoice, extraHeaders, 90_000);
    return { audioBase64: single.buffer.toString('base64'), mimeType: single.mimeType, model };
  };

  const synthesizeViaCloudflareMeloTts = async (
    baseUrl: string,
    apiKey: string,
    model: string,
    text: string,
    voiceSettings: any = {},
  ): Promise<{ audioBase64: string; mimeType: string; model: string }> => {
    const cleaned = cleanTtsText(text).replace(/\s+/g, ' ').trim().slice(0, 2000);
    const runBase = baseUrl.replace(/\/v1\/?$/i, '');
    const runUrl = `${runBase}/run/${model}`;
    const timeout = withTimeout(60_000);
    try {
      const upstream = await fetch(runUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          prompt: cleaned,
          lang: voiceSettings?.language === 'Swedish' ? 'en' : 'en',
        }),
        signal: timeout.signal,
      });
      if (!upstream.ok) {
        const raw = await upstream.text().catch(() => '');
        throw new Error(`HTTP ${upstream.status} ${raw.slice(0, 180)}`);
      }
      const data: any = await upstream.json();
      const rawAudio: string = data?.result?.audio || '';
      if (!rawAudio) {
        throw new Error('Cloudflare MeloTTS returned no audio data.');
      }
      const buf = Buffer.from(rawAudio, 'base64');
      const mimeType = detectAudioMimeType(buf, 'audio/mpeg');
      return { audioBase64: buf.toString('base64'), mimeType, model };
    } finally {
      timeout.clear();
    }
  };

  router.post('/tts', async (req, res) => {
    const {
      provider = 'freellmapi',
      freeLlmMode,
      keyPool,
      overwriteDefaults = false,
      baseUrl,
      apiKey,
      voiceModel = 'auto',
      text = '',
      speakers = 1,
      voiceSettings = {},
    } = req.body ?? {};

    const rawText = String(text || req.body?.input || '');
    const normalizedTtsText = cleanTtsText(rawText) || rawText.trim();
    if (!normalizedTtsText) {
      res.status(400).json({ error: 'text is required for TTS synthesis (podcast script was empty).' });
      return;
    }

    const reqVoiceModel = String(voiceModel || 'auto').trim() || 'auto';
    const speakerCount = Number(speakers) || 1;
    const geminiFallbackKey = (req.headers['x-gemini-key'] as string) || process.env.GEMINI_API_KEY;
    const failures: string[] = [];

    try {
      // 1. FreeLLMAPI Key-Pool sequential voice routing (tries assigned model first, then next TTS in sequence)
      if (provider === 'freellmapi' && (freeLlmMode === 'keypool' || (Array.isArray(keyPool) && keyPool.length > 0 && !baseUrl))) {
        const candidates = buildSequentialVoiceCandidates(keyPool, reqVoiceModel, speakerCount, !!overwriteDefaults);
        for (const target of candidates) {
          try {
            if (target.kind === 'google') {
              const out = await synthesizeViaGoogleTts(target.apiKey, target.model, normalizedTtsText, speakerCount, voiceSettings);
              const assignedVoiceModel = formatVoiceModelKey('google', out.model);
              res.json({
                ...out,
                routedVia: `google/${out.model}`,
                assignedVoiceModel,
                fallbackUsed: failures.length > 0 || (reqVoiceModel !== 'auto' && assignedVoiceModel.toLowerCase() !== reqVoiceModel.toLowerCase()),
                ...(failures.length ? { attempted: failures } : {}),
              });
              return;
            }

            if (target.platform === 'cloudflare' && target.baseUrl.includes('/ai/')) {
              const out = await synthesizeViaCloudflareMeloTts(target.baseUrl, target.apiKey, target.model, normalizedTtsText, voiceSettings);
              const assignedVoiceModel = formatVoiceModelKey('cloudflare', out.model);
              res.json({
                ...out,
                routedVia: `cloudflare/${out.model}`,
                assignedVoiceModel,
                fallbackUsed: failures.length > 0 || (reqVoiceModel !== 'auto' && assignedVoiceModel.toLowerCase() !== reqVoiceModel.toLowerCase()),
                ...(failures.length ? { attempted: failures } : {}),
              });
              return;
            }

            const out = await synthesizeViaOpenAiTts(
              target.baseUrl,
              target.apiKey,
              target.model,
              normalizedTtsText,
              speakerCount,
              voiceSettings,
              target.extraHeaders,
            );
            const assignedVoiceModel = formatVoiceModelKey(target.platform, out.model);
            res.json({
              ...out,
              routedVia: `${target.platform}/${out.model}`,
              assignedVoiceModel,
              fallbackUsed: failures.length > 0 || (reqVoiceModel !== 'auto' && assignedVoiceModel.toLowerCase() !== reqVoiceModel.toLowerCase()),
              ...(failures.length ? { attempted: failures } : {}),
            });
            return;
          } catch (err: any) {
            failures.push(`${target.platform} (${target.model}): ${err?.message || 'failed'}`);
          }
        }
      } else if (provider === 'freellmapi' || provider === 'openai') {
        // 2. FreeLLMAPI Proxy URL or OpenAI-compatible /v1/audio/speech (sequential model fallback)
        const resolvedBase = normaliseBaseUrl(
          baseUrl || (provider === 'freellmapi' ? FREELLM_ENV.baseUrl ?? '' : ''),
        );
        const resolvedKey = apiKey || (provider === 'freellmapi' ? FREELLM_ENV.apiKey ?? '' : '');

        if (resolvedBase) {
          const urlErr = validateBaseUrl(resolvedBase);
          if (urlErr) {
            res.status(400).json({ error: urlErr, code: 'INVALID_BASE_URL' });
            return;
          }

          const requestedStripped = reqVoiceModel !== 'auto'
            ? (reqVoiceModel.includes(':') && !reqVoiceModel.includes('/') ? reqVoiceModel.split(':')[1] : reqVoiceModel)
            : '';
          const proxyModelSequence = Array.from(new Set([
            ...(requestedStripped ? [requestedStripped] : []),
            'tts-1',
            'gpt-4o-mini-tts',
            'tts-1-hd',
          ]));

          for (const proxyModel of proxyModelSequence) {
            try {
              const out = await synthesizeViaOpenAiTts(
                resolvedBase,
                resolvedKey,
                proxyModel,
                normalizedTtsText,
                speakerCount,
                voiceSettings,
              );
              res.json({
                ...out,
                routedVia: `freellmapi/${out.model}`,
                assignedVoiceModel: out.model,
                fallbackUsed: failures.length > 0,
                ...(failures.length ? { attempted: failures } : {}),
              });
              return;
            } catch (fetchErr: any) {
              const formatted = formatFetchError(fetchErr, resolvedBase);
              if (formatted.isLoopbackUnreachable && !geminiFallbackKey) {
                res.status(502).json({
                  error: formatted.message,
                  code: 'LOOPBACK_UNREACHABLE',
                });
                return;
              }
              failures.push(`proxy (${proxyModel}): ${formatted.message}`);
              if (formatted.isLoopbackUnreachable) break;
            }
          }
        } else if (!geminiFallbackKey) {
          res.status(400).json({
            error: 'FreeLLMAPI base URL or key pool is not configured for podcast voice synthesis.',
            code: 'NO_BASE_URL',
          });
          return;
        }
      }

      // 3. Server / Header Gemini TTS sequential fallback when earlier TTS providers failed or were absent
      if (geminiFallbackKey) {
        const geminiModels = speakerCount >= 2
          ? ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
          : ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
        const strippedReq = reqVoiceModel.includes(':') ? reqVoiceModel.split(':')[1] : reqVoiceModel;
        const seqModels = Array.from(new Set([
          ...(strippedReq && strippedReq.toLowerCase().includes('tts') && strippedReq.toLowerCase().includes('gemini') ? [strippedReq] : []),
          ...geminiModels,
        ]));

        for (const gm of seqModels) {
          try {
            const out = await synthesizeViaGoogleTts(
              geminiFallbackKey,
              gm,
              normalizedTtsText,
              speakerCount,
              voiceSettings,
            );
            const assignedVoiceModel = formatVoiceModelKey('google', out.model);
            res.json({
              ...out,
              routedVia: `server-gemini/${out.model}`,
              assignedVoiceModel,
              fallbackUsed: failures.length > 0 || (reqVoiceModel !== 'auto' && assignedVoiceModel.toLowerCase() !== reqVoiceModel.toLowerCase()),
              ...(failures.length ? { attempted: failures } : {}),
            });
            return;
          } catch (err: any) {
            failures.push(`server-gemini (${gm}): ${err?.message || 'failed'}`);
          }
        }
      }

      res.status(failures.length ? 502 : 400).json({
        error: failures.length
          ? `FreeLLMAPI podcast voice synthesis failed across sequence:\n• ${failures.join('\n• ')}`
          : 'No voice/TTS model or TTS-capable provider key is available in FreeLLMAPI.',
        code: 'TTS_FAILED',
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Podcast TTS synthesis failed' });
    }
  });

  return router;
};
