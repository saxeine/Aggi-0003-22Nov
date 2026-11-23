import React from 'react';
import { act } from 'react-dom/test-utils';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_GEMINI_MODEL, GEMINI_MODELS, normalizeGeminiModelId } from '../constants/geminiModels';
import { normalizeModel } from '../server/gemini';
import { DEFAULT_MAGGI_SETTINGS } from '../maggi/config';
import { useThemeEngine } from '../hooks/useThemeEngine';
import GeminiModelDrawer from '../components/GeminiModelDrawer';

let root: Root | undefined;
let element: HTMLDivElement | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  element?.remove(); root = undefined; element = undefined;
  localStorage.clear();
});
const mount = (node: React.ReactNode) => {
  element = document.createElement('div'); document.body.appendChild(element);
  root = createRoot(element); act(() => root!.render(node));
};

describe('Gemini model selection', () => {
  it('offers both restored models and defaults to 3.8 in app and MAGGI', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(DEFAULT_MAGGI_SETTINGS.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(GEMINI_MODELS.map(m => m.id)).toEqual(expect.arrayContaining(['gemini-3.8-flash', 'gemini-3.7-flash']));
    expect(normalizeGeminiModelId()).toBe(DEFAULT_GEMINI_MODEL);
    expect(normalizeModel('')).toBe(DEFAULT_GEMINI_MODEL);
  });
  it.each(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-4-hydrogen'])('preserves %s in client and server routing', id => {
    expect(normalizeGeminiModelId(id)).toBe(id);
    expect(normalizeModel(id)).toBe(id);
  });
  it('does not rewrite speech models', () => {
    expect(normalizeModel('gemini-3.8-flash-tts')).toBe('gemini-3.8-flash-tts');
  });
  it.each(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-4-hydrogen'])('retains saved model %s on reload', id => {
    localStorage.setItem('gemini_media_aggregator_settings', JSON.stringify({ model: id }));
    let actual = '';
    function Harness() { actual = useThemeEngine().settings.model; return null; }
    mount(<Harness />);
    expect(actual).toBe(id);
  });
  it('shows 3.8 as the default and lists both choices', () => {
    mount(<GeminiModelDrawer onChange={() => {}} />);
    expect(element?.textContent).toContain('Gemini 3.8 Flash');
    const button = element!.querySelector('button')!;
    act(() => button.click());
    expect(element?.textContent).toContain('Gemini 3.7 Flash');
    expect(element?.textContent).toContain('Fast · Default');
  });
});
