/** An OpenAI-compatible speech endpoint returning MP3 audio. Requests are made
 * directly from the browser, so the endpoint must allow this site's origin. */
export interface CustomSpeechSettings {
  endpoint: string;
  model: string;
  voice: string;
  apiKey: string;
}

export type AudioEngine = { type: 'gemini' } | { type: 'maggi' } | { type: 'custom'; settings: CustomSpeechSettings };

export async function generateCustomSpeech(text: string, settings: CustomSpeechSettings): Promise<string> {
  const url = new URL(settings.endpoint);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The speech endpoint must be an HTTP or HTTPS URL.');
  if (!settings.model.trim() || !settings.voice.trim()) throw new Error('Enter a speech model and voice.');
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({ model: settings.model.trim(), input: text, voice: settings.voice.trim(), response_format: 'mp3' }),
  });
  if (!response.ok) throw new Error(`Speech endpoint returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/^(audio\/(mpeg|mp3)|application\/octet-stream)(;|$)/i.test(contentType)) throw new Error('Speech endpoint did not return MP3 audio.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Speech endpoint returned empty audio.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
