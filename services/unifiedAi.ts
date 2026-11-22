import { generateResponse as generateGeminiResponse } from './gemini';
import { generateOllamaResponse } from './ollama';
import { generateCustomAIResponse } from './customAi';
import { getMaggiStore } from './maggi/store';
import { createBrain } from './maggi/brain';
import { DEFAULT_GEMINI_MODEL } from '../constants/geminiModels';
import { MediaItem } from '../types';

const decodeBase64Text = (data: string): string => {
  if (!data) return '';
  try {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return data;
  }
};

export interface UnifiedAiSettingsOverride {
  provider?: string;
  model?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  customBaseUrl?: string;
  customApiKey?: string;
  customModelName?: string;
  customApiPath?: string;
  maggiAutoIndexSession?: boolean;
}

const buildInlineSourceContext = (mediaItems: MediaItem[], maxChars = 42000): string => {
  if (!mediaItems.length) return '';
  const sections: string[] = [];
  let total = 0;

  for (const item of mediaItems) {
    if (total >= maxChars) break;
    let body = '';
    if (item.type === 'text' || item.type === 'document' || item.type === 'sql' || item.type === 'html') {
      body = decodeBase64Text(item.data).trim();
    } else if (item.type === 'link') {
      body = `URL: ${item.data}`;
    } else {
      body = `[Attached ${item.type} source: ${item.name} (${item.mimeType || 'media'})]`;
    }
    if (!body) continue;

    const remaining = maxChars - total;
    const clipped = body.length > remaining ? `${body.slice(0, remaining)}\n[...truncated]` : body;
    sections.push(`--- SOURCE: ${item.name || item.type} ---\n${clipped}`);
    total += clipped.length;
  }

  return sections.join('\n\n');
};

const isRagMissResponse = (answer: string): boolean => {
  const norm = (answer || '').trim().toLowerCase();
  if (!norm) return true;
  return norm.startsWith('i could not find anything relevant in the indexed sources')
    || norm.startsWith('i could not find that in the indexed sources');
};

export const generateUnifiedAIResponse = async (
  prompt: string,
  mediaItems: MediaItem[] = [],
  settingsOverride?: UnifiedAiSettingsOverride,
): Promise<string> => {
  let provider = settingsOverride?.provider || 'gemini';
  try {
    const saved = localStorage.getItem('gemini_media_aggregator_settings');
    const storedSettings = saved ? JSON.parse(saved) : {};
    const settings = { ...storedSettings, ...(settingsOverride || {}) };
    provider = settings.provider || 'gemini';

    if (provider === 'maggi') {
      const store = getMaggiStore();
      await store.hydrate();

      if (settings.maggiAutoIndexSession !== false && mediaItems.length > 0) {
        await store.ingestMediaItems(
          mediaItems.map((it) => ({
            id: it.id,
            name: it.name,
            type: it.type,
            mimeType: it.mimeType,
            data: it.data,
          })),
        );
      }

      const inlineSourceContext = buildInlineSourceContext(mediaItems);
      const hasCustomTopicInput = mediaItems.some((m) => m.id?.startsWith('custom-input-'));

      // Prefer RAG when there are indexed chunks and no isolated custom topic override.
      if (store.stats().chunks > 0 && !hasCustomTopicInput) {
        const result = await store.ask(prompt, [], { useStreaming: false });
        if (result.answer?.trim() && (!inlineSourceContext || !isRagMissResponse(result.answer))) {
          return result.answer.trim();
        }
      }

      const brain = createBrain(store.getSettings());
      const fullPrompt = inlineSourceContext
        ? `${prompt}\n\nSOURCE CONTENT:\n${inlineSourceContext}`
        : prompt;
      const completion = await brain.complete(
        [{ role: 'user', content: fullPrompt }],
        { maxTokens: 2400, temperature: 0.45 },
      );
      if (!completion.text?.trim()) {
        throw new Error('MAGGI returned empty text. Try again or verify your active FreeLLMAPI / MAGGI model.');
      }
      return completion.text.trim();
    } else if (provider === 'ollama') {
      let fullText = '';
      const generator = generateOllamaResponse(
        settings.ollamaEndpoint || 'http://localhost:11434',
        settings.ollamaModel || 'llama3',
        prompt,
        [],
        mediaItems,
      );
      for await (const chunk of generator) {
        fullText += chunk;
      }
      return fullText;
    } else if (provider === 'custom') {
      const result = await generateCustomAIResponse(
        settings.customBaseUrl || 'https://api.openai.com',
        settings.customApiKey || '',
        settings.customModelName || 'gpt-4o-mini',
        settings.customApiPath || '/v1/chat/completions',
        prompt,
        [],
        mediaItems,
      );
      return result.text;
    } else if (saved || settingsOverride) {
      const model = settings.model || DEFAULT_GEMINI_MODEL;
      const result = await generateGeminiResponse(prompt, [], mediaItems, model);
      return result.text;
    }
  } catch (e) {
    if (provider !== 'gemini') {
      throw e;
    }
    console.warn('Unified AI settings read failed, using default Gemini:', e);
  }

  // Fallback to default Gemini
  const response = await generateGeminiResponse(prompt, [], mediaItems, DEFAULT_GEMINI_MODEL);
  return response.text;
};

