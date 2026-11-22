import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_KEY_POOL_PROVIDERS,
  DEFAULT_MAGGI_SETTINGS,
} from '../maggi/config';
import {
  normaliseBaseUrl,
  maskKeyServer,
  getMaskedEnvKeyPool,
  buildKeyPoolTargets,
} from '../server/maggi/keyPool';

describe('MAGGI key pool defaults & overwrite behavior', () => {
  const originalEnv = process.env.FREELLMAPI_KEYS_JSON;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FREELLMAPI_KEYS_JSON;
    } else {
      process.env.FREELLMAPI_KEYS_JSON = originalEnv;
    }
  });

  it('auto-loads MAGGI in keypool mode by default with all 9 provider slots and no hardcoded keys', () => {
    expect(DEFAULT_MAGGI_SETTINGS.provider).toBe('freellmapi');
    expect(DEFAULT_MAGGI_SETTINGS.freeLlmMode).toBe('keypool');
    expect(DEFAULT_MAGGI_SETTINGS.freeLlmOverwriteDefaults).toBe(false);
    expect(DEFAULT_KEY_POOL_PROVIDERS).toHaveLength(9);

    const platforms = DEFAULT_KEY_POOL_PROVIDERS.map((p) => p.platform);
    expect(platforms).toEqual([
      'cloudflare',
      'custom',
      'custom',
      'custom',
      'google',
      'groq',
      'nvidia',
      'openrouter',
      'zhipu',
    ]);
    for (const p of DEFAULT_KEY_POOL_PROVIDERS) {
      expect(p.key).toBe('');
      expect(p.enabled).toBe(true);
    }
  });

  it('preserves versioned custom paths like /api/v1/inference without appending /v1', () => {
    expect(normaliseBaseUrl('https://api.inferbase.ai/api/v1/inference')).toBe(
      'https://api.inferbase.ai/api/v1/inference',
    );
    expect(normaliseBaseUrl('https://integrate.api.nvidia.com/v1')).toBe(
      'https://integrate.api.nvidia.com/v1',
    );
    expect(normaliseBaseUrl('https://aihubmix.com/v1')).toBe(
      'https://aihubmix.com/v1',
    );
    expect(normaliseBaseUrl('http://localhost:3001')).toBe(
      'http://localhost:3001/v1',
    );
  });

  it('masks server env keys without exposing raw secrets', () => {
    process.env.FREELLMAPI_KEYS_JSON = JSON.stringify({
      version: 1,
      keys: [
        { platform: 'groq', key: 'gsk_example_secret_token_1234', label: 'GROK' },
      ],
    });
    const masked = getMaskedEnvKeyPool();
    expect(masked).toHaveLength(1);
    expect(masked[0].platform).toBe('groq');
    expect(masked[0].label).toBe('GROK');
    expect(masked[0].hasKey).toBe(true);
    expect(masked[0].maskedKey).toBe(maskKeyServer('gsk_example_secret_token_1234'));
    expect(masked[0].maskedKey).not.toContain('secret_token');
  });

  it('merges env defaults when overwriteDefaults=false and completely replaces them when overwriteDefaults=true', () => {
    process.env.FREELLMAPI_KEYS_JSON = JSON.stringify({
      version: 1,
      keys: [
        { platform: 'groq', key: 'env-groq-key' },
        { platform: 'nvidia', key: 'env-nvidia-key' },
      ],
    });

    const defaultTargets = buildKeyPoolTargets([], 'auto', false);
    expect(defaultTargets.map((t) => t.platform)).toEqual(['nvidia', 'groq']);

    const disabledOneTargets = buildKeyPoolTargets(
      [{ platform: 'nvidia', key: '', enabled: false }],
      'auto',
      false,
    );
    expect(disabledOneTargets.map((t) => t.platform)).toEqual(['groq']);

    const overwrittenTargets = buildKeyPoolTargets(
      [{ platform: 'openrouter', key: 'uploaded-or-key' }],
      'auto',
      true,
    );
    expect(overwrittenTargets.map((t) => t.platform)).toEqual(['openrouter']);
    expect(overwrittenTargets[0].apiKey).toBe('uploaded-or-key');
  });
});
