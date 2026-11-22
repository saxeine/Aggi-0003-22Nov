import { MediaItem, Message } from "../types";

export const base64ToText = (base64: string): string => {
  try {
    if (!base64 || base64.startsWith('http://') || base64.startsWith('https://')) {
      return base64;
    }
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return base64;
  }
};

export const generateCustomAIResponse = async (
  baseUrl: string,
  apiKey: string,
  modelName: string,
  apiPath: string,
  currentPrompt: string,
  history: Message[],
  mediaItems: MediaItem[],
  options?: { signal?: AbortSignal; maxTokens?: number },
): Promise<{ text: string }> => {
  const messages: any[] = [];

  // System instruction
  messages.push({
    role: "system",
    content: "You are a helpful Media Aggregator assistant. Users will upload multiple images, video, audio, text files, or web links. You should answer questions based on the collective content. Do NOT start your replies with phrases like 'Based on the provided report,' or 'Based on the provided sources,'. Just answer the question directly."
  });

  // Attach context from media items
  const textFiles = mediaItems.filter(item => item.type === 'text' || item.type === 'link' || item.type === 'document' || item.type === 'sql' || item.type === 'html');
  if (textFiles.length > 0) {
    let context = "Attached content resources for reference:\n\n";
    textFiles.forEach(f => {
      const contentText = f.type === 'link' ? f.data : base64ToText(f.data);
      context += `--- Source: ${f.name} ---\n${contentText}\n\n`;
    });
    messages.push({
      role: "system",
      content: context
    });
  }

  const binaryFiles = mediaItems.filter(item => item.type !== 'text' && item.type !== 'link' && item.type !== 'document' && item.type !== 'sql' && item.type !== 'html');
  if (binaryFiles.length > 0) {
    messages.push({
      role: "system",
      content: `The user has also attached the following binary media files: ${binaryFiles.map(b => `${b.name} (${b.type})`).join(', ')}.`
    });
  }

  // Add conversation history
  history.forEach(msg => {
    messages.push({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content
    });
  });

  // Finally add the user's latest query
  messages.push({
    role: "user",
    content: currentPrompt
  });

  const response = await fetch('/api/custom-ai', {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-custom-ai-key': apiKey } : {}),
    },
    body: JSON.stringify({
      baseUrl,
      modelName,
      apiPath,
      messages,
      ...(options?.maxTokens ? { maxTokens: options.maxTokens } : {}),
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `Failed to generate response from Custom AI (HTTP ${response.status})`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error("Invalid response structure from Custom AI. Expected OpenAI-compatible 'choices[0].message.content' string.");
  }

  return { text: content };
};

export const generateCustomAISuggestions = async (
  baseUrl: string,
  apiKey: string,
  modelName: string,
  apiPath: string,
  mediaItems: MediaItem[]
): Promise<string[]> => {
  const textFiles = mediaItems.filter(item => item.type === 'text' || item.type === 'link' || item.type === 'document' || item.type === 'sql' || item.type === 'html');
  if (textFiles.length === 0) {
    return [
      "Analyze the content",
      "What are the main topics?",
      "Summarize the media"
    ];
  }

  let prompt = "Analyze the available context and list 3 short, insightful, user-facing questions. Return ONLY the questions as a JSON array string of strings, e.g. [\"What is the main topic?\", \"Can you summarize the findings?\", \"What are the next steps?\"]. Do not output markdown backticks or any other text.";

  let context = "Attached content:\n";
  textFiles.forEach(f => {
    const contentText = f.type === 'link' ? f.data : base64ToText(f.data);
    context += `--- ${f.name} ---\n${contentText}\n\n`;
  });

  const messages = [
    {
      role: "system",
      content: "You are a helpful assistant that generates 3 insightful, user-facing questions based on files or links."
    },
    {
      role: "user",
      content: `${context}\n\n${prompt}`
    }
  ];

  try {
    const response = await fetch('/api/custom-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-custom-ai-key': apiKey } : {}),
      },
      body: JSON.stringify({
        baseUrl,
        modelName,
        apiPath,
        messages
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to generate suggestions (HTTP ${response.status})`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    const cleanedJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 3);
    }
    return [];
  } catch (e) {
    console.warn("Custom AI suggestions failed, using fallbacks:", e);
    return [
      "Tell me more about these files.",
      "Summarize these files.",
      "What are the key insights?"
    ];
  }
};
