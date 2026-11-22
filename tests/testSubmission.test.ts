import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAGGI_SETTINGS } from '../maggi/config';
import { testSubmission } from '../services/testSubmission';
import { generateCustomAIResponse } from '../services/customAi';
import { generateOllamaResponse } from '../services/ollama';
import { createBrain } from '../services/maggi/brain';

vi.mock('../services/customAi', () => ({ generateCustomAIResponse: vi.fn() }));
vi.mock('../services/ollama', () => ({ generateOllamaResponse: vi.fn() }));
vi.mock('../services/maggi/brain', () => ({ createBrain: vi.fn() }));
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());

describe('model submission tests', () => {
  it('submits the configured custom URL, key, path and model', async () => {
    vi.mocked(generateCustomAIResponse).mockResolvedValue({ text: ' OK ' });
    const config = { provider: 'custom' as const, baseUrl: 'https://example.com', apiKey: 'secret', apiPath: '/v1/chat/completions', model: 'my-model' };
    expect(await testSubmission(config, signal)).toEqual({ text: 'OK', model: 'my-model' });
    expect(generateCustomAIResponse).toHaveBeenCalledWith(config.baseUrl, config.apiKey, config.model, config.apiPath, expect.any(String), [], [], { signal, maxTokens: 32 });
  });
  it('submits the selected Ollama model and propagates errors', async () => {
    vi.mocked(generateOllamaResponse).mockImplementation(async function* () { yield 'OK'; });
    expect(await testSubmission({ provider: 'ollama', endpoint: 'https://example.com', model: 'llama' }, signal)).toEqual({ text: 'OK', model: 'llama' });
    expect(generateOllamaResponse).toHaveBeenCalledWith('https://example.com', 'llama', expect.any(String), [], [], { signal, maxTokens: 32 });
    vi.mocked(generateOllamaResponse).mockImplementation(async function* () { throw new Error('model not found'); });
    await expect(testSubmission({ provider: 'ollama', endpoint: 'https://example.com', model: 'bad' }, signal)).rejects.toThrow('model not found');
  });
  it('uses current MAGGI settings and reports actual model and route', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'OK', model: 'actual', routedVia: 'provider/actual' });
    vi.mocked(createBrain).mockReturnValue({ complete } as any);
    const settings = { ...DEFAULT_MAGGI_SETTINGS, freeLlmApiModel: 'auto' };
    expect(await testSubmission({ provider: 'maggi', settings }, signal)).toEqual({ text: 'OK', model: 'actual', route: 'provider/actual' });
    expect(createBrain).toHaveBeenCalledWith(settings);
    expect(complete).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ signal, maxTokens: 32 }));
  });
  it('rejects missing settings and empty responses', async () => {
    await expect(testSubmission({ provider: 'ollama', endpoint: '', model: '' }, signal)).rejects.toThrow('endpoint');
    vi.mocked(generateCustomAIResponse).mockResolvedValue({ text: ' ' });
    await expect(testSubmission({ provider: 'custom', baseUrl: 'https://example.com', apiKey: '', apiPath: '', model: 'test' }, signal)).rejects.toThrow('empty response');
  });
});
