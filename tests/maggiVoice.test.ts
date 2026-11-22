import { describe, it, expect } from 'vitest';
import {
  isVoiceModelId,
  pickVoiceModelForPlatform,
  buildVoicePoolTargets,
  buildSequentialVoiceCandidates,
  formatVoiceModelKey,
  cleanTtsText,
  mapGeminiVoiceToOpenAi,
  detectAudioMimeType,
  addWavHeaderBuffer,
  concatWavBuffers,
} from '../server/maggi/keyPool';

describe('FreeLLMAPI voice/TTS model discovery & routing', () => {
  it('identifies TTS/voice model IDs while excluding STT/transcription models', () => {
    expect(isVoiceModelId('tts-1')).toBe(true);
    expect(isVoiceModelId('gpt-4o-mini-tts')).toBe(true);
    expect(isVoiceModelId('gemini-3.8-flash-tts')).toBe(true);
    expect(isVoiceModelId('playai-tts')).toBe(true);
    expect(isVoiceModelId('canopylabs/orpheus-v1-english')).toBe(true);
    expect(isVoiceModelId('@cf/myshell-ai/melotts')).toBe(true);
    expect(isVoiceModelId('kokoro-v1')).toBe(true);
    expect(isVoiceModelId('cartesia/sonic')).toBe(true);

    expect(isVoiceModelId('whisper-1')).toBe(false);
    expect(isVoiceModelId('gpt-4o-transcribe')).toBe(false);
    expect(isVoiceModelId('llama-3.3-70b-instruct')).toBe(false);
  });

  it('picks speaker-appropriate Gemini TTS model in auto mode and respects explicit assignments', () => {
    expect(pickVoiceModelForPlatform('google', 'auto', 1).model).toBe('gemini-3.8-flash-lite-tts');
    expect(pickVoiceModelForPlatform('google', 'auto', 2).model).toBe('gemini-3.8-flash-tts');
    expect(pickVoiceModelForPlatform('google', 'auto', 3).model).toBe('gemini-3.8-flash-tts');
    expect(pickVoiceModelForPlatform('openai', 'auto', 2).model).toBe('gpt-4o-mini-tts');
    expect(pickVoiceModelForPlatform('groq', 'canopylabs/orpheus-v1-english', 1).model).toBe('canopylabs/orpheus-v1-english');
  });

  it('orders and filters key-pool voice targets based on pinned platform or voice capability', () => {
    const pool = [
      { platform: 'nvidia', key: 'nvapi-123' },
      { platform: 'groq', key: 'gsk-123' },
      { platform: 'google', key: 'AIza-123' },
    ];

    const autoTargets = buildVoicePoolTargets(pool, 'auto', 2);
    expect(autoTargets.map((t) => t.platform)).toEqual(['google', 'groq']);
    expect(autoTargets[0].model).toBe('gemini-3.8-flash-tts');

    const pinnedGroq = buildVoicePoolTargets(pool, 'groq:playai-tts', 2);
    expect(pinnedGroq.map((t) => t.platform)).toEqual(['groq']);
    expect(pinnedGroq[0].model).toBe('playai-tts');
  });

  it('builds sequential TTS fallback candidates across all available models and platforms', () => {
    const pool = [
      { platform: 'nvidia', key: 'nvapi-123' },
      { platform: 'cloudflare', key: 'acct123:cftoken' },
      { platform: 'groq', key: 'gsk-123' },
      { platform: 'google', key: 'AIza-123' },
    ];

    const autoSeq = buildSequentialVoiceCandidates(pool, 'auto', 2, true);
    expect(autoSeq.map((c) => formatVoiceModelKey(c.platform, c.model))).toEqual([
      'google:gemini-3.8-flash-tts',
      'google:gemini-3.8-flash-lite-tts',
      'groq:playai-tts',
      'groq:canopylabs/orpheus-v1-english',
      'cloudflare:@cf/myshell-ai/melotts',
    ]);

    const pinnedSeq = buildSequentialVoiceCandidates(pool, 'groq:playai-tts', 1, true);
    expect(pinnedSeq.map((c) => formatVoiceModelKey(c.platform, c.model))).toEqual([
      'groq:playai-tts',
      'groq:canopylabs/orpheus-v1-english',
      'google:gemini-3.8-flash-lite-tts',
      'google:gemini-3.8-flash-tts',
      'cloudflare:@cf/myshell-ai/melotts',
    ]);
  });

  it('cleans markdown/citations/HTML tags for TTS without erasing valid or bracketed text', () => {
    expect(cleanTtsText('**Host:** Hello [1] world <p>with x < 5</p>!')).toBe(
      'Host: Hello world with x < 5 !',
    );
    expect(cleanTtsText('[Host: Welcome to the episode]')).toBe(
      'Host: Welcome to the episode',
    );
    expect(cleanTtsText('   ')).toBe('');
  });

  it('maps Gemini voice names to OpenAI-compatible voice names', () => {
    expect(mapGeminiVoiceToOpenAi('Kore')).toBe('nova');
    expect(mapGeminiVoiceToOpenAi('Puck')).toBe('echo');
    expect(mapGeminiVoiceToOpenAi('Zephyr')).toBe('shimmer');
    expect(mapGeminiVoiceToOpenAi('Fenrir')).toBe('fable');
  });

  it('detects audio MIME types and safely concatenates multi-speaker WAV segments', () => {
    const pcm1 = Buffer.from([1, 2, 3, 4]);
    const pcm2 = Buffer.from([5, 6, 7, 8, 9, 10]);
    const wav1 = addWavHeaderBuffer(pcm1, 24000, 1, 16);
    const wav2 = addWavHeaderBuffer(pcm2, 24000, 1, 16);

    expect(detectAudioMimeType(wav1)).toBe('audio/wav');
    expect(detectAudioMimeType(Buffer.from('ID3\x03\x00'))).toBe('audio/mpeg');

    const combined = concatWavBuffers([wav1, wav2]);
    expect(combined).not.toBeNull();
    expect(combined!.subarray(0, 4).toString('ascii')).toBe('RIFF');
    // 44-byte header + 4 + 6 PCM bytes = 54 bytes
    expect(combined!.length).toBe(54);
    expect(combined!.readUInt32LE(40)).toBe(10);
  });
});
