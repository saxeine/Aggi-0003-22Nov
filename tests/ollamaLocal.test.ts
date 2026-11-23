import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOllamaResponse, generateOllamaSuggestions, testOllamaConnection } from '../services/ollama';
import { createBrain } from '../services/maggi/brain';
import { DEFAULT_MAGGI_SETTINGS } from '../maggi/config';

const endpoint = 'http://localhost:11434';
const stream = (...lines: string[]) => new Response(lines.join(''), { headers: { 'Content-Type': 'application/x-ndjson' } });
afterEach(() => vi.unstubAllGlobals());

describe('local Ollama', () => {
  it('discovers models directly on the browser machine', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 'llama3.2', size: 123 }] })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await testOllamaConnection(endpoint);
    expect(result.ok).toBe(true);
    expect(result.via).toBe('browser-direct');
    expect(result.models[0].name).toBe('llama3.2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${endpoint}/api/tags`);
  });
  it('streams chat from local Ollama with the selected model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(stream('{"message":{"content":"Hi"}}\n', '{"message":{"content":" there"},"done":true}\n'));
    vi.stubGlobal('fetch', fetchMock);
    let text = '';
    for await (const chunk of generateOllamaResponse(endpoint, 'llama3.2', 'Hello', [], [], { maxTokens: 32 })) text += chunk;
    expect(text).toBe('Hi there');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${endpoint}/api/chat`);
    expect(JSON.parse(init.body)).toMatchObject({ model: 'llama3.2', stream: true, options: { num_predict: 32 } });
  });
  it('reports HTTP and streaming errors rather than retrying another host', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"error":"model not found"}', { status: 404 })).mockResolvedValueOnce(stream('{"error":"model failed"}\n'));
    vi.stubGlobal('fetch', fetchMock);
    const collect = async () => { for await (const _ of generateOllamaResponse(endpoint, 'missing', 'Hello', [], [])) { /* consume */ } };
    await expect(collect()).rejects.toThrow('model not found');
    await expect(collect()).rejects.toThrow('model failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('provides actionable local browser setup information when unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const result = await testOllamaConnection(endpoint);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('OLLAMA_ORIGINS');
    expect(result.detail).toContain(window.location.origin);
  });
  it('routes MAGGI local probe, completion and streaming through the same browser connection', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'llama3.2' }] }))).mockResolvedValueOnce(stream('{"message":{"content":"OK"}}\n')).mockResolvedValueOnce(stream('{"message":{"content":"Hi"}}\n'));
    vi.stubGlobal('fetch', fetchMock);
    const brain = createBrain({ ...DEFAULT_MAGGI_SETTINGS, provider: 'ollama', ollamaBaseUrl: endpoint, ollamaModel: 'llama3.2' });
    expect((await brain.probe()).models).toEqual(['llama3.2']);
    const messages = [{ role: 'system' as const, content: 'Be brief' }, { role: 'user' as const, content: 'Hello' }];
    expect((await brain.complete(messages, { maxTokens: 16 })).text).toBe('OK');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ messages, model: 'llama3.2', options: { num_predict: 16 } });
    const onDelta = vi.fn();
    expect((await brain.stream(messages, {}, onDelta)).text).toBe('Hi');
    expect(onDelta).toHaveBeenCalledWith('Hi');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`${endpoint}/api/tags`, `${endpoint}/api/chat`, `${endpoint}/api/chat`]);
  });
  it('gets local suggestions from the same endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '["One?","Two?"]' } })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await generateOllamaSuggestions(endpoint, 'llama3.2', [])).toEqual(['One?', 'Two?']);
    expect(fetchMock.mock.calls[0][0]).toBe(`${endpoint}/api/chat`);
  });
});
