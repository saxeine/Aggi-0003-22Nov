export interface GeminiModelOption {
  id: string;
  name: string;
  shortLabel: string;
  tier: 'fast' | 'lite' | 'pro' | 'deep' | 'preview';
  requiresPaidKey?: boolean;
  recommended?: boolean;
  description: string;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GEMINI_MODELS: GeminiModelOption[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    shortLabel: 'Flash 3.8',
    tier: 'fast',
    recommended: true,
    description: 'Default Flash model. Availability depends on your Gemini API account.',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    shortLabel: 'Flash 3.7',
    tier: 'fast',
    description: 'Gemini 3.7 Flash model. Availability depends on your Gemini API account.',
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen (Flash)',
    shortLabel: 'Hydrogen 4',
    tier: 'fast',
    description: 'Fast multimodal model for summarization, research Q&A, and daily workflows.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    shortLabel: 'Flash Lite 3.1',
    tier: 'lite',
    description: 'Lowest-latency, lightweight flash model optimized for high-throughput quick prompts.',
  },
  {
    id: 'gemini-4-neon',
    name: 'Gemini 4 Neon (Pro)',
    shortLabel: 'Neon 4',
    tier: 'pro',
    requiresPaidKey: true,
    description: 'Complex text reasoning, coding, math, and STEM tasks. Requires a paid API key.',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    shortLabel: 'Argon 4',
    tier: 'pro',
    requiresPaidKey: true,
    description: 'High-capability Pro model for structured synthesis and multi-source analysis. Requires a paid API key.',
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    shortLabel: 'Carbon 4',
    tier: 'deep',
    requiresPaidKey: true,
    description: 'Maximum reasoning depth for architecture design, root-cause debugging, and audits. Requires a paid API key.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    shortLabel: 'Pro 3.1 Preview',
    tier: 'preview',
    description: 'Preview Pro model for general complex text and reasoning workloads.',
  },
];

export const PAID_GEMINI_MODEL_IDS = new Set([
  'gemini-4-carbon',
  'gemini-4-neon',
  'gemini-4-argon',
  'gemini-3-pro-image',
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
  'gemini-omni-1.2-flash',
  'genie-4',
]);

export const isPaidGeminiModel = (modelId?: string): boolean => {
  if (!modelId) return false;
  return PAID_GEMINI_MODEL_IDS.has(modelId.trim().toLowerCase());
};

export const isGemini4Model = (modelId?: string): boolean => {
  if (!modelId) return false;
  return modelId.trim().toLowerCase().startsWith('gemini-4-');
};

export const findGeminiModelOption = (modelId?: string): GeminiModelOption | undefined => {
  const norm = normalizeGeminiModelId(modelId);
  return GEMINI_MODELS.find((m) => m.id === norm);
};

export const normalizeGeminiModelId = (model?: string): string => {
  if (!model || !model.trim()) return DEFAULT_GEMINI_MODEL;
  const trimmed = model.trim();
  const norm = trimmed.toLowerCase();

  if (norm === 'gemini-3.8-flash' || norm === 'gemini-3.7-flash' || norm === 'gemini-3.1-pro-preview') {
    return norm;
  }
  if (norm === 'gemini-2.5-flash-preview-12-2025') {
    return DEFAULT_GEMINI_MODEL;
  }
  if (norm === 'gemini-4-hydrogen' || norm === 'gemini-4-neon' || norm === 'gemini-4-argon' || norm === 'gemini-4-carbon') {
    return norm;
  }
  if (norm === 'gemini-3.1-flash-lite') {
    return norm;
  }

  // Upgrade deprecated/legacy flash aliases to the default Flash model
  if (
    norm === 'flash' ||
    norm.includes('gemini-flash-latest') ||
    norm.includes('gemini-3.5-flash') ||
    norm.includes('gemini-3-flash') ||
    norm.includes('gemini-2.5-flash') ||
    norm.includes('gemini-2.0-flash') ||
    norm.includes('gemini-1.5-flash') ||
    norm === 'gemini-flash'
  ) {
    return DEFAULT_GEMINI_MODEL;
  }

  // Upgrade deprecated/legacy pro aliases to Gemini 4 Neon (or Argon if explicit)
  if (
    norm === 'pro' ||
    norm.includes('gemini-3-pro') ||
    norm.includes('gemini-2.5-pro') ||
    norm.includes('gemini-2.0-pro') ||
    norm.includes('gemini-1.5-pro') ||
    norm === 'gemini-pro'
  ) {
    return 'gemini-4-neon';
  }

  if (norm.includes('flash-lite') || norm === 'lite') {
    return 'gemini-3.1-flash-lite';
  }

  return trimmed;
};
