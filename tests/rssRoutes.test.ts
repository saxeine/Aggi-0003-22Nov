import express from 'express';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCryptoRouter } from '../server/crypto';
import { aggregateRss } from '../server/rss';
vi.mock('../server/rss', async importOriginal => {
  const original = await importOriginal<typeof import('../server/rss')>();
  return { ...original, aggregateRss: vi.fn().mockResolvedValue({ items: [], sources: [] }) };
});
let server: Server;
async function get(path: string) {
  const app = express(); app.use('/api/crypto', createCryptoRouter());
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as { port: number }).port;
  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path }, res => {
      let body = ''; res.on('data', part => body += part); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(body) }));
    }).on('error', reject).end();
  });
}
afterEach(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); vi.clearAllMocks(); });
describe('RSS routes', () => {
  it('accepts a ticker but never forwards arbitrary URL parameters', async () => {
    const result = await get('/api/crypto/stock-rss?symbol=brk.b&url=http%3A%2F%2F127.0.0.1%2Fsecret');
    expect(result.status).toBe(200); expect(result.data.symbol).toBe('BRK.B');
    expect(aggregateRss).toHaveBeenCalledWith('stock', 'BRK.B');
  });
  it('rejects injection in the symbol without making a feed request', async () => {
    const result = await get('/api/crypto/rss?symbol=BTC%26url%3Dhttps%3A%2F%2Fevil.test');
    expect(result.status).toBe(400); expect(aggregateRss).not.toHaveBeenCalled();
  });
});
