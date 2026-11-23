import React, { useState } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatPanel from '../components/ChatPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => ({ 'chat.askPlaceholder': 'Ask about the media...', 'chat.autoSubmit': 'Auto send selections', 'chat.autoSubmitOn': 'On', 'chat.autoSubmitOff': 'Off', 'chat.autoSubmitHelp': 'Send selected suggestions or library prompts immediately.', 'chat.library': 'Library' } as Record<string, string>)[key] || key }) }));
vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));
vi.mock('../components/PromptLibraryModal', () => ({ default: ({ isOpen, onSelect }: any) => isOpen ? <button onClick={() => onSelect('Library prompt')}>Choose library prompt</button> : null }));

let root: Root | undefined;
let container: HTMLDivElement;
const send = vi.fn();
const sendSuggestion = vi.fn();
const switchProvider = vi.fn();
const noop = () => {};
function Harness({ provider = 'gemini', isLoading = false }: { provider?: 'gemini' | 'ollama' | 'maggi'; isLoading?: boolean }) {
  const [input, setInput] = useState('A draft');
  return <ChatPanel sessionName="Session" history={[]} isLoading={isLoading} input={input} setInput={setInput} onSend={send}
    suggestions={['Suggested query']} onSuggestionClick={sendSuggestion} isSuggestionsLoading={false}
    onSeekMedia={noop} onPreviewArtifact={noop} onSaveAsSource={noop} onGenerateReport={noop} onOpenAudio={noop}
    onClearHistory={noop} onDeleteSession={noop} prompts={[]} onAddPrompt={noop} onDeletePrompt={noop}
    onToggleMindMap={noop} isMindMapLoading={false} isSidebarVisible={false} setIsSidebarVisible={noop}
    onRunTool={noop} toolLoadingState={{}} provider={provider} onSwitchProvider={switchProvider} />;
}
function mount(props: React.ComponentProps<typeof Harness> = {}) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  act(() => root!.render(<Harness {...props} />));
}
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))!; }
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; container?.remove(); vi.clearAllMocks(); });

describe('chat selection auto-send', () => {
  it('defaults off and fills the composer without submitting', () => {
    mount();
    expect(button('Auto send selections').getAttribute('aria-pressed')).toBe('false');
    act(() => button('Suggested query').click());
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Ask about the media..."]')?.value).toBe('Suggested query');
    expect(sendSuggestion).not.toHaveBeenCalled();
  });
  it('sends a selected suggestion directly once when enabled and preserves a draft', () => {
    mount();
    act(() => button('Auto send selections').click());
    expect(button('Auto send selections').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Suggested query').click());
    expect(sendSuggestion).toHaveBeenCalledTimes(1);
    expect(sendSuggestion).toHaveBeenCalledWith('Suggested query');
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Ask about the media..."]')?.value).toBe('A draft');
    expect(send).not.toHaveBeenCalled();
  });
  it('sends a library selection when enabled', () => {
    mount(); act(() => button('Auto send selections').click());
    act(() => (container.querySelector('button[title="Library"]') as HTMLButtonElement).click());
    act(() => button('Choose library prompt').click());
    expect(sendSuggestion).toHaveBeenCalledWith('Library prompt');
  });
  it('does not submit a suggestion during loading', () => {
    mount({ isLoading: true }); act(() => button('Auto send selections').click());
    expect(button('Suggested query').disabled).toBe(true);
    act(() => button('Suggested query').click());
    expect(sendSuggestion).not.toHaveBeenCalled();
  });
  it.each([['gemini', 'GM'], ['ollama', 'FL'], ['maggi', ''] ] as const)('marks active provider %s green and inactive sides red', (provider, active) => {
    mount({ provider });
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label^="FL/GM model switch"]')!;
    const [fl, , gm] = toggle.querySelectorAll('span');
    expect(fl.className).toContain(active === 'FL' ? 'text-green-400' : 'text-red-400');
    expect(gm.className).toContain(active === 'GM' ? 'text-green-400' : 'text-red-400');
  });
});
