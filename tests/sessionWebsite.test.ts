import { describe, it, expect } from 'vitest';
import type { MediaItem, Session } from '../types';
import {
  SESSION_WEBSITE_PREFIX,
  approxBytesFromBase64,
  buildSessionWebsiteHtml,
  decodeBase64Text,
  escapeHtml,
  formatBytes,
  getSessionWebsiteSources,
  isGeneratedWebsiteSource,
  safeHttpUrl,
  sessionWebsiteFilename,
  sessionWebsiteSourceName,
  slugifySessionName,
  toDataUrl,
} from '../utils/sessionWebsite';

const b64 = (text: string) => btoa(unescape(encodeURIComponent(text)));

const item = (partial: Partial<MediaItem> & Pick<MediaItem, 'id' | 'name' | 'type'>): MediaItem => ({
  mimeType: 'text/plain',
  data: '',
  ...partial,
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  name: 'Research 001',
  description: 'A test session',
  mediaItems: [],
  selectedMediaIds: [],
  history: [],
  suggestions: [],
  createdAt: new Date('2024-01-02T03:04:05Z').getTime(),
  ...overrides,
});

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("a & b 'c'")).toBe('a &amp; b &#39;c&#39;');
  });
});

describe('decodeBase64Text', () => {
  it('decodes UTF-8 base64 payloads', () => {
    expect(decodeBase64Text(b64('héllo — wörld ✓'))).toBe('héllo — wörld ✓');
  });

  it('returns plain text that is not valid base64 unchanged', () => {
    expect(decodeBase64Text('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('returns an empty string for empty input', () => {
    expect(decodeBase64Text('')).toBe('');
  });
});

describe('getSessionWebsiteSources', () => {
  it('uses all sources when nothing is selected', () => {
    const s = session({
      mediaItems: [
        item({ id: 'a', name: 'A', type: 'text', data: b64('a') }),
        item({ id: 'b', name: 'B', type: 'text', data: b64('b') }),
      ],
    });
    expect(getSessionWebsiteSources(s).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('uses only selected sources when a selection exists', () => {
    const s = session({
      mediaItems: [
        item({ id: 'a', name: 'A', type: 'text', data: b64('a') }),
        item({ id: 'b', name: 'B', type: 'text', data: b64('b') }),
      ],
      selectedMediaIds: ['b'],
    });
    expect(getSessionWebsiteSources(s).map((m) => m.id)).toEqual(['b']);
  });

  it('excludes previously generated website sources to avoid nesting', () => {
    const s = session({
      mediaItems: [
        item({ id: 'a', name: 'A', type: 'text', data: b64('a') }),
        item({ id: 'w', name: `${SESSION_WEBSITE_PREFIX}Research 001`, type: 'html', data: b64('<html></html>') }),
      ],
    });
    expect(getSessionWebsiteSources(s).map((m) => m.id)).toEqual(['a']);
    expect(isGeneratedWebsiteSource(s.mediaItems[1])).toBe(true);
  });
});

describe('naming helpers', () => {
  it('slugifies session names for filenames', () => {
    expect(slugifySessionName('Research 001')).toBe('research_001');
    expect(slugifySessionName('  Café / Notes!  ')).toBe('caf_notes');
    expect(slugifySessionName('')).toBe('session');
  });

  it('builds the download filename and saved source name', () => {
    const s = session();
    expect(sessionWebsiteFilename(s)).toBe('research_001-website.html');
    expect(sessionWebsiteSourceName(s)).toBe('Website: Research 001');
    expect(sessionWebsiteSourceName(session({ name: '  ' }))).toBe('Website: Untitled session');
  });
});

describe('media helpers', () => {
  it('builds data URLs without double-prefixing', () => {
    expect(toDataUrl(item({ id: 'i', name: 'i', type: 'image', mimeType: 'image/png', data: 'AAA' }))).toBe(
      'data:image/png;base64,AAA'
    );
    expect(toDataUrl(item({ id: 'i', name: 'i', type: 'image', data: 'data:image/png;base64,AAA' }))).toBe(
      'data:image/png;base64,AAA'
    );
  });

  it('estimates and formats sizes', () => {
    expect(approxBytesFromBase64('')).toBe(0);
    expect(approxBytesFromBase64('AAAA')).toBe(3);
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('accepts only http(s) URLs', () => {
    expect(safeHttpUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
});

describe('buildSessionWebsiteHtml', () => {
  const full = session({
    mediaItems: [
      item({ id: 't', name: 'Notes', type: 'text', data: b64('Hello <b>world</b> & friends') }),
      item({ id: 'd', name: 'Doc', type: 'document', mimeType: 'application/pdf', data: b64('doc body') }),
      item({ id: 'q', name: 'Query', type: 'sql', data: b64('SELECT * FROM t;') }),
      item({ id: 'h', name: 'Page', type: 'html', data: b64('<h1>raw</h1>') }),
      item({ id: 'i', name: 'Pic', type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }),
      item({ id: 'l', name: 'Example', type: 'link', data: 'https://example.com/post' }),
      item({ id: 'p', name: 'Report', type: 'pdf', mimeType: 'application/pdf', data: b64('pdfdata') }),
      item({ id: 'v', name: 'Clip', type: 'video', mimeType: 'video/mp4', data: b64('videodata') }),
    ],
    history: [
      { id: 'm1', role: 'user', content: 'What is this?', timestamp: new Date('2024-01-02T03:05:00Z') },
      { id: 'm2', role: 'model', content: 'It is a test.', timestamp: new Date('2024-01-02T03:06:00Z') },
    ],
  });

  const html = buildSessionWebsiteHtml(full, { generatedAt: new Date('2024-05-06T07:08:09Z') });

  it('produces a complete standalone document with inline CSS only', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<style>');
    expect(html).toContain('</html>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('cdn.');
    expect(html).not.toContain('@import');
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it('renders text, document, SQL and HTML sources as sections', () => {
    expect(html).toContain('Notes');
    expect(html).toContain('Hello &lt;b&gt;world&lt;/b&gt; &amp; friends');
    expect(html).toContain('Doc');
    expect(html).toContain('doc body');
    expect(html).toContain('SELECT * FROM t;');
    // Raw HTML source is escaped inside a code block, never executed.
    expect(html).toContain('&lt;h1&gt;raw&lt;/h1&gt;');
    expect(html).not.toContain('<h1>raw</h1>');
  });

  it('embeds images and turns links into resource cards', () => {
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('href="https://example.com/post"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('lists binary sources as cards instead of embedding them', () => {
    expect(html).toContain('Report');
    expect(html).toContain('Clip');
    expect(html).not.toContain('data:application/pdf;base64');
    expect(html).not.toContain('data:video/mp4;base64');
  });

  it('includes conversation highlights', () => {
    expect(html).toContain('Conversation highlights');
    expect(html).toContain('What is this?');
    expect(html).toContain('It is a test.');
    expect(html).toContain('Latest 2 of 2 messages');
  });

  it('includes a table of contents and metadata', () => {
    expect(html).toContain('aria-label="Contents"');
    expect(html).toContain('A test session');
    expect(html).toContain('8 sources');
    expect(html).toContain('Generated 5/6/2024');
  });

  it('escapes hostile session names and descriptions', () => {
    const hostile = buildSessionWebsiteHtml(
      session({ name: '<img src=x onerror=alert(1)>', description: '</p><script>x</script>' })
    );
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).not.toContain('<script>');
    expect(hostile).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('does not create clickable javascript: links', () => {
    const hostile = buildSessionWebsiteHtml(
      session({ mediaItems: [item({ id: 'x', name: 'Bad', type: 'link', data: 'javascript:alert(1)' })] })
    );
    expect(hostile).not.toContain('href="javascript:');
    expect(hostile).toContain('not a valid http/https URL');
  });

  it('notes when only selected sources were used', () => {
    const selected = buildSessionWebsiteHtml(
      session({
        mediaItems: [
          item({ id: 'a', name: 'Keep', type: 'text', data: b64('keep me') }),
          item({ id: 'b', name: 'Drop', type: 'text', data: b64('drop me') }),
        ],
        selectedMediaIds: ['a'],
      })
    );
    expect(selected).toContain('keep me');
    expect(selected).not.toContain('drop me');
    expect(selected).toContain('(selected only)');
  });

  it('truncates long text sources with a note', () => {
    const long = buildSessionWebsiteHtml(
      session({ mediaItems: [item({ id: 'a', name: 'Long', type: 'text', data: b64('x'.repeat(500)) })] }),
      { maxTextChars: 100 }
    );
    expect(long).toContain('truncated');
    expect(long).toContain('the first 100 of 500 characters');
    expect(long).not.toContain('x'.repeat(200));
  });

  it('limits conversation highlights to the most recent messages', () => {
    const many = buildSessionWebsiteHtml(
      session({
        history: Array.from({ length: 12 }, (_, i) => ({
          id: `m${i}`,
          role: i % 2 === 0 ? ('user' as const) : ('model' as const),
          content: `message ${i}`,
          timestamp: new Date(),
        })),
      }),
      { maxChatMessages: 3 }
    );
    expect(many).toContain('message 11');
    expect(many).toContain('message 9');
    expect(many).not.toContain('message 8');
    expect(many).toContain('Latest 3 of 12 messages');
  });

  it('handles an empty session gracefully', () => {
    const empty = buildSessionWebsiteHtml(session({ name: 'Empty', history: [] }));
    expect(empty).toContain('Empty');
    expect(empty).toContain('No sources in this session yet');
    expect(empty).not.toContain('Conversation highlights');
  });
});
