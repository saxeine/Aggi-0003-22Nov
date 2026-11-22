import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCustomSpeech } from '../services/customSpeech';

const settings = { endpoint: 'https://speech.example/v1/audio/speech', model: 'tts-1', voice: 'alloy', apiKey: 'secret' };
afterEach(() => vi.unstubAllGlobals());

describe('custom speech', () => {
  it('posts the edited script and returns audio as base64', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await generateCustomSpeech('Host: hello', settings)).toBe('SUQz');
    expect(fetchMock).toHaveBeenCalledWith(settings.endpoint, expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      body: JSON.stringify({ model: 'tts-1', input: 'Host: hello', voice: 'alloy', response_format: 'mp3' }),
    }));
  });
  it('rejects failed and non-audio responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    await expect(generateCustomSpeech('hello', settings)).rejects.toThrow('HTTP 401');
    await expect(generateCustomSpeech('hello', settings)).rejects.toThrow('did not return MP3 audio');
  });
});
