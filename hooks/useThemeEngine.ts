
import { useState, useEffect } from 'react';
import { Theme, ThemeSettings } from '../types';
import { DEFAULT_GEMINI_MODEL } from '../constants/geminiModels';

const THEME_KEY = 'gemini_media_aggregator_theme';
const SETTINGS_KEY = 'gemini_media_aggregator_settings';

// Base Base Color Definitions (100% values)
const THEME_PRESETS = {
  dark: {
    '--c-bg-app': '#121212',
    '--c-bg-panel': '#1a1a1a',
    '--c-bg-card': '#262626',
    '--c-bg-input': '#000000',
    '--c-border': '#333333',
    '--c-text-main': '#4ade80', // Neon Green
    '--c-text-muted': '#86efac',
    '--c-text-dim': '#15803d',
  },
  light: {
    '--c-bg-app': '#f8fafc', // Slate 50
    '--c-bg-panel': '#ffffff', // White
    '--c-bg-card': '#f1f5f9', // Slate 100
    '--c-bg-input': '#ffffff', // White
    '--c-border': '#cbd5e1', // Slate 300
    '--c-text-main': '#0f172a', // Slate 900
    '--c-text-muted': '#334155', // Slate 700
    '--c-text-dim': '#64748b', // Slate 500
  },
  olive: {
    // Revised Sage/Olive Palette based on user request
    '--c-bg-app': '#ffffff',      // Pure White bg
    '--c-bg-panel': '#f7f9f6',    // Very subtle grey-green
    '--c-bg-card': '#94a38d',     // Sage Green (Pill background)
    '--c-bg-input': '#ffffff',    
    '--c-border': '#dce5db',      // Light sage border
    '--c-text-main': '#2f3e2e',   // Dark forest green text
    '--c-text-muted': '#4a5e48',  // Medium sage text
    '--c-text-dim': '#5f735d',    // Light sage text
  }
};

const DEFAULT_SETTINGS: ThemeSettings = { 
  bgBrightness: 100, 
  textBrightness: 100, 
  hue: 0,
  textSize: 100,
  showLabels: true,
  provider: 'gemini',
  model: DEFAULT_GEMINI_MODEL,
  enableCaching: false,
  geminiApiKey: '',
  maggiAutoIndexSession: true,
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: '',
  customBaseUrl: 'https://api.openai.com',
  customApiKey: '',
  customModelName: 'gpt-4o-mini',
  customApiPath: '/v1/chat/completions'
};

// HSL <-> RGB/Hex Utils
const hexToRgb = (hex: string): {r: number, g: number, b: number, a: string} => {
    hex = hex.replace('#', '');
    let alpha = '';
    if (hex.length === 8) {
      alpha = hex.substring(6, 8);
      hex = hex.substring(0, 6);
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b, a: alpha };
};

const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0; 
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s, l };
};

const hslToRgb = (h: number, s: number, l: number) => {
    let r, g, b;
    h = h % 360; 
    if (h < 0) h += 360;
    h /= 360;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return { 
      r: Math.round(r * 255), 
      g: Math.round(g * 255), 
      b: Math.round(b * 255) 
    };
};

const toHex = (n: number) => {
    const h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return h.length === 1 ? '0' + h : h;
};

const calculateFinalColor = (baseHex: string, brightnessFactor: number, hueShift: number) => {
    const { r, g, b, a } = hexToRgb(baseHex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const newH = h + hueShift;
    let { r: r2, g: g2, b: b2 } = hslToRgb(newH, s, l);

    r2 = Math.floor(r2 * brightnessFactor);
    g2 = Math.floor(g2 * brightnessFactor);
    b2 = Math.floor(b2 * brightnessFactor);

    return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}${a}`;
};

export const useThemeEngine = () => {
    const [theme, setTheme] = useState<Theme>('dark');
    const [settings, setSettings] = useState<ThemeSettings>(DEFAULT_SETTINGS);

    // Initialize state from local storage
    useEffect(() => {
        const savedTheme = localStorage.getItem(THEME_KEY) as Theme;
        if (savedTheme) setTheme(savedTheme);

        const savedSettings = localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                // Keys are never persisted: force session-only. A fresh visit
                // starts with empty keys; the user re-enters them as needed.
                parsed.geminiApiKey = '';
                parsed.customApiKey = '';
                if (
                  !parsed.model ||
                  parsed.model === 'gemini-3.5-flash' ||
                  parsed.model === 'gemini-2.5-flash' ||
                  parsed.model === 'gemini-2.5-flash-preview-12-2025' ||
                  parsed.model.startsWith('gemini-2.0-') ||
                  parsed.model.startsWith('gemini-1.')
                ) {
                    parsed.model = DEFAULT_GEMINI_MODEL;
                }
                if (
                  !parsed.ollamaEndpoint ||
                  parsed.ollamaEndpoint === 'https://than-conflict-caught-asthma.trycloudflare.com'
                ) {
                    parsed.ollamaEndpoint = 'http://localhost:11434';
                }
                setSettings({ ...DEFAULT_SETTINGS, ...parsed });
            } catch (e) {
                setSettings(DEFAULT_SETTINGS);
            }
        }
    }, []);

    // Persist changes
    useEffect(() => {
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    useEffect(() => {
        // Strip secrets before persisting: keys live only in memory.
        const { geminiApiKey, customApiKey, ...persistable } = settings;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistable));
    }, [settings]);

    // Color Engine Effect
    useEffect(() => {
        const root = document.documentElement;
        const baseColors = THEME_PRESETS[theme] as Record<string, string>;
        
        const bgFactor = settings.bgBrightness / 100;
        const textFactor = settings.textBrightness / 100;
        const hueShift = settings.hue || 0;

        Object.entries(baseColors).forEach(([key, value]) => {
          let finalColor = value;
          if (key.includes('bg') || key.includes('border')) {
            finalColor = calculateFinalColor(value, bgFactor, hueShift);
          } else if (key.includes('text')) {
            finalColor = calculateFinalColor(value, textFactor, hueShift);
          }
          root.style.setProperty(key, finalColor);
        });

        root.style.fontSize = `${settings.textSize || 100}%`;

    }, [theme, settings]);

    return {
        theme,
        setTheme,
        settings,
        setSettings
    };
};
