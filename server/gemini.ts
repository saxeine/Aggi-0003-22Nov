/**
 * Gemini-backed routes + shared helpers (client, retry queue, model routing).
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { isBlockedIpOrHost } from './maggi/keyPool';

// Initialize Gemini
export const getAiClient = (req?: express.Request) => {
  const customKey = req?.headers['x-gemini-key'] as string;
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in the environment. Please add it to your settings.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Helper to format Gemini errors for the frontend
export const formatGeminiError = (error: any) => {
  let msg = error.message || String(error);

  // Clean up "ApiError: " prefix if it exists
  if (msg.startsWith('ApiError: ')) {
    msg = msg.substring(9);
  }

  if (msg.includes('API key not valid')) {
    return 'Invalid API Key. Please check your GEMINI_API_KEY in settings.';
  }

  if (msg.includes("GenerateRequestsPerDay") || msg.includes("free_tier_requests") || msg.includes("Daily quota")) {
    return 'Gemini API Daily Quota Exceeded. Wait a moment, try a lower-quota model, select a billing-enabled API key in Settings > Secrets, or switch AI Engine to MAGGI / Ollama in Settings.';
  }

  if (msg.toLowerCase().includes('quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Gemini API Quota Exceeded (429 Resource Exhausted). If you are using a free tier or paid-only model, select a billing-enabled API key in Settings > Secrets, wait a moment, or switch AI Engine to MAGGI / Ollama in Settings.';
  }

  if (msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('DeadlineExceeded')) {
    return 'Gemini Service is temporarily overloaded. Please try again in a few moments.';
  }

  // Try to parse JSON if the error message is a stringified object
  try {
    const jsonStart = msg.indexOf('{');
    if (jsonStart !== -1) {
      const potentialJson = msg.substring(jsonStart);
      const parsed = JSON.parse(potentialJson);
      if (parsed.error?.message) return parsed.error.message;
    }
  } catch (e) {}

  return msg || 'An unknown error occurred with the Gemini API';
};

let lastRequestTime = 0;
const MIN_REQUEST_SPACING = 300; // Lightweight spacing to avoid burst spikes without stalling UI
const queue: (() => Promise<void>)[] = [];
let activeRequests = 0;
const MAX_CONCURRENT = 3;

const processQueue = () => {
  while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
    activeRequests++;
    const task = queue.shift();
    task?.();
  }
};

export const runInQueue = async <T>(fn: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    const task = async () => {
      const now = Date.now();
      const timeSinceLast = now - lastRequestTime;
      if (timeSinceLast < MIN_REQUEST_SPACING) {
        const delay = MIN_REQUEST_SPACING - timeSinceLast;
        await new Promise(res => setTimeout(res, delay));
      }
      lastRequestTime = Date.now();
      try {
        const result = await fn();
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        activeRequests--;
        processQueue();
      }
    };

    queue.push(task);
    processQueue();
  });
};

const summarizeTransientReason = (msg: string): string => {
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded') || msg.includes('high demand')) {
    return 'service temporarily busy (503)';
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return 'rate limited (429)';
  }
  if (msg.includes('500') || msg.includes('Internal error')) {
    return 'upstream server issue (500)';
  }
  return 'transient upstream issue';
};

// Retry wrapper for API calls
export const callWithRetry = async <T>(fn: () => Promise<T>, retries = 1, delay = 800): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error.message || JSON.stringify(error) || "";

    // Attempt to extract retry delay from error details if available (capped to avoid long stalls)
    let retryDelay = delay;
    if (error && error.details) {
      const retryInfo = error.details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
      if (retryInfo && retryInfo.retryDelay) {
        const seconds = parseFloat(retryInfo.retryDelay);
        if (!Number.isNaN(seconds) && seconds > 0) {
          retryDelay = Math.min(seconds * 1000, 3000);
        }
      }
    }

    // Check if the message indicates a non-transient quota/billing limit
    const isHardQuotaExceeded = msg.includes("GenerateRequestsPerDay") ||
                                 msg.includes("free_tier_requests") ||
                                 msg.includes("exceeded your current quota") ||
                                 msg.includes("check your plan and billing details") ||
                                 msg.includes("limit: 20") ||
                                 msg.includes("limit: 0");

    if (isHardQuotaExceeded) {
      throw error;
    }

    const isModelOverloaded = msg.includes("503") ||
                              msg.includes("UNAVAILABLE") ||
                              msg.includes("overloaded") ||
                              msg.includes("high demand");

    // We retry on transient rate limits (429) AND service overloaded (503/500)
    const isRetriable = isModelOverloaded ||
                         msg.includes("429") ||
                         msg.includes("RESOURCE_EXHAUSTED") ||
                         msg.includes("quota") ||
                         msg.includes("500") ||
                         msg.includes("Internal error");

    if (retries > 0 && isRetriable) {
      const waitMs = isModelOverloaded ? Math.min(retryDelay, 600) : retryDelay;
      console.info(`[Gemini] Transient ${summarizeTransientReason(msg)}; retrying in ${Math.round(waitMs)}ms (${retries} remaining).`);
      await new Promise(res => setTimeout(res, waitMs));
      const nextDelay = retryDelay * 1.5 + Math.random() * 500;
      return callWithRetry(fn, retries - 1, nextDelay);
    }
    throw error;
  }
};

// Robust Generate Content helper with valid-model fallback
export const generateContentWithFallback = async (
  ai: ReturnType<typeof getAiClient>,
  params: any,
  retries = 1,
  delay = 600
): Promise<any> => {
  const originalModel = params.model || "";
  try {
    return await runInQueue(async () => await callWithRetry(async () => {
      return await ai.models.generateContent(sanitizeGeminiParams(params));
    }, retries, delay));
  } catch (error: any) {
    const msg = error.message || JSON.stringify(error) || "";
    const isPaidOnlyModel = ['gemini-4-neon', 'gemini-4-argon', 'gemini-4-carbon'].includes(String(originalModel).toLowerCase());
    const isHardBillingQuota = msg.includes("exceeded your current quota") || msg.includes("check your plan and billing details");

    // If the account/project quota itself is exhausted on a free-tier model, fail fast instead of cascading retries
    if (isHardBillingQuota && !isPaidOnlyModel) {
      throw error;
    }

    const isServiceIssue = msg.includes("503") ||
                           msg.includes("UNAVAILABLE") ||
                           msg.includes("overloaded") ||
                           msg.includes("high demand") ||
                           msg.includes("Service Unavailable") ||
                           msg.includes("DeadlineExceeded") ||
                           msg.includes("Internal error") ||
                           msg.includes("500") ||
                           msg.includes("429") ||
                           msg.includes("RESOURCE_EXHAUSTED") ||
                           msg.includes("quota") ||
                           msg.includes("QuotaExceeded") ||
                           msg.includes("404") ||
                           msg.includes("NOT_FOUND");

    if (isServiceIssue) {
      const normOriginal = String(originalModel).toLowerCase();
      const isTtsRequest = normOriginal.includes('-tts')
        || Boolean(params?.config?.speechConfig)
        || (Array.isArray(params?.config?.responseModalities)
          && params.config.responseModalities.some((m: any) => String(m).toUpperCase() === 'AUDIO'));
      const isMultiSpeakerTts = Boolean(params?.config?.speechConfig?.multiSpeakerVoiceConfig);

      const fallbackCandidates = isTtsRequest
        ? (isMultiSpeakerTts ? ['gemini-3.8-flash-tts'] : ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'])
        : ['gemini-3.1-flash-lite', 'gemini-4-hydrogen', 'gemini-3.1-pro-preview'];

      for (const fallbackModel of fallbackCandidates) {
        if (fallbackModel !== originalModel) {
          console.info(`[Routing] Model ${originalModel} unavailable (${summarizeTransientReason(msg)}). Falling back to ${fallbackModel}.`);
          try {
            const fallbackParams = sanitizeGeminiParams({ ...params, model: fallbackModel });
            return await runInQueue(async () => await callWithRetry(async () => {
              return await ai.models.generateContent(fallbackParams);
            }, 1, 500));
          } catch (fbErr: any) {
            console.info(`[Routing] Fallback model ${fallbackModel} unavailable: ${formatGeminiError(fbErr)}`);
          }
        }
      }
    }
    throw error;
  }
};

// Sanitize per-model parameters & route TTS/preview/image calls through v1beta (speechConfig is v1beta-only)
const sanitizeGeminiParams = (params: any): any => {
  if (!params || typeof params !== 'object') return params;
  const model = String(params.model || '').toLowerCase();
  const baseConfig = (params.config && typeof params.config === 'object') ? params.config : {};

  const isTtsModel = model.includes('-tts');
  const isLiveModel = model.includes('-live');
  const hasSpeechConfig = Boolean(baseConfig.speechConfig);
  const hasAudioModality = Array.isArray(baseConfig.responseModalities)
    && baseConfig.responseModalities.some((m: any) => String(m).toUpperCase() === 'AUDIO');

  const needsV1Beta = isTtsModel
    || isLiveModel
    || hasSpeechConfig
    || hasAudioModality
    || model.includes('-image')
    || model.includes('nano-banana')
    || model.includes('preview');

  if (!params.config && !needsV1Beta) {
    return params;
  }

  const nextConfig: any = { ...baseConfig };

  // Never forward speechConfig or AUDIO response modality to text-only models
  if (!isTtsModel && !isLiveModel) {
    delete nextConfig.speechConfig;
    if (Array.isArray(nextConfig.responseModalities)) {
      const filtered = nextConfig.responseModalities.filter(
        (m: any) => String(m).toUpperCase() !== 'AUDIO'
      );
      if (filtered.length > 0) {
        nextConfig.responseModalities = filtered;
      } else {
        delete nextConfig.responseModalities;
      }
    }
  }

  // @google/genai v3 defaults to v1, where generation_config.speechConfig is unavailable; use v1beta
  if (needsV1Beta) {
    nextConfig.httpOptions = {
      apiVersion: 'v1beta',
      ...(nextConfig.httpOptions && typeof nextConfig.httpOptions === 'object' ? nextConfig.httpOptions : {}),
    };
  }

  // Strip parameters unsupported by Gemini 4 models
  if (model.startsWith('gemini-4-')) {
    delete nextConfig.temperature;
    delete nextConfig.topP;
    delete nextConfig.topK;
    delete nextConfig.candidateCount;
    if (nextConfig.thinkingConfig && typeof nextConfig.thinkingConfig === 'object') {
      const tc = { ...nextConfig.thinkingConfig };
      delete tc.thinkingBudget;
      if (Object.keys(tc).length === 0) {
        delete nextConfig.thinkingConfig;
      } else {
        nextConfig.thinkingConfig = tc;
      }
    }
  }

  return { ...params, config: nextConfig };
};

// Normalize model names to production-ready versions
export const normalizeModel = (model: string): string => {
  if (!model || !model.trim()) return 'gemini-4-hydrogen';
  const trimmed = model.trim();
  const norm = trimmed.toLowerCase();

  // Exact valid latest models pass through untouched
  if (
    norm === 'gemini-4-hydrogen' ||
    norm === 'gemini-4-neon' ||
    norm === 'gemini-4-argon' ||
    norm === 'gemini-4-carbon' ||
    norm === 'gemini-3.1-flash-lite' ||
    norm === 'gemini-3.1-pro-preview' ||
    norm.includes('-tts') ||
    norm.includes('-image') ||
    norm.includes('nano-banana') ||
    norm.includes('-live') ||
    norm.includes('-transcribe') ||
    norm.includes('embedding')
  ) {
    return trimmed;
  }

  if (
    norm.includes('gemini-3.8-flash') ||
    norm.includes('gemini-flash-latest') ||
    norm.includes('gemini-3.5-flash') ||
    norm.includes('gemini-3-flash') ||
    norm.includes('gemini-2.5-flash') ||
    norm.includes('gemini-2.0-flash') ||
    norm.includes('gemini-1.5-flash') ||
    norm.includes('gemini-flash') ||
    norm === 'flash'
  ) {
    return 'gemini-4-hydrogen';
  }

  if (
    norm.includes('gemini-3-pro') ||
    norm.includes('gemini-2.5-pro') ||
    norm.includes('gemini-2.0-pro') ||
    norm.includes('gemini-1.5-pro') ||
    norm.includes('gemini-pro') ||
    norm === 'pro'
  ) {
    return 'gemini-4-neon';
  }

  if (norm.includes('flash-lite') || norm.includes('lite')) {
    return 'gemini-3.1-flash-lite';
  }

  return trimmed;
};

export const createGeminiRouter = () => {
  const router = express.Router();

  router.post('/generate-script', async (req, res) => {
    try {
      const { slides, folderName } = req.body;
      if (!slides || !Array.isArray(slides)) {
        return res.status(400).json({ error: 'Invalid slides payload' });
      }

      const ai = getAiClient(req);

      const prompt = `You are an expert Hollywood screenplay writer.
Write a highly polished, professional, standard-format Screenplay Script based on this storyboard sequence titled "${folderName || 'My Storyboard'}".

The storyboard slides are:
${JSON.stringify(slides, null, 2)}

Format Instructions:
1. Write in standard professional screenplay format:
   - Scene Headings: e.g., "INT. COFFEE SHOP - DAY" (All Caps, bold, spaced)
   - Action Descriptions: Normal descriptive text.
   - Character Names: ALL CAPS on their own line (e.g., "HERO") before their dialogue.
   - Dialogue: Spoken words, indented.
   - Parenthetical cues: e.g. "(nervously)"
2. Correlate and integrate the storyboard frames. For EACH slide, insert a clear marker tag in the script on its own line:
   "[Frame: Scene X, Shot Y]"
   where X is the scene number and Y is the shot number. Place this marker exactly at the beat where the slide's visual direction should occur.
3. Be descriptive, cinematic, and dramatic. Ensure the screenplay reads beautifully and maintains the exact visual details, action directions, and audio cues provided in the slides.
4. Output only the plain script content, no wrapping markdown blocks (like \`\`\`fountain or \`\`\`text) or conversational text.`;

      const response = await generateContentWithFallback(ai, {
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      res.json({ script: response.text });
    } catch (err: any) {
      console.error('Gemini generate script error:', err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  router.post('/extract-frames', async (req, res) => {
    try {
      const { scriptText } = req.body;
      if (!scriptText || typeof scriptText !== 'string') {
        return res.status(400).json({ error: 'No script text provided' });
      }

      const ai = getAiClient(req);

      const prompt = `You are an expert film director and storyboard artist.
Analyze the following screenplay script and break it down into a sequence of individual storyboard slides/frames.

Script:
${scriptText}

Extract up to 10 sequential cinematic frames from this script. For each frame, provide:
- sceneNo: number (the scene number from the script, starting at 1)
- shotNo: number (the sequential shot number within that scene, starting at 1)
- shotType: string (one of: 'WS', 'MS', 'CU', 'ECU', 'OTS', 'POV', 'INSERT', 'EST', 'TWO')
- duration: number (estimated screen duration in milliseconds, e.g. 3000 for 3 seconds)
- action: string (detailed camera direction, character movement, framing, or visual action)
- dialogue: string (the character dialogue or voiceover or crucial audio cue spoken in this shot)
- notes: string (notes about lighting, lens choice, emotional tone, or camera movement)

Output your response strictly as a JSON array of objects with the exact schema. Do not wrap the JSON in markdown code blocks like \`\`\`json. Output nothing else but the pure parsable JSON array.
Each object must have the fields: "sceneNo", "shotNo", "shotType", "duration", "action", "dialogue", "notes".`;

      const response = await generateContentWithFallback(ai, {
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json'
        }
      });

      let cleanText = response.text || '';
      cleanText = cleanText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

      try {
        const parsed = JSON.parse(cleanText);
        res.json({ frames: parsed });
      } catch (parseErr) {
        console.error('Failed to parse JSON response from Gemini:', cleanText);
        res.status(500).json({
          error: 'Failed to parse extracted frames from AI response.',
          rawResponse: cleanText
        });
      }
    } catch (err: any) {
      console.error('Gemini extract frames error:', err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  router.post('/bring-to-life', async (req, res) => {
    try {
      const { prompt, imageBase64, mimeType, modelName = 'gemini-4-hydrogen' } = req.body;
      const ai = getAiClient(req);
      const parts: any[] = [];

      if (imageBase64 && mimeType) {
        parts.push({
          inlineData: {
            data: imageBase64,
            mimeType: mimeType,
          },
        });
      }

      const systemPrompt = `You are a creative UI developer. Bring the user's idea to life by generating a COMPLETE, SELF-CONTAINED HTML5 file.
    Include all necessary CSS within <style> tags and JavaScript within <script> tags.
    You may use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>.
    Ensure the design is modern, responsive, and interactive.
    Return ONLY the HTML code. Do not include any Markdown formatting like \`\`\`html.`;

      parts.push({ text: `${systemPrompt}\n\nUser Request: ${prompt}` });

      const finalModelName = normalizeModel(modelName);

      const response = await generateContentWithFallback(ai, {
        model: finalModelName,
        contents: [{ role: 'user', parts: parts }],
      });

      let html = response.text || "";
      html = html.replace(/```html/gi, '').replace(/```/gi, '').trim();

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json({ html });
    } catch (error: any) {
      console.error('Bring To Life Error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.status(error.message?.includes('API key') ? 401 : 500).json({ error: formatGeminiError(error) });
    }
  });

  router.post('/generate', async (req, res) => {
    try {
      const { contents, config, model = 'gemini-4-hydrogen' } = req.body;
      const ai = getAiClient(req);
      const finalModel = normalizeModel(model);
      const response = await generateContentWithFallback(ai, {
        model: finalModel,
        contents,
        config,
      });

      const jsonResponse = JSON.parse(JSON.stringify(response));
      try {
        jsonResponse.text = response.text;
      } catch (e) {
        const parts = response.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          jsonResponse.text = parts.map((p: any) => p.text || '').join('');
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(jsonResponse);
    } catch (error: any) {
      const formatted = formatGeminiError(error);
      const isQuota = String(error.message || '').includes('quota') ||
                      String(error.message || '').includes('429') ||
                      String(error.message || '').includes('RESOURCE_EXHAUSTED');
      if (isQuota) {
        console.log('[Gemini Generate] 429 quota limit:', formatted);
      } else {
        console.warn('[Gemini Generate] Error:', formatted);
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.status(error.message?.includes('API key not valid') ? 401 : isQuota ? 429 : 500).json({
        error: formatted,
        code: isQuota ? 'QUOTA_EXCEEDED' : 'GENERATE_ERROR'
      });
    }
  });

  router.post('/cache', async (req, res) => {
    try {
      const { model, contents, config, ttlSeconds } = req.body;
      const ai = getAiClient(req);
      const finalModel = normalizeModel(model);
      const cache = await callWithRetry(async () => {
        return await (ai.caches as any).create({
          model: finalModel,
          contents,
          config,
          ttlSeconds,
        });
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(cache);
    } catch (error: any) {
      console.error('Gemini Cache Error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.status(error.message?.includes('API key') ? 401 : 500).json({ error: formatGeminiError(error) });
    }
  });

  router.post('/proxy', async (req, res) => {
    try {
      const { method, params } = req.body;
      const ai = getAiClient(req);

      if (params && params.model) {
        params.model = normalizeModel(params.model);
      }

      let result;
      if (method === 'generateContent' || method === 'generateContentStream') {
        const resp = await generateContentWithFallback(ai, params);
        const jsonResp = JSON.parse(JSON.stringify(resp));
        try {
          jsonResp.text = resp.text;
        } catch (e) {
          const parts = resp.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            jsonResp.text = parts.map((p: any) => p.text || '').join('');
          }
        }
        result = jsonResp;
      } else {
        throw new Error(`Unsupported method: ${method}`);
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(result);
    } catch (error: any) {
      console.error('Gemini Proxy Error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.status(error.message?.includes('API key') ? 401 : 500).json({ error: formatGeminiError(error) });
    }
  });

  return router;
};


export const createArchitectureRouter = () => {
  const router = express.Router();
  router.get('/', (req, res) => {
    try {
      const archPath = path.join(process.cwd(), 'aDOCS', 'ARCHITECTURE.md');
      if (fs.existsSync(archPath)) {
        const content = fs.readFileSync(archPath, 'utf-8');
        res.json({ content });
      } else {
        res.status(404).json({ error: 'ARCHITECTURE.md not found' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

export const createCustomAiRouter = () => {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      // Per-session key: sent via header (like x-gemini-key), never persisted,
      // never logged. Body-only fallback is kept for backward compatibility.
      const headerKey = req.headers['x-custom-ai-key'] as string | undefined;
      const { baseUrl, apiKey: bodyKey, modelName, apiPath, messages, maxTokens } = req.body;
      const apiKey = (headerKey && headerKey.trim()) ? headerKey.trim() : bodyKey;

      if (!baseUrl) {
        return res.status(400).json({ error: 'Missing Base URL configuration for Custom AI provider.' });
      }

      // Block private/loopback hosts server-side (mirrors the MAGGI guard) so
      // this proxy cannot be abused as an SSRF relay into internal networks.
      let cleanBaseUrlForCheck: string;
      try {
        cleanBaseUrlForCheck = String(baseUrl).replace(/\s+/g, '').replace(/^(https?):\/([^/])/i, '$1://$2');
        const parsed = new URL(cleanBaseUrlForCheck);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ error: 'Custom AI Base URL must be http:// or https://.' });
        }
        if (isBlockedIpOrHost(parsed.hostname)) {
          return res.status(400).json({ error: 'Custom AI Base URL points to a blocked private/loopback host.' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid Custom AI Base URL.' });
      }

      let cleanBaseUrl = String(baseUrl).replace(/\s+/g, '').replace(/^(https?):\/([^/])/i, '$1://$2');
      if (cleanBaseUrl.endsWith('/')) {
        cleanBaseUrl = cleanBaseUrl.slice(0, -1);
      }

      let cleanApiPath = String(apiPath || '/v1/chat/completions').replace(/\s+/g, '');
      if (!cleanApiPath.startsWith('/')) {
        cleanApiPath = '/' + cleanApiPath;
      }

      const fullUrl = `${cleanBaseUrl}${cleanApiPath}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey.trim()}`;
      }

      const body = {
        model: modelName || 'gpt-4o-mini',
        messages: messages || [],
        ...(Number.isInteger(maxTokens) && maxTokens > 0 && maxTokens <= 128 ? { max_tokens: maxTokens } : {}),
      };

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          error: `Custom AI Provider returned error status ${response.status}: ${errorText}`
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error('Custom AI Proxy Error:', error);
      res.status(500).json({ error: error.message || 'Internal proxy server error processing Custom AI request.' });
    }
  });

  return router;
};
