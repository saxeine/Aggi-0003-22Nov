import { DEFAULT_GEMINI_MODEL } from '../constants/geminiModels';

import { MediaItem, Message, MindMapNode, VoiceSettings } from "../types";

const callGeminiApi = async (endpoint: string, body: any) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const saved = localStorage.getItem('gemini_media_aggregator_settings');
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings.geminiApiKey) {
        headers['x-gemini-key'] = settings.geminiApiKey;
      }
    }
  } catch (e) {
    console.warn("Failed to retrieve custom Gemini API key from settings", e);
  }

  const response = await fetch(`/api/gemini/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    if (isJson) {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } else {
      const text = await response.text();
      if (text.includes('<!DOCTYPE html>') || text.includes('<html>')) {
        errorMessage = `Server Error (${response.status}): The server returned an HTML error page. This often means the service is temporarily overloaded or down.`;
      } else {
        errorMessage = text || errorMessage;
      }
    }
    throw new Error(errorMessage);
  }

  if (!isJson) {
    const text = await response.text();
    if (text.includes('<!DOCTYPE html>') || text.includes('<html>')) {
      throw new Error(`Server returned an HTML error page (status: ${response.status}) instead of JSON. This often means the server request timed out, is overloaded, or the API key is invalid/missing.`);
    }
    throw new Error(`Expected JSON response from server, but received text: "${text.substring(0, 150)}..." (status: ${response.status})`);
  }

  return await response.json();
};

const safeExtractText = (response: any): string => {
  if (!response) return "";
  if (typeof response.text === 'string') return response.text;
  const parts = response.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p: any) => p.text || '').join('');
  }
  return "";
};

// --- WAV ENCODING UTILITIES ---
const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const addWavHeader = (pcmData: Uint8Array, sampleRate = 24000, numChannels = 1) => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const dataLen = pcmData.length;

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // Byte rate
  view.setUint16(32, numChannels * 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataLen, true);

  const wavBody = new Uint8Array(header.byteLength + pcmData.length);
  wavBody.set(new Uint8Array(header), 0);
  wavBody.set(pcmData, header.byteLength);
  
  return wavBody;
};

// Helper to calculate a simple hash of the media context
export const calculateMediaHash = (mediaItems: MediaItem[]): string => {
  if (mediaItems.length === 0) return '';
  return mediaItems.map(m => m.id).sort().join('|');
};

// Helper to decode Base64 to string
export const base64ToText = (base64: string): string => {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.error("Failed to decode base64", e);
    return "";
  }
};

export const chunkText = (text: string, maxChars: number = 12000): string[] => {
  const chunks: string[] = [];
  let currentChunk = '';

  const paragraphs = text.split('\n\n');
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  return chunks;
};

export const translateText = async (
  text: string, 
  targetLang: string, 
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<string> => {
  const chunks = chunkText(text, 12000);
  let translatedContent = '';
  
  for (const chunk of chunks) {
    const prompt = `Translate the following text into ${targetLang}. Preserve the formatting and structure. Return ONLY the translated text fragment. Do not include any introductory or concluding remarks, and do not wrap in HTML/Markdown tags unless they were in the source.\n\nText:\n${chunk}`;
    const result = await generateResponse(prompt, [], [], modelName);
    translatedContent += (translatedContent ? '\n\n' : '') + result.text;
  }
  
  return translatedContent;
};

export const generateTagsForMedia = async (
  mediaItem: MediaItem,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<string[]> => {
  try {
    let parts: any[] = [];

    if (mediaItem.type === 'text' || mediaItem.type === 'document' || mediaItem.type === 'sql' || mediaItem.type === 'html') {
      const text = base64ToText(mediaItem.data);
      parts.push({ text: `Analyze the following content and provide 3-5 relevant, concise tags (single words or short phrases) that describe its main topics or themes.\n\nContent:\n${text.substring(0, 10000)}` });
    } else if (mediaItem.type === 'link') {
      parts.push({ text: `Analyze the content at this URL and provide 3-5 relevant, concise tags (single words or short phrases) that describe its main topics or themes.\n\nURL: ${mediaItem.data}` });
    } else {
      parts.push({
        inlineData: {
          data: mediaItem.data,
          mimeType: mediaItem.mimeType,
        },
      });
      parts.push({ text: "Analyze this media and provide 3-5 relevant, concise tags (single words or short phrases) that describe its main subjects, topics, or themes." });
    }

    const response = await callGeminiApi('generate', {
      model: modelName,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
          description: "An array of 3-5 concise tags.",
        },
      },
    });

    const text = safeExtractText(response) || "[]";
    const tags = JSON.parse(text);
    return Array.isArray(tags) ? tags : [];
  } catch (e) {
    console.warn("Tag generation skipped:", e instanceof Error ? e.message : String(e));
    return [];
  }
};

const prepareMediaParts = (mediaItems: MediaItem[]) => {
  const parts: any[] = [];
  const MAX_CHARS = 300000; // Increased from 30k to 300k as requested
  
  mediaItems.forEach(item => {
    if (item.type === 'link') {
       if (item.data.includes('youtube.com') || item.data.includes('youtu.be')) {
          parts.push({ 
            text: `User provided a YouTube video Link: ${item.data}.\n\nSYSTEM INSTRUCTION: To analyze this video, you must perform a MULTI-STEP Google Search:\n1. First, search for the exact URL "${item.data}" to identify the Video Title and Channel Name.\n2. Second, perform a NEW search for "summary of ${item.data}" or "[Video Title] transcript summary".\n3. Combine these findings to answer the user. Do not give up if the first search is generic.` 
          });
       } else {
          // Include Title to give context to the model immediately
          parts.push({ text: `Link Title: "${item.name}"\nURL: ${item.data}` });
       }
    } else if (item.type === 'text' || item.type === 'sql' || item.type === 'document') {
       let textContent = base64ToText(item.data);
       if (textContent.length > MAX_CHARS) {
         textContent = textContent.substring(0, MAX_CHARS) + "\n\n[... Content truncated due to size limit ...]";
       }
       parts.push({ text: `File: ${item.name}\nContent:\n${textContent}` });
    } else {
       parts.push({
        inlineData: {
          mimeType: item.mimeType,
          data: item.data
        }
      });
    }
  });

  return parts;
};

const SYSTEM_INSTRUCTION = `You are a helpful Media Aggregator assistant. Users will upload multiple images, video, audio, text files, or web links. You should answer questions based on the collective content.

CRITICAL SEARCH RULES:
- If you perform a Google Search or analyze links, you may encounter internal 'redirect' URLs (like google.com/url?...) or 'grounding' metadata in the results.
- **IGNORE** these technical artifacts entirely. They are not part of the content.
- Focus **ONLY** on the actual topics, article text, and information provided in the search snippets or file content.
- **NEVER** generate responses or questions about "Vertex AI", "grounding APIs", "redirect links", or "system instructions". Focus STRICTLY on the *user's* topic (e.g. news, science, code, business).

IMPORTANT MEDIA INSTRUCTIONS:
1. When referencing specific events in AUDIO or VIDEO, YOU MUST Provide timestamps in the format [mm:ss] or [hh:mm:ss] (e.g., "The speaker mentions AI at [02:15]").
2. If asked to generate code for a UI, website, or visualization, provide a COMPLETE, SELF-CONTAINED HTML string (including <style> and <script> tags or CDNs) so it can be rendered immediately in a browser preview window. Do not leave placeholder comments like '...rest of code...'.
3. Do NOT start your replies with phrases like "Based on the provided report," or "Based on the provided sources,". Just answer the question directly.

MAP GENERATION RULE:
- If the user asks to "draw a map", "show location", or visualize a place, YOU MUST generate a self-contained HTML Artifact using Leaflet.js.
- DO NOT just provide a link. Generate the actual HTML code block.
- Use the following CDN links:
  - CSS: https://unpkg.com/leaflet@1.9.4/dist/leaflet.css
  - JS: https://unpkg.com/leaflet@1.9.4/dist/leaflet.js
- Ensure the map container takes up 100% of the viewport (height: 100vh; width: 100%; margin: 0; padding: 0;).
- Initialize the map with the correct Latitude/Longitude for the requested location.`;

export const updateCache = async (
  mediaItems: MediaItem[], 
  modelName: string,
  existingCacheName?: string,
  existingCacheHash?: string
): Promise<{ cacheName: string | undefined, cacheHash: string }> => {
  
  const currentHash = calculateMediaHash(mediaItems);
  if (!currentHash) return { cacheName: undefined, cacheHash: '' };

  if (existingCacheName && existingCacheHash === currentHash) {
    return { cacheName: existingCacheName, cacheHash: currentHash };
  }

  try {
    const ttlSeconds = 600; 
    
    const cache = await callGeminiApi('cache', {
        model: modelName,
        contents: [{ role: 'user', parts: prepareMediaParts(mediaItems) }],
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
        },
        ttlSeconds: ttlSeconds
    });

    console.log("Created Gemini Context Cache:", cache.name);
    return { cacheName: cache.name, cacheHash: currentHash };
  } catch (e) {
    console.warn("Context cache skipped:", e instanceof Error ? e.message : String(e));
    return { cacheName: undefined, cacheHash: '' };
  }
};

export const generateResponse = async (
  currentPrompt: string,
  history: Message[],
  mediaItems: MediaItem[],
  modelName: string = DEFAULT_GEMINI_MODEL,
  cachedContentName?: string,
  forceSearch: boolean = false
): Promise<{ text: string, groundingChunks?: any[] }> => {
  const contents = [];

  history.forEach(msg => {
    contents.push({
      role: msg.role,
      parts: [{ text: msg.content }]
    });
  });

  const currentParts: any[] = [];
  const mediaParts = prepareMediaParts(mediaItems);
  currentParts.push(...mediaParts);
  
  currentParts.push({ text: currentPrompt });
  contents.push({ role: 'user', parts: currentParts });

  const hasLinks = mediaItems.some(item => item.type === 'link') || forceSearch;
  
  try {
    const config: any = {};
    
    if (!cachedContentName) {
        config.systemInstruction = SYSTEM_INSTRUCTION;
    }

    if (hasLinks) {
      config.tools = [{ googleSearch: {} }];
    }

    if (cachedContentName) {
        config.cachedContent = cachedContentName;
    }

    const response = await callGeminiApi('generate', {
        model: modelName,
        contents: contents,
        config: config
    });
    
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const extractedText = safeExtractText(response);

    return {
      text: extractedText || "I couldn't generate a text response.",
      groundingChunks: groundingChunks
    };
  } catch (error) {
    console.warn("Gemini API notice:", error instanceof Error ? error.message : String(error));
    throw error;
  }
};

const cleanTextForSpeech = (text: string): string => {
  return text
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '') // Remove head content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
    .replace(/<[^>]*>?/gm, ' ') // Strip HTML tags
    .replace(/(\*\*|__|\*|_)/g, '') // Strip Markdown formatting
    .replace(/#{1,6}\s/g, '')   // Strip Headers
    .replace(/\[.*?\]/g, '')    // Strip bracketed text like [Sound effect]
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')    // Collapse horizontal whitespace while keeping speaker newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildMultiSpeakerParts = (
  cleanedText: string,
  voices: VoiceSettings
): Array<{ text: string; speechMetadata: { speaker: string } }> => {
  const hostAliases = [voices.hostLabel, 'Host', 'SaxeIn'].filter(Boolean);
  const expertAliases = [voices.expertLabel, 'Expert', voices.guestLabel, 'Guest'].filter(Boolean);

  const labelMap = new Map<string, 'SaxeIn' | 'Expert'>();
  hostAliases.forEach((a) => labelMap.set(a.toLowerCase(), 'SaxeIn'));
  expertAliases.forEach((a) => {
    const key = a.toLowerCase();
    if (!labelMap.has(key)) labelMap.set(key, 'Expert');
  });

  const allAliases = Array.from(new Set([...hostAliases, ...expertAliases]))
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);

  if (allAliases.length === 0) return [];

  // Match speaker markers either at line start or inline after whitespace/punctuation
  const markerRegex = new RegExp(`(?:^|\\n|\\s)(${allAliases.join('|')})\\s*:`, 'gi');
  const matches: Array<{ index: number; endIndex: number; speaker: 'SaxeIn' | 'Expert' }> = [];

  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(cleanedText)) !== null) {
    const rawLabel = match[1].trim().toLowerCase();
    const mapped = labelMap.get(rawLabel) || 'SaxeIn';
    matches.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      speaker: mapped,
    });
  }

  const parts: Array<{ text: string; speechMetadata: { speaker: 'SaxeIn' | 'Expert' } }> = [];
  const pushTurn = (speaker: 'SaxeIn' | 'Expert', body: string) => {
    const trimmed = body.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    const prev = parts[parts.length - 1];
    if (prev && prev.speechMetadata.speaker === speaker) {
      prev.text = `${prev.text} ${trimmed}`;
    } else {
      parts.push({
        text: `${speaker}: ${trimmed}`,
        speechMetadata: { speaker },
      });
    }
  };

  if (matches.length > 0) {
    // Include any opening narration before the first explicit speaker label
    if (matches[0].index > 0) {
      const intro = cleanedText.slice(0, matches[0].index).trim();
      if (intro) pushTurn('SaxeIn', intro);
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].endIndex;
      const end = i + 1 < matches.length ? matches[i + 1].index : cleanedText.length;
      pushTurn(matches[i].speaker, cleanedText.slice(start, end));
    }
  } else {
    // No explicit speaker labels found: alternate sentence chunks between SaxeIn & Expert
    const sentences = cleanedText.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    if (sentences.length >= 2) {
      sentences.forEach((sentence, idx) => {
        pushTurn(idx % 2 === 0 ? 'SaxeIn' : 'Expert', sentence);
      });
    }
  }

  return parts;
};

export const generateSpeech = async (text: string, speakers: number = 1, voiceSettings?: VoiceSettings): Promise<string | null> => {
  const cleanedText = cleanTextForSpeech(text);
  if (!cleanedText) return null;
  
  const voices = voiceSettings || {
      host: 'Puck', hostLabel: 'Sax',
      expert: 'Kore', expertLabel: 'Chameleon',
      guest: 'Fenrir', guestLabel: 'The Pinpoint'
  };

  try {
    const config: any = {
      responseModalities: ["AUDIO"],
    };

    let ttsModel = speakers >= 2 ? "gemini-3.8-flash-tts" : "gemini-3.8-flash-lite-tts";
    let requestParts: any[] = [];

    const multiSpeakerParts = speakers >= 2 ? buildMultiSpeakerParts(cleanedText, voices) : [];

    if (speakers >= 2 && multiSpeakerParts.length >= 2) {
        const speakerConfigs = [
            { speaker: 'SaxeIn', voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.host } } },
            { speaker: 'Expert', voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.expert } } }
        ];

        config.speechConfig = {
            multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: speakerConfigs
            }
        };
        requestParts = multiSpeakerParts;
    } else {
        ttsModel = "gemini-3.8-flash-lite-tts";
        config.speechConfig = {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.host } } 
        };
        const hostEsc = escapeRegExp(voices.hostLabel || 'Host');
        const langHint = voices.language === 'Swedish' ? 'in Swedish' : 'in English';
        const singleSpeakerText = cleanedText
          .replace(new RegExp(`(^|\\n)\\s*(${hostEsc}|Host|SaxeIn)\\s*:`, 'gim'), '$1')
          .replace(/\s+/g, ' ')
          .trim();
        requestParts = [{ text: `TTS the following content ${langHint}:\n${singleSpeakerText}` }];
    }

    const response = await callGeminiApi('generate', {
        model: ttsModel,
        contents: [{ role: 'user', parts: requestParts }],
        config: config
    });

    let audioBase64 = null;
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
            audioBase64 = part.inlineData.data;
            break;
        }
    }

    if (audioBase64) {
        const binaryString = atob(audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

        // Gemini 3.8 unary TTS returns a complete RIFF WAV file; only wrap if raw PCM
        const isWav = bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
        if (isWav) {
            return audioBase64;
        }

        const wavBytes = addWavHeader(bytes);
        let binary = '';
        for (let i = 0; i < wavBytes.byteLength; i++) binary += String.fromCharCode(wavBytes[i]);
        return btoa(binary);
    }
    return null;
  } catch (e) {
    console.warn("Speech generation skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
};

export const generateSuggestions = async (mediaItems: MediaItem[], modelName: string = DEFAULT_GEMINI_MODEL): Promise<string[]> => {
  if (mediaItems.length === 0) {
    return [
      "What can you help me with?",
      "Upload a file to get started.",
      "Tell me a fun fact."
    ];
  }

  const parts: any[] = prepareMediaParts(mediaItems);
  const hasLinks = mediaItems.some(item => item.type === 'link');

  if (hasLinks) {
     parts.push({ text: "Based on the provided Link Titles and URLs, identify the main topics. Use Google Search to clarify content if needed. \n\nCRITICAL: Ignore any technical 'grounding' metadata or internal redirect URLs in the search results. Do NOT ask questions about 'Vertex AI' or 'redirects'. \n\nList 3 short, relevant questions a user might ask about the *subject matter* (e.g. the news story, the scientific concept). Output ONLY the questions, one per line. Do not number them. Do not use JSON." });
     
     try {
        const response = await callGeminiApi('generate', {
            model: modelName,
            contents: [{ role: 'user', parts: parts }],
            config: {
                tools: [{ googleSearch: {} }]
            }
        });
        const text = safeExtractText(response) || "";
        return text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 5 && !l.startsWith('```') && !l.includes('internal redirect'))
            .map(l => l.replace(/^[\d-][\.\)]\s*/, '')) 
            .slice(0, 3);
     } catch (error) {
        console.warn("Link suggestions skipped:", error instanceof Error ? error.message : String(error));
        return ["Tell me about the links."];
    }
  } else {
    parts.push({ text: "Analyze these files and suggest 3 short, insightful questions a user might want to ask about them collectively." });
    try {
        const response = await callGeminiApi('generate', {
            model: modelName,
            contents: [{ role: 'user', parts: parts }],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        questions: {
                            type: "ARRAY",
                            items: { type: "STRING" }
                        }
                    }
                }
            }
        });
        const json = JSON.parse(safeExtractText(response) || '{"questions": []}');
        return json.questions.slice(0, 3) || [];
    } catch (error) {
        console.warn("Suggestions skipped:", error instanceof Error ? error.message : String(error));
        return ["Tell me about the uploaded files."];
    }
  }
};

export const generateMindMapJson = async (mediaItems: MediaItem[], modelName: string = DEFAULT_GEMINI_MODEL): Promise<MindMapNode | null> => {
    if (mediaItems.length === 0) return null;
    const parts = prepareMediaParts(mediaItems);
    const prompt = `Analyze the provided content and construct a Mind Map hierarchical tree representation of the key concepts.
    Return strictly JSON in the following format (recursive tree):
    {
      "id": "root",
      "label": "Central Topic",
      "summary": "Overview",
      "children": [
        {
           "id": "1",
           "label": "Main Branch 1",
           "summary": "Details about branch 1",
           "children": [
              { "id": "1-1", "label": "Sub Item", "summary": "..." }
           ]
        }
      ]
    }
    Ensure the JSON is valid. Keep labels short (1-4 words). Depth should be at least 2 levels.`;
    parts.push({ text: prompt });
    try {
        const response = await callGeminiApi('generate', {
            model: modelName,
            contents: [{ role: 'user', parts: parts }],
            config: { responseMimeType: "application/json" }
        });
        let text = safeExtractText(response) || "{}";
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);
        if (json.label) return json as MindMapNode;
        return null;
    } catch (error) {
        console.warn("MindMap generation skipped:", error instanceof Error ? error.message : String(error));
        return null;
    }
};

export const searchWeb = async (query: string, excludeUrls: string[] = []): Promise<{ title: string, uri: string }[]> => {
  let prompt = `Search for "${query}" and list the top 5 results.`; 
  if (excludeUrls.length > 0) {
      prompt += `\n\nIMPORTANT: Do NOT include any of the following URLs in the results. I already have them. Find DIFFERENT, unique resources:\n${excludeUrls.slice(0, 15).join('\n')}`;
  }
  try {
    const response = await callGeminiApi('generate', {
        model: DEFAULT_GEMINI_MODEL,
        contents: [{ parts: [{ text: prompt }] }],
        config: { tools: [{ googleSearch: {} }] }
    });
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const results: { title: string, uri: string }[] = [];
    if (chunks && chunks.length > 0) {
        chunks.forEach((c: any) => {
            if (c.web && !excludeUrls.includes(c.web.uri)) {
                results.push({ title: c.web.title || "Web Result", uri: c.web.uri });
            }
        });
    }
    const unique = new Map();
    results.forEach(r => unique.set(r.uri, r));
    return Array.from(unique.values()).slice(0, 5);
  } catch (e) {
    console.warn("Web Search skipped:", e instanceof Error ? e.message : String(e));
    return [];
  }
};

/**
 * Bring Anything To Life: Generates HTML code based on a prompt and optional image.
 */
export const bringToLife = async (
  prompt: string,
  imageBase64?: string,
  mimeType?: string,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<string> => {
  try {
    const data = await callGeminiApi('bring-to-life', { prompt, imageBase64, mimeType, modelName });
    return data.html || "";
  } catch (e) {
    console.warn("Bring To Life notice:", e instanceof Error ? e.message : String(e));
    throw e;
  }
};

/**
 * Transcribes audio base64 data using Gemini's native multimodal capabilities.
 */
export const transcribeAudio = async (base64Data: string, mimeType: string): Promise<string> => {
  try {
    const response = await callGeminiApi('generate', {
      model: DEFAULT_GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: "Extract and write down the exact spoken words in the audio. Reply with ONLY the transcribed text. Do not summarize, do not translate unless spoken in a different language, and do not add any meta-commentary like 'Transcription:' or 'Here is the text:'. If the audio is silent or unintelligible, return an empty string."
            }
          ]
        }
      ]
    });
    
    return safeExtractText(response).trim();
  } catch (error) {
    console.warn("Audio transcription notice:", error instanceof Error ? error.message : String(error));
    throw error;
  }
};
