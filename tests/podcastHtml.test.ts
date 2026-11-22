import { describe, it, expect } from 'vitest';
import {
  buildScriptLinesHtml,
  buildPodcastDocumentHtml,
  buildErrorHtml,
  buildAudioPlayerHtml,
  buildAudioNoticeHtml,
} from '../utils/podcastHtml';
import type { VoiceSettings } from '../types';

const voice: VoiceSettings = {
  host: 'Kore', hostLabel: 'Host Bot', expert: 'Zephyr', expertLabel: 'Expert Bot',
  guest: 'Puck', guestLabel: 'Guest Bot',
} as VoiceSettings;

describe('buildScriptLinesHtml', () => {
  it('marks host lines with the purple theme', () => {
    const html = buildScriptLinesHtml('**Host Bot:** Hello there', voice);
    expect(html).toContain('rgba(168, 85, 247, 0.1)');
  });

  it('marks expert lines with the cyan theme', () => {
    const html = buildScriptLinesHtml('**Expert Bot:** Look at this', voice);
    expect(html).toContain('rgba(6, 182, 212, 0.1)');
  });

  it('marks guest lines with the amber theme', () => {
    const html = buildScriptLinesHtml('**Guest Bot:** Wow', voice);
    expect(html).toContain('rgba(245, 158, 11, 0.1)');
  });

  it('converts **bold** to strong tags', () => {
    const html = buildScriptLinesHtml('**Host Bot:** a *b* c', voice);
    expect(html).toContain('<strong');
  });

  it('skips blank lines', () => {
    const html = buildScriptLinesHtml('\n\n\n', voice);
    expect(html).toBe('<div data-podcast-script style="max-width: 800px; margin: 0 auto;"></div>');
  });
});

describe('buildPodcastDocumentHtml', () => {
  it('includes the audio player only when audioBase64 is present', () => {
    const withAudio = buildPodcastDocumentHtml({ script: 'x', voiceSettings: voice, audioBase64: 'AAAA' });
    expect(withAudio).toContain('<audio');
    expect(withAudio).toContain('data:audio/wav;base64,AAAA');

    const withoutAudio = buildPodcastDocumentHtml({ script: 'x', voiceSettings: voice, audioBase64: null });
    expect(withoutAudio).not.toContain('<audio');
  });

  it('renders the ⚠️ notice block when provided', () => {
    const notice = buildAudioNoticeHtml('Transcript ready below.');
    const html = buildPodcastDocumentHtml({ script: 'x', voiceSettings: voice, audioBase64: null, audioNoticeHtml: notice });
    expect(html).toContain('Transcript ready below.');
  });
});

describe('buildErrorHtml', () => {
  it('flags quota errors distinctly', () => {
    const html = buildErrorHtml('429 quota exceeded');
    expect(html).toContain('API Quota Limit');
    expect(html).not.toContain('Could Not Generate Tool Output');
  });

  it('escapes HTML in the message', () => {
    const html = buildErrorHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildAudioPlayerHtml', () => {
  it('returns empty string without audio', () => {
    expect(buildAudioPlayerHtml(null)).toBe('');
  });

  it('includes a volume slider and mute toggle when audio is present', () => {
    const html = buildAudioPlayerHtml('AAAA');
    expect(html).toContain('id="pp-volume"');
    expect(html).toContain('aria-label="Volume"');
    expect(html).toContain('id="pp-mute-btn"');
  });
});
