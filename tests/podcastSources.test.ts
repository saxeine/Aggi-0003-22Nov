import { describe, it, expect } from 'vitest';
import {
  buildAutoPodcastContentDraft,
  buildMaggiFallbackMediaItem,
  decodeBase64Text,
  filterNonDuplicateSessionMedia,
  MAGGI_CONTENTS_HEADER,
  reconstructChunksText,
  SESSION_CONTENTS_HEADER,
} from '../utils/podcastSources';
import type { MediaItem, Session } from '../types';
import type { PersistedMaggiMessage, RagChunk, RagDocument, SavedMaggiQuery } from '../services/maggi/types';

const toBase64 = (text: string): string => btoa(unescape(encodeURIComponent(text)));

const makeSession = (mediaItems: MediaItem[], selectedMediaIds?: string[]): Session => ({
  id: 'sess-1',
  name: 'Market Deep Dive',
  description: 'Q4 outlook notes',
  mediaItems,
  selectedMediaIds: selectedMediaIds ?? mediaItems.map((m) => m.id),
  history: [],
  suggestions: [],
  createdAt: 1700000000000,
});

const makeChunk = (
  docId: string,
  docName: string,
  index: number,
  text: string,
  start: number,
  end: number,
): RagChunk => ({
  id: `${docId}-c-${index}`,
  docId,
  docName,
  sourceType: 'text',
  index,
  breadcrumb: [],
  text,
  start,
  end,
  tokenEstimate: Math.ceil(text.length / 4),
  hash: `h-${index}`,
});

describe('decodeBase64Text & reconstructChunksText', () => {
  it('decodes UTF-8 base64 strings cleanly and preserves unicode', () => {
    const original = 'Årets analys: €120M & rocket 🚀';
    expect(decodeBase64Text(toBase64(original))).toBe(original);
  });

  it('reconstructs overlapping MAGGI chunks without repeating overlap characters', () => {
    const chunks: RagChunk[] = [
      makeChunk('d1', 'Doc', 0, 'Alpha beta gamma delta ', 0, 23),
      makeChunk('d1', 'Doc', 1, 'gamma delta epsilon zeta', 11, 35),
    ];
    expect(reconstructChunksText(chunks)).toBe('Alpha beta gamma delta\nepsilon zeta');
  });
});

describe('buildAutoPodcastContentDraft', () => {
  it('combines Session contents and MAGGI contents (docs, saved queries, recent chat) when both exist', () => {
    const session = makeSession([
      {
        id: 'm1',
        name: 'earnings.txt',
        mimeType: 'text/plain',
        type: 'text',
        data: toBase64('Revenue grew 24% YoY in Q4.'),
      },
      {
        id: 'm2',
        name: 'Investor Deck',
        mimeType: 'text/uri-list',
        type: 'link',
        data: 'https://example.com/deck',
      },
    ]);

    const docs: RagDocument[] = [
      {
        id: 'doc-ext-1',
        name: 'Competitor Brief.pdf',
        sourceType: 'pdf',
        chars: 120,
        chunkCount: 1,
        hash: 'h1',
        addedAt: 1,
        updatedAt: 1,
      },
    ];
    const chunksByDoc: Record<string, RagChunk[]> = {
      'doc-ext-1': [
        makeChunk('doc-ext-1', 'Competitor Brief.pdf', 0, 'Competitor X lowered pricing by 10% across Europe.', 0, 50),
      ],
    };
    const savedQueries: SavedMaggiQuery[] = [
      {
        id: 'sq-1',
        title: 'Margin Impact',
        query: 'How does pricing affect margins?',
        answer: 'Gross margins remain resilient at 62% thanks to lower cloud costs.',
        pinned: true,
        citations: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const chatMessages: PersistedMaggiMessage[] = [
      { id: 'c1', role: 'user', content: 'What is our top risk?', timestamp: 1 },
      { id: 'c2', role: 'assistant', content: 'Supply chain lead times in EMEA.', timestamp: 2 },
    ];

    const res = buildAutoPodcastContentDraft({
      session,
      maggiDocuments: docs,
      getChunksForDocument: (id) => chunksByDoc[id] || [],
      maggiSavedQueries: savedQueries,
      maggiChatMessages: chatMessages,
    });

    expect(res.hasSessionContent).toBe(true);
    expect(res.hasMaggiContent).toBe(true);
    expect(res.draft).toContain(SESSION_CONTENTS_HEADER);
    expect(res.draft).toContain('Revenue grew 24% YoY in Q4.');
    expect(res.draft).toContain('URL: https://example.com/deck');
    expect(res.draft).toContain(MAGGI_CONTENTS_HEADER);
    expect(res.draft).toContain('Competitor X lowered pricing by 10% across Europe.');
    expect(res.draft).toContain('Margin Impact');
    expect(res.draft).toContain('Supply chain lead times in EMEA.');
    expect(res.sessionCount).toBe(2);
    expect(res.maggiDocCount).toBe(1);
    expect(res.maggiQueryCount).toBe(1);
    expect(res.maggiChatCount).toBe(2);
  });

  it('deduplicates plain-text session items already indexed into MAGGI, but keeps MAGGI text extracted from binary PDFs', () => {
    const session = makeSession([
      {
        id: 'txt-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        type: 'text',
        data: toBase64('UNIQUE_SESSION_TEXT_PAYLOAD'),
      },
      {
        id: 'pdf-1',
        name: 'annual_report.pdf',
        mimeType: 'application/pdf',
        type: 'pdf',
        data: 'JVBERi0xLjQK',
      },
    ]);

    const docs: RagDocument[] = [
      {
        id: 'doc-txt-1',
        name: 'notes.txt',
        sourceType: 'text',
        chars: 27,
        chunkCount: 1,
        hash: 'h1',
        addedAt: 1,
        updatedAt: 1,
      },
      {
        id: 'doc-pdf-1',
        name: 'annual_report.pdf',
        sourceType: 'pdf',
        chars: 64,
        chunkCount: 1,
        hash: 'h2',
        addedAt: 1,
        updatedAt: 1,
      },
    ];
    const chunksByDoc: Record<string, RagChunk[]> = {
      'doc-txt-1': [makeChunk('doc-txt-1', 'notes.txt', 0, 'UNIQUE_SESSION_TEXT_PAYLOAD', 0, 27)],
      'doc-pdf-1': [makeChunk('doc-pdf-1', 'annual_report.pdf', 0, 'PDF_EXTRACTED_INSIGHTS_FROM_MAGGI', 0, 33)],
    };

    const res = buildAutoPodcastContentDraft({
      session,
      maggiDocuments: docs,
      getChunksForDocument: (id) => chunksByDoc[id] || [],
    });

    // Plain text appears once in Session Contents and is referenced cleanly in MAGGI without duplicating verbatim text
    const occurrences = res.draft.split('UNIQUE_SESSION_TEXT_PAYLOAD').length - 1;
    expect(occurrences).toBe(1);
    expect(res.draft).toContain('text included in Session Contents above');
    // Binary PDF in session only has placeholder, so MAGGI's extracted PDF text IS included
    expect(res.draft).toContain('PDF_EXTRACTED_INSIGHTS_FROM_MAGGI');
  });

  it('works when only MAGGI contents exist or only Session contents exist, and returns empty when neither exists', () => {
    const onlyMaggi = buildAutoPodcastContentDraft({
      session: null,
      maggiSavedQueries: [
        {
          id: 'q1',
          title: 'Summary',
          query: 'Summarize topic',
          answer: 'Topic focuses on sustainable grid storage.',
          pinned: false,
          citations: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(onlyMaggi.hasSessionContent).toBe(false);
    expect(onlyMaggi.hasMaggiContent).toBe(true);
    expect(onlyMaggi.draft.startsWith(MAGGI_CONTENTS_HEADER)).toBe(true);

    const onlySession = buildAutoPodcastContentDraft({
      session: makeSession([
        { id: '1', name: 'memo.txt', mimeType: 'text/plain', type: 'text', data: toBase64('Memo text') },
      ]),
    });
    expect(onlySession.hasSessionContent).toBe(true);
    expect(onlySession.hasMaggiContent).toBe(false);
    expect(onlySession.draft.startsWith(SESSION_CONTENTS_HEADER)).toBe(true);

    const emptyBoth = buildAutoPodcastContentDraft({ session: null });
    expect(emptyBoth.hasSessionContent).toBe(false);
    expect(emptyBoth.hasMaggiContent).toBe(false);
    expect(emptyBoth.draft).toBe('');
  });

  it('respects maxTotalChars budget cleanly', () => {
    const longText = 'A'.repeat(5000);
    const res = buildAutoPodcastContentDraft({
      session: makeSession([
        { id: '1', name: 'big.txt', mimeType: 'text/plain', type: 'text', data: toBase64(longText) },
      ]),
      maxTotalChars: 500,
    });
    expect(res.draft.length).toBeLessThanOrEqual(500);
  });
});

describe('filterNonDuplicateSessionMedia & buildMaggiFallbackMediaItem', () => {
  it('strips inline text/link items when customInput already includes SESSION_CONTENTS_HEADER while keeping binary items', () => {
    const items: MediaItem[] = [
      { id: '1', name: 'note.txt', mimeType: 'text/plain', type: 'text', data: toBase64('abc') },
      { id: '2', name: 'chart.png', mimeType: 'image/png', type: 'image', data: 'iVBOR' },
      { id: '3', name: 'doc.pdf', mimeType: 'application/pdf', type: 'pdf', data: 'JVBER' },
    ];
    const filtered = filterNonDuplicateSessionMedia(items, `${SESSION_CONTENTS_HEADER}\n[TEXT] note.txt\nabc`);
    expect(filtered.map((i) => i.id)).toEqual(['2', '3']);
    expect(filterNonDuplicateSessionMedia(items, 'Custom topic').length).toBe(3);
  });

  it('builds a MediaItem containing MAGGI contents when present and returns null when MAGGI is empty', () => {
    const emptyStore = {
      listDocuments: () => [],
      getChunksForDocument: () => [],
      listSavedQueries: () => [],
      getChatMessages: () => [],
    };
    expect(buildMaggiFallbackMediaItem(emptyStore, null)).toBeNull();

    const populatedStore = {
      listDocuments: () => [],
      getChunksForDocument: () => [],
      listSavedQueries: () => [],
      getChatMessages: () => [{ id: 'm1', role: 'assistant' as const, content: 'Grounded answer', timestamp: 1 }],
    };
    const fallback = buildMaggiFallbackMediaItem(populatedStore, null);
    expect(fallback).not.toBeNull();
    expect(decodeBase64Text(fallback!.data)).toContain('Grounded answer');
  });
});
