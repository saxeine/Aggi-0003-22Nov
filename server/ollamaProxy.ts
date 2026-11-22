/**
 * Server-side Ollama proxy — bypasses browser CORS & mixed-content for tunnels
 * such as Cloudflare Tunnel / ngrok and remote Ollama hosts.
 */
import express from 'express';

const normaliseOllamaEndpoint = (raw: string): string => {
  let cleaned = (raw || '').replace(/[\s"'`<>]+/g, '').replace(/\/+$/, '');
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^(https?):\/([^/])/i, '$1://$2');
  if (!/^https?:\/\//i.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cleaned);
    cleaned = `${isLocal || /:\d+/.test(cleaned) ? 'http' : 'https'}://${cleaned}`;
  }
  cleaned = cleaned.replace(/\/(api\/tags|api\/chat|api\/generate|api|v1)$/i, '').replace(/\/+$/, '');
  return cleaned;
};

const isBlockedOllamaHost = (rawHost: string): boolean => {
  let h = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  if (h.startsWith('::ffff:')) h = h.slice(7);
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

const validateRemoteOllamaUrl = (rawEndpoint: string): { ok: true; baseUrl: string } | { ok: false; code: string; detail: string } => {
  const baseUrl = normaliseOllamaEndpoint(rawEndpoint);
  if (!baseUrl) {
    return { ok: false, code: 'EMPTY_ENDPOINT', detail: 'Ollama endpoint URL is empty.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, code: 'INVALID_URL', detail: `Invalid Ollama URL "${baseUrl}". Expected https://your-tunnel.trycloudflare.com or http://host:11434.` };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, code: 'INVALID_PROTOCOL', detail: 'Only http:// and https:// URLs are supported.' };
  }
  if (isBlockedOllamaHost(parsed.hostname)) {
    return {
      ok: false,
      code: 'LOOPBACK_OR_PRIVATE',
      detail: 'Server proxy only forwards to public/tunnel URLs (e.g. https://....trycloudflare.com). Local addresses cannot be reached from the cloud server.',
    };
  }
  return { ok: true, baseUrl: `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '') };
};

export const createOllamaRouter = () => {
  const router = express.Router();

  router.post('/probe', async (req, res) => {
    const validation = validateRemoteOllamaUrl(String(req.body?.endpoint || ''));
    if (!validation.ok) {
      res.status(400).json(validation);
      return;
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const upstream = await fetch(`${validation.baseUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'User-Agent': 'aggrigator-ollama-proxy/1.0',
          'ngrok-skip-browser-warning': 'true',
          'bypass-tunnel-reminder': 'true',
          Accept: 'application/json',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (upstream.status >= 300 && upstream.status < 400) {
        res.status(502).json({
          ok: false,
          code: 'REDIRECT_BLOCKED',
          detail: `Endpoint responded with redirect (${upstream.status}). Paste the final direct https:// tunnel URL.`,
        });
        return;
      }

      const rawText = await upstream.text();
      if (rawText.trim().startsWith('<')) {
        res.status(502).json({
          ok: false,
          code: 'HTML_RESPONSE',
          detail: 'Endpoint returned an HTML page instead of Ollama JSON (tunnel warning or wrong URL). Verify the tunnel URL and that Ollama is running.',
        });
        return;
      }

      if (!upstream.ok) {
        res.status(upstream.status).json({
          ok: false,
          code: 'HTTP_ERROR',
          detail: `Ollama returned HTTP ${upstream.status}: ${rawText.slice(0, 200) || upstream.statusText}`,
        });
        return;
      }

      const parsed = JSON.parse(rawText);
      const models = Array.isArray(parsed?.models) ? parsed.models : [];
      const latencyMs = Date.now() - started;
      res.json({
        ok: true,
        models,
        latencyMs,
        detail: `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available (${latencyMs}ms)`,
      });
    } catch (err: any) {
      clearTimeout(timer);
      const detail = err?.name === 'AbortError'
        ? 'Connection timed out after 10s. Check that Ollama and your tunnel are running.'
        : (err?.cause?.message || err?.message || 'Could not reach the Ollama endpoint.');
      res.status(502).json({ ok: false, code: 'UPSTREAM_UNREACHABLE', detail });
    }
  });

  router.post('/chat', async (req, res) => {
    const { endpoint, model, messages, stream = true, options } = req.body ?? {};
    const validation = validateRemoteOllamaUrl(String(endpoint || ''));
    if (!validation.ok) {
      res.status(400).json(validation);
      return;
    }
    if (!model || typeof model !== 'string') {
      res.status(400).json({ ok: false, code: 'INVALID_MODEL', detail: 'Ollama model name is required.' });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ ok: false, code: 'INVALID_MESSAGES', detail: 'messages must be a non-empty array.' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    req.on('close', () => {
      clearTimeout(timer);
      controller.abort();
    });

    try {
      const upstream = await fetch(`${validation.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'aggrigator-ollama-proxy/1.0',
          'ngrok-skip-browser-warning': 'true',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({ model, messages, stream: !!stream, ...(Number.isInteger(options?.num_predict) && options.num_predict > 0 && options.num_predict <= 128 ? { options: { num_predict: options.num_predict } } : {}) }),
        redirect: 'manual',
        signal: controller.signal,
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        clearTimeout(timer);
        res.status(502).json({ ok: false, code: 'REDIRECT_BLOCKED', detail: 'Ollama endpoint returned a redirect.' });
        return;
      }

      if (!upstream.ok) {
        clearTimeout(timer);
        const raw = await upstream.text().catch(() => '');
        if (raw.trim().startsWith('<')) {
          res.status(502).json({ ok: false, code: 'HTML_RESPONSE', detail: 'Endpoint returned HTML instead of Ollama response (tunnel warning).' });
          return;
        }
        res.status(upstream.status).json({ ok: false, code: 'HTTP_ERROR', detail: raw.slice(0, 300) || `HTTP ${upstream.status}` });
        return;
      }

      if (!stream) {
        clearTimeout(timer);
        const text = await upstream.text();
        if (text.trim().startsWith('<')) {
          res.status(502).json({ ok: false, code: 'HTML_RESPONSE', detail: 'Endpoint returned HTML instead of Ollama JSON.' });
          return;
        }
        res.type('application/json').send(text);
        return;
      }

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const reader = upstream.body?.getReader();
      if (!reader) {
        clearTimeout(timer);
        res.end();
        return;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            res.write(Buffer.from(value));
          }
        }
      } finally {
        clearTimeout(timer);
        reader.releaseLock();
        res.end();
      }
    } catch (err: any) {
      clearTimeout(timer);
      if (!res.headersSent) {
        const detail = err?.name === 'AbortError'
          ? 'Ollama chat request timed out.'
          : (err?.cause?.message || err?.message || 'Failed to reach Ollama endpoint.');
        res.status(502).json({ ok: false, code: 'UPSTREAM_UNREACHABLE', detail });
      } else {
        res.end();
      }
    }
  });

  return router;
};
