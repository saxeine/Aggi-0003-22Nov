import { generateCustomAIResponse } from './customAi';
import { generateOllamaResponse } from './ollama';
import { createBrain } from './maggi/brain';
import type { MaggiSettings } from '../maggi/config';

export type SubmissionConfig =
  | { provider: 'custom'; baseUrl: string; apiKey: string; model: string; apiPath: string }
  | { provider: 'ollama'; endpoint: string; model: string }
  | { provider: 'maggi'; settings: MaggiSettings };

const prompt = 'Reply with the single word OK.';

export async function testSubmission(config: SubmissionConfig, signal: AbortSignal): Promise<{ text: string; model: string; route?: string }> {
  if (config.provider === 'custom') {
    if (!config.baseUrl.trim() || !config.model.trim()) throw new Error('Enter a base URL and model name.');
    const result = await generateCustomAIResponse(config.baseUrl, config.apiKey, config.model, config.apiPath, prompt, [], [], { signal, maxTokens: 32 });
    if (!result.text.trim()) throw new Error('The provider returned an empty response.');
    return { text: result.text.trim(), model: config.model };
  }
  if (config.provider === 'ollama') {
    if (!config.endpoint.trim() || !config.model.trim()) throw new Error('Enter an endpoint and select a model.');
    let text = '';
    for await (const chunk of generateOllamaResponse(config.endpoint, config.model, prompt, [], [], { signal, maxTokens: 32 })) text += chunk;
    if (!text.trim()) throw new Error('The provider returned an empty response.');
    return { text: text.trim(), model: config.model };
  }
  const result = await createBrain(config.settings).complete([{ role: 'user', content: prompt }], { maxTokens: 32, temperature: 0, signal });
  if (!result.text.trim()) throw new Error('The provider returned an empty response.');
  return { text: result.text, model: result.model, route: result.routedVia };
}
