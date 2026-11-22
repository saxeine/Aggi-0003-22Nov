import type { MediaItem, Session } from '../types';
import type { PersistedMaggiMessage, RagChunk, RagDocument, SavedMaggiQuery } from '../services/maggi/types';
import { getMaggiStore } from '../services/maggi/store';

export const SESSION_CONTENTS_HEADER = '=== SESSION CONTENTS ===';
export const MAGGI_CONTENTS_HEADER = '=== MAGGI CONTENTS ===';

const DEFAULT_MAX_TOTAL_CHARS = 24000;
const DEFAULT_MAX_DOC_CHARS = 6500;

export interface AutoPodcastSourcesInput {
  session?: Session | null;
  maggiDocuments?: RagDocument[];
  getChunksForDocument?: (docId: string) => RagChunk[];
  maggiSavedQueries?: SavedMaggiQuery[];
  maggiChatMessages?: PersistedMaggiMessage[];
  maxTotalChars?: number;
}

export interface AutoPodcastDraftResult {
  draft: string;
  sessionSection: string;
  maggiSection: string;
  hasSessionContent: boolean;
  hasMaggiContent: boolean;
  sessionCount: number;
  maggiDocCount: number;
  maggiQueryCount: number;
  maggiChatCount: number;
}

/**
 * UTF-8 safe base64 decoder with plain-text fallback for non-base64 inputs.
 */
export const decodeBase64Text = (data: string): string => {
  if (!data) return '';
  try {
    const clean = data.includes(',') && data.startsWith('data:')
      ? data.slice(data.indexOf(',') + 1)
      : data;
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return data;
  }
};

const stripHtmlTags = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/?[a-zA-Z!/?][^>]*>/gm, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const truncateText = (text: string, maxChars: number): string => {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 20) return trimmed.slice(0, maxChars);
  return `${trimmed.slice(0, maxChars - 16).trimEnd()}\n...[truncated]`;
};

const normalizeNameKey = (name: string): string => name.trim().toLowerCase();

const resolveSessionMediaItems = (session?: Session | null): MediaItem[] => {
  if (!session || !Array.isArray(session.mediaItems) || session.mediaItems.length === 0) {
    return [];
  }
  const selectedIds = Array.isArray(session.selectedMediaIds) ? session.selectedMediaIds : [];
  if (selectedIds.length > 0) {
    const selected = session.mediaItems.filter((item) => selectedIds.includes(item.id));
    if (selected.length > 0) return selected;
  }
  return session.mediaItems;
};

/**
 * Reconstruct readable document text from ordered MAGGI chunks while avoiding
 * repeating overlapping boundary characters.
 */
export const reconstructChunksText = (
  chunks: RagChunk[],
  maxChars: number = DEFAULT_MAX_DOC_CHARS,
): string => {
  if (!chunks || chunks.length === 0) return '';
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  let assembled = '';
  let prevEnd: number | undefined;

  for (const chunk of ordered) {
    const raw = (chunk.text || '').trim();
    if (!raw) continue;

    if (!assembled) {
      assembled = raw;
      prevEnd = typeof chunk.end === 'number' ? chunk.end : undefined;
    } else if (
      typeof prevEnd === 'number' &&
      typeof chunk.start === 'number' &&
      typeof chunk.end === 'number' &&
      chunk.start < prevEnd &&
      chunk.end > prevEnd
    ) {
      const overlapLen = prevEnd - chunk.start;
      const nonOverlapping = raw.slice(Math.min(overlapLen, raw.length)).trimStart();
      if (nonOverlapping) {
        assembled += (assembled.endsWith('\n') ? '' : '\n') + nonOverlapping;
      }
      prevEnd = chunk.end;
    } else {
      // Fallback overlap trim when start/end offsets aren't contiguous
      const tailWindow = Math.min(200, assembled.length, raw.length);
      let matchedOverlap = 0;
      for (let len = tailWindow; len >= 24; len--) {
        if (assembled.endsWith(raw.slice(0, len))) {
          matchedOverlap = len;
          break;
        }
      }
      const addition = raw.slice(matchedOverlap).trimStart();
      if (addition) {
        assembled += `\n\n${addition}`;
      }
      prevEnd = typeof chunk.end === 'number' ? chunk.end : undefined;
    }

    if (assembled.length >= maxChars) {
      break;
    }
  }

  return truncateText(assembled, maxChars);
};

/**
 * Build a combined Podcast Content/Topic draft containing both Session Contents
 * and MAGGI Contents (indexed docs, saved queries, and recent MAGGI chat)
 * whenever either exists.
 */
export const buildAutoPodcastContentDraft = ({
  session,
  maggiDocuments = [],
  getChunksForDocument,
  maggiSavedQueries = [],
  maggiChatMessages = [],
  maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
}: AutoPodcastSourcesInput): AutoPodcastDraftResult => {
  const sessionItems = resolveSessionMediaItems(session);
  const includedSessionPlainIds = new Set<string>();
  const includedSessionPlainNames = new Set<string>();

  const sessionBlocks: string[] = [];
  if (session && sessionItems.length > 0) {
    const sessionMeta = [
      `Workspace: ${session.name}`,
      session.description?.trim() ? `Description: ${session.description.trim()}` : '',
    ].filter(Boolean);
    if (sessionMeta.length > 0) {
      sessionBlocks.push(sessionMeta.join('\n'));
    }

    const perItemBudget = Math.max(
      1200,
      Math.floor(Math.min(maxTotalChars * 0.5, 12000) / Math.max(1, sessionItems.length)),
    );

    for (const item of sessionItems) {
      if (item.type === 'text' || item.type === 'document' || item.type === 'sql' || item.type === 'html') {
        const decodedRaw = decodeBase64Text(item.data);
        const text = item.type === 'html' ? stripHtmlTags(decodedRaw) : decodedRaw.trim();
        if (text) {
          includedSessionPlainIds.add(item.id);
          includedSessionPlainNames.add(normalizeNameKey(item.name));
          sessionBlocks.push(`[${item.type.toUpperCase()}] ${item.name}\n${truncateText(text, perItemBudget)}`);
        } else {
          sessionBlocks.push(`[${item.type.toUpperCase()}] ${item.name} (Empty text source)`);
        }
      } else if (item.type === 'link') {
        includedSessionPlainIds.add(item.id);
        includedSessionPlainNames.add(normalizeNameKey(item.name));
        sessionBlocks.push(`[LINK] ${item.name}\nURL: ${item.data}`);
      } else if (item.type === 'audio' && item.scriptHtml) {
        const transcript = stripHtmlTags(item.scriptHtml);
        if (transcript) {
          includedSessionPlainIds.add(item.id);
          includedSessionPlainNames.add(normalizeNameKey(item.name));
          sessionBlocks.push(`[AUDIO TRANSCRIPT] ${item.name}\n${truncateText(transcript, perItemBudget)}`);
        } else {
          sessionBlocks.push(`[${item.type.toUpperCase()}] ${item.name} (Attached media source)`);
        }
      } else {
        sessionBlocks.push(`[${item.type.toUpperCase()}] ${item.name} (Attached ${item.type} source)`);
      }
    }
  }

  const sessionSection = sessionBlocks.length > 0
    ? `${SESSION_CONTENTS_HEADER}\n${sessionBlocks.join('\n\n')}`
    : '';

  // --- MAGGI Contents ------------------------------------------------------
  const maggiBlocks: string[] = [];
  let includedDocCount = 0;
  let includedQueryCount = 0;
  let includedChatCount = 0;

  const remainingBudgetAfterSession = Math.max(4000, maxTotalChars - sessionSection.length);

  if (maggiDocuments.length > 0) {
    const docBlocks: string[] = [];
    const docBudget = Math.max(
      1200,
      Math.floor((remainingBudgetAfterSession * 0.55) / Math.max(1, maggiDocuments.length)),
    );

    for (const doc of maggiDocuments) {
      const strippedDocId = doc.id.startsWith('doc-') ? doc.id.slice(4) : doc.id;
      const alreadyEmittedPlainInSession =
        includedSessionPlainIds.has(strippedDocId) ||
        includedSessionPlainNames.has(normalizeNameKey(doc.name));

      if (alreadyEmittedPlainInSession) {
        // Still count it as indexed in MAGGI without duplicating identical full text
        includedDocCount++;
        docBlocks.push(`[Indexed Document] ${doc.name} (${doc.chunkCount} chunks — text included in Session Contents above)`);
        continue;
      }

      const chunks = getChunksForDocument ? getChunksForDocument(doc.id) : [];
      const docText = reconstructChunksText(chunks, Math.min(DEFAULT_MAX_DOC_CHARS, docBudget));
      includedDocCount++;
      if (docText) {
        docBlocks.push(`[Indexed Document: ${doc.name}]\n${docText}`);
      } else {
        docBlocks.push(`[Indexed Document: ${doc.name}] (${doc.chars} chars, ${doc.chunkCount} chunks)`);
      }
    }

    if (docBlocks.length > 0) {
      maggiBlocks.push(`-- Indexed MAGGI Sources (${docBlocks.length}) --\n${docBlocks.join('\n\n')}`);
    }
  }

  const savedQueryKeys = new Set<string>();
  if (maggiSavedQueries.length > 0) {
    const queryLines: string[] = [];
    const maxQueries = Math.min(6, maggiSavedQueries.length);
    const perQueryBudget = Math.max(900, Math.floor((remainingBudgetAfterSession * 0.3) / Math.max(1, maxQueries)));

    for (const q of maggiSavedQueries.slice(0, maxQueries)) {
      const cleanQ = q.query.trim();
      const cleanA = q.answer.trim();
      if (!cleanQ && !cleanA) continue;
      savedQueryKeys.add(`${cleanQ}::${cleanA.slice(0, 120)}`);
      includedQueryCount++;
      queryLines.push(
        `[Saved Query: ${q.title}]\nQ: ${truncateText(cleanQ, 400)}\nA: ${truncateText(cleanA, perQueryBudget)}`,
      );
    }

    if (queryLines.length > 0) {
      maggiBlocks.push(`-- Saved MAGGI Queries (${queryLines.length}) --\n${queryLines.join('\n\n')}`);
    }
  }

  const validChatMessages = maggiChatMessages.filter(
    (m) => !m.error && m.content && m.content.trim().length > 0,
  );
  if (validChatMessages.length > 0) {
    const recentChat = validChatMessages.slice(-8);
    const chatLines: string[] = [];
    const perMsgBudget = Math.max(600, Math.floor((remainingBudgetAfterSession * 0.25) / Math.max(1, recentChat.length)));

    for (let i = 0; i < recentChat.length; i++) {
      const msg = recentChat[i];
      if (msg.role === 'assistant') {
        const prevUser = i > 0 && recentChat[i - 1].role === 'user' ? recentChat[i - 1].content.trim() : '';
        if (prevUser && savedQueryKeys.has(`${prevUser}::${msg.content.trim().slice(0, 120)}`)) {
          // Assistant reply already represented in Saved Queries right above
          continue;
        }
      }
      includedChatCount++;
      const roleLabel = msg.role === 'user' ? 'User' : 'MAGGI';
      chatLines.push(`${roleLabel}: ${truncateText(msg.content, perMsgBudget)}`);
    }

    if (chatLines.length > 0) {
      maggiBlocks.push(`-- Recent MAGGI Chat (${chatLines.length}) --\n${chatLines.join('\n\n')}`);
    }
  }

  const maggiSection = maggiBlocks.length > 0
    ? `${MAGGI_CONTENTS_HEADER}\n${maggiBlocks.join('\n\n')}`
    : '';

  const combined = [sessionSection, maggiSection].filter(Boolean).join('\n\n');
  const draft = combined.length > maxTotalChars ? truncateText(combined, maxTotalChars) : combined;

  return {
    draft,
    sessionSection,
    maggiSection,
    hasSessionContent: sessionBlocks.length > 0,
    hasMaggiContent: maggiBlocks.length > 0,
    sessionCount: sessionItems.length,
    maggiDocCount: includedDocCount,
    maggiQueryCount: includedQueryCount,
    maggiChatCount: includedChatCount,
  };
};

/**
 * Hydrate the singleton MAGGI store and build the combined auto-inserted draft
 * from both the active workspace session and MAGGI contents.
 */
export const loadAutoPodcastDraftFromStore = async (
  session?: Session | null,
  maxTotalChars: number = DEFAULT_MAX_TOTAL_CHARS,
): Promise<AutoPodcastDraftResult> => {
  const store = getMaggiStore();
  await store.hydrate();
  return buildAutoPodcastContentDraft({
    session,
    maggiDocuments: store.listDocuments(),
    getChunksForDocument: (docId) => store.getChunksForDocument(docId),
    maggiSavedQueries: store.listSavedQueries(),
    maggiChatMessages: store.getChatMessages(),
    maxTotalChars,
  });
};

/**
 * When `customInput` already contains `=== SESSION CONTENTS ===`, filter out
 * plain-text/link/html session items whose text is already in `customInput`,
 * while keeping binary/multimodal items (PDF, image, video, audio) intact.
 */
export const filterNonDuplicateSessionMedia = (
  mediaItems: MediaItem[],
  customInput?: string,
): MediaItem[] => {
  if (!customInput || !customInput.includes(SESSION_CONTENTS_HEADER)) {
    return mediaItems;
  }
  return mediaItems.filter((item) => {
    const isPlainInlineType =
      item.type === 'text' ||
      item.type === 'document' ||
      item.type === 'sql' ||
      item.type === 'html' ||
      item.type === 'link';
    return !isPlainInlineType;
  });
};

/**
 * Build a fallback `MediaItem` carrying MAGGI contents when a podcast is
 * generated without `=== MAGGI CONTENTS ===` already inside `customInput`.
 */
export const buildMaggiFallbackMediaItem = (
  store: {
    listDocuments: () => RagDocument[];
    getChunksForDocument: (docId: string) => RagChunk[];
    listSavedQueries: () => SavedMaggiQuery[];
    getChatMessages: () => PersistedMaggiMessage[];
  },
  session?: Session | null,
): MediaItem | null => {
  const result = buildAutoPodcastContentDraft({
    session,
    maggiDocuments: store.listDocuments(),
    getChunksForDocument: (docId) => store.getChunksForDocument(docId),
    maggiSavedQueries: store.listSavedQueries(),
    maggiChatMessages: store.getChatMessages(),
  });
  if (!result.hasMaggiContent || !result.maggiSection.trim()) {
    return null;
  }
  const encoded = btoa(unescape(encodeURIComponent(result.maggiSection)));
  return {
    id: `maggi-contents-${Date.now()}`,
    type: 'text',
    name: 'MAGGI Knowledge & Chat Contents',
    mimeType: 'text/plain',
    data: encoded,
  };
};
