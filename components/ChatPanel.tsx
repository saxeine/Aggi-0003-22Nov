
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Message, PromptTemplate, MediaItem, ThemeSettings } from '../types';
import PromptLibraryModal from './PromptLibraryModal';
import { useLanguage } from '../contexts/LanguageContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatPanelProps {
  sessionName: string;
  history: Message[];
  isLoading: boolean;
  input: string;
  setInput: (val: string) => void;
  onSend: () => void;
  suggestions: string[];
  onSuggestionClick: (s: string, category?: 'insight' | 'discovery' | 'structure') => void;
  isSuggestionsLoading: boolean;
  onSeekMedia: (timestamp: string) => void;
  onPreviewArtifact: (code: string) => void;
  onSaveAsSource: (content: string) => void;
  onGenerateReport: () => void;
  onOpenAudio: () => void;
  onClearHistory: () => void;
  onDeleteSession: () => void;
  prompts: PromptTemplate[];
  onAddPrompt: (title: string, content: string) => void;
  onDeletePrompt: (id: string) => void;
  onToggleMindMap: () => void;
  isMindMapLoading: boolean;
  activeMediaItems?: MediaItem[];
  isSidebarVisible: boolean;
  setIsSidebarVisible: (v: boolean) => void;
  onRunTool: (toolId: string, payload?: any) => void;
  toolLoadingState: { [key: string]: boolean };
  onRefreshSuggestions?: () => void;
  sessionDescription?: string;
  onUpdateDescription?: (desc: string) => void;
  onDownloadSession?: () => void;
  onEditMessage?: (id: string, newContent: string) => void;
  onOpenSettings?: () => void;
  onSaveToMaggi?: (msg: Message, queryText: string) => Promise<void> | void;
  provider?: ThemeSettings['provider'];
  onSwitchProvider?: (provider: 'gemini' | 'ollama') => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  sessionName,
  history, 
  isLoading, 
  input, 
  setInput, 
  onSend,
  suggestions,
  onSuggestionClick,
  isSuggestionsLoading,
  onSeekMedia,
  onPreviewArtifact,
  onSaveAsSource,
  onGenerateReport,
  onOpenAudio,
  onClearHistory,
  onDeleteSession,
  prompts,
  onAddPrompt,
  onDeletePrompt,
  onToggleMindMap,
  isMindMapLoading,
  activeMediaItems = [],
  isSidebarVisible,
  setIsSidebarVisible,
  onRunTool,
  toolLoadingState,
  onRefreshSuggestions,
  sessionDescription = '',
  onUpdateDescription,
  onDownloadSession,
  onEditMessage,
  onOpenSettings,
  onSaveToMaggi,
  provider = 'gemini',
  onSwitchProvider
}) => {
  const { t } = useLanguage();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [activeMenu, setActiveMenu] = useState<'insight' | 'discovery' | 'structure' | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [savedMaggiMessageIds, setSavedMaggiMessageIds] = useState<Record<string, boolean>>({});
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSuggestionsMinimized, setIsSuggestionsMinimized] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [editingSelectionContext, setEditingSelectionContext] = useState<{before: string, editing: string, after: string} | null>(null);
  const editTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [includeQuestion, setIncludeQuestion] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [localDescription, setLocalDescription] = useState(sessionDescription);
  const [tableStyle, setTableStyle] = useState<'default' | 'modern' | 'minimal'>('default');

  useEffect(() => {
    setLocalDescription(sessionDescription);
  }, [sessionDescription]);

  const insightPrompts = useMemo(() => prompts.filter(p => p.tags?.includes('insight')), [prompts]);
  const discoveryPrompts = useMemo(() => prompts.filter(p => p.tags?.includes('discovery')), [prompts]);
  const structurePrompts = useMemo(() => prompts.filter(p => p.tags?.includes('structure')), [prompts]);

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    return history.filter(msg => msg.content.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [history, searchQuery]);

  const handleDownloadMessage = (msg: Message, index: number) => {
    let contentToDownload = msg.content;
    if (includeQuestion && index > 0) {
      const prevMsg = history[index - 1];
      if (prevMsg.role === 'user') {
        contentToDownload = `Q: ${prevMsg.content}\n\n---\n\nA: ${msg.content}`;
      }
    }
    const blob = new Blob([contentToDownload], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `answer_${msg.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadMenuId(null);
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Your browser does not support Speech Recognition."); return; }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => {
      console.warn('ChatPanel SpeechRecognition warning:', event.error);
      setIsListening(false);
    };
    recognition.onresult = (event: any) => { setInput(input + (input ? ' ' : '') + event.results[0][0].transcript); };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const toggleSpeaking = (text: string, id: string) => {
    if (speakingMessageId === id) { window.speechSynthesis.cancel(); setSpeakingMessageId(null); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingMessageId(null);
    setSpeakingMessageId(id);
    window.speechSynthesis.speak(utterance);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  const handleMenuClick = (promptContent: string, category: 'insight' | 'discovery' | 'structure') => { 
      setInput(promptContent); 
      setActiveMenu(null); 
      onSuggestionClick(promptContent, category); 
  };
  
  const toggleMenu = (menu: 'insight' | 'discovery' | 'structure') => setActiveMenu(activeMenu === menu ? null : menu);
  const handleCopyMessage = (content: string, id: string) => { navigator.clipboard.writeText(content).then(() => { setCopiedMessageId(id); setTimeout(() => setCopiedMessageId(null), 2000); }); };
  
  const getBubbleStyles = (msg: Message) => {
    if (msg.role === 'model') {
        if (msg.isError) return 'border-red-500 bg-red-900/20 text-red-200 rounded-tl-sm border';
        switch (msg.category) {
            case 'insight': return 'bg-gradient-to-br from-cyan-900/80 to-blue-900/80 text-white rounded-tl-sm border border-cyan-500/50 shadow-[0_4px_20px_rgba(6,182,212,0.15)] backdrop-blur-sm';
            case 'discovery': return 'bg-gradient-to-br from-fuchsia-900/80 to-purple-900/80 text-white rounded-tl-sm border border-fuchsia-500/50 shadow-[0_4px_20px_rgba(217,70,239,0.15)] backdrop-blur-sm';
            case 'structure': return 'bg-gradient-to-br from-amber-900/80 to-orange-900/80 text-white rounded-tl-sm border border-amber-500/50 shadow-[0_4px_20px_rgba(245,158,11,0.15)] backdrop-blur-sm';
            default: return 'bg-app-card text-app-text rounded-tl-sm border border-app-border shadow-sm';
        }
    }
    switch (msg.category) {
        case 'insight': return 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-tr-sm border border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]';
        case 'discovery': return 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white font-bold rounded-tr-sm border border-fuchsia-400 shadow-[0_0_15px_rgba(217,70,239,0.3)]';
        case 'structure': return 'bg-gradient-to-r from-amber-600 to-orange-600 text-white font-bold rounded-tr-sm border border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]';
        default: return 'bg-app-text text-app-bg font-bold rounded-tr-sm';
    }
  };

  const getSuggestionStyle = (index: number) => {
    const styles = [
      'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-300',
      'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-emerald-500/20 hover:border-emerald-300',
      'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-emerald-500/20 hover:border-emerald-300',
      'bg-orange-500/10 border-orange-500/30 text-orange-400 hover:bg-emerald-500/20 hover:border-emerald-300'
    ];
    return styles[index % styles.length];
  };

  const getSuggestionCategory = (index: number): 'insight' | 'discovery' | 'structure' => {
      const categories: ('insight' | 'discovery' | 'structure')[] = ['insight', 'discovery', 'structure'];
      return categories[index % categories.length];
  };

  const parseContent = (content: string) => {
    const codeBlockRegex = /```(\w+)?\s*([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
      parts.push({ type: 'code', lang: match[1] || 'text', code: match[2] });
      lastIndex = codeBlockRegex.lastIndex;
    }
    if (lastIndex < content.length) parts.push({ type: 'text', content: content.substring(lastIndex) });

    return parts.map((part, idx) => {
      if (part.type === 'code') {
        const canPreview = ['html', 'javascript', 'js', 'react', 'tsx', 'jsx'].includes((part.lang || '').toLowerCase());
        return (
          <div key={idx} className="my-4 rounded-lg overflow-hidden border border-app-border bg-black/30">
             <div className="flex items-center justify-between px-3 py-1.5 bg-black/50 border-b border-app-border">
                <span className="text-xs font-mono text-app-dim lowercase">{part.lang}</span>
                <div className="flex gap-2">
                   {canPreview && (
                     <button onClick={() => onPreviewArtifact(part.code || '')} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-bold transition-colors">
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                       {t('chat.openPreview')}
                     </button>
                   )}
                   <button onClick={() => navigator.clipboard.writeText(part.code || '')} className="text-xs text-app-dim hover:text-app-text">{t('chat.copy')}</button>
                </div>
             </div>
             <pre className="p-3 text-xs font-mono overflow-x-auto text-app-text/90">{part.code}</pre>
          </div>
        );
      } else {
        const mixedContent = (part.content || '') as string;
        // Pre-process timestamps to markdown links
        const processedContent = mixedContent.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, '[$1](seek:$1)');
        
        return (
            <div key={idx} className="markdown-body text-sm whitespace-pre-wrap">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        table: ({node, ...props}) => (
                            <div className="my-4 group relative pt-8">
                                <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
                                    <button onClick={() => setTableStyle('default')} className={`px-2 py-1 text-[10px] rounded ${tableStyle === 'default' ? 'bg-blue-600 text-white' : 'bg-app-card text-app-dim hover:text-app-text'}`}>Default</button>
                                    <button onClick={() => setTableStyle('modern')} className={`px-2 py-1 text-[10px] rounded ${tableStyle === 'modern' ? 'bg-purple-600 text-white' : 'bg-app-card text-app-dim hover:text-app-text'}`}>Modern</button>
                                    <button onClick={() => setTableStyle('minimal')} className={`px-2 py-1 text-[10px] rounded ${tableStyle === 'minimal' ? 'bg-emerald-600 text-white' : 'bg-app-card text-app-dim hover:text-app-text'}`}>Minimal</button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className={`min-w-full divide-y ${tableStyle === 'modern' ? 'divide-purple-500/30 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)] bg-purple-900/10' : tableStyle === 'minimal' ? 'divide-transparent border-transparent' : 'divide-app-border border-app-border bg-black/20'} border rounded-lg`} {...props} />
                                </div>
                            </div>
                        ),
                        thead: ({node, ...props}) => <thead className={`${tableStyle === 'modern' ? 'bg-purple-900/40' : tableStyle === 'minimal' ? 'border-b-2 border-app-text' : 'bg-app-panel/50'}`} {...props} />,
                        th: ({node, ...props}) => <th className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider ${tableStyle === 'modern' ? 'text-purple-300 border-b border-purple-500/30' : tableStyle === 'minimal' ? 'text-app-text' : 'text-app-text border-b border-app-border'}`} {...props} />,
                        td: ({node, ...props}) => <td className={`px-4 py-2 text-sm ${tableStyle === 'modern' ? 'text-purple-100/90 border-b border-purple-500/20' : tableStyle === 'minimal' ? 'text-app-text/80 py-3' : 'text-app-text/90 border-b border-app-border/50'}`} {...props} />,
                        a: ({node, href, children, ...props}) => {
                            if (href?.startsWith('seek:')) {
                                const tsValue = href.replace('seek:', '');
                                return (
                                    <button onClick={() => onSeekMedia(tsValue)} className="text-blue-400 hover:text-blue-300 hover:underline font-mono font-bold cursor-pointer inline-flex items-center gap-0.5 mx-0.5" title="Seek media">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                                        {children}
                                    </button>
                                );
                            }
                            return <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                        },
                        p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-2 space-y-1" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...props} />,
                        h1: ({node, ...props}) => <h1 className="text-xl font-bold mt-4 mb-2" {...props} />,
                        h2: ({node, ...props}) => <h2 className="text-lg font-bold mt-3 mb-2" {...props} />,
                        h3: ({node, ...props}) => <h3 className="text-md font-bold mt-2 mb-1" {...props} />,
                        blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-app-border pl-4 italic opacity-80 my-2" {...props} />,
                        strong: ({node, ...props}) => <strong className="font-bold text-current opacity-100" {...props} />,
                    }}
                >
                    {processedContent}
                </ReactMarkdown>
            </div>
        );
      }
    });
  };

  const renderMessageRow = (index: number, msg: Message) => {
    const isColored = msg.role === 'model' && !!msg.category;
    const actionBaseClass = isColored ? 'text-white/60 hover:text-white' : 'text-app-dim hover:text-app-text';
    const activeActionClass = isColored ? 'text-white animate-pulse' : 'text-app-text animate-pulse';

    let precedingQuery = '';
    if (msg.role === 'model') {
      for (let i = index - 1; i >= 0; i--) {
        if (history[i]?.role === 'user') {
          precedingQuery = history[i].content;
          break;
        }
      }
    }

    return (
    <div className={`flex flex-col mb-6 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
         <div className={`relative max-w-[95%] md:max-w-[85%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm group ${getBubbleStyles(msg)}`}>
          {msg.category && (
              <div className="text-[9px] uppercase tracking-widest mb-1 opacity-80 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${msg.role === 'user' ? 'bg-white' : 'bg-current'}`}></span>
                  {msg.category}
              </div>
          )}
          <div className="break-words font-sans">{parseContent(msg.content)}</div>
          {msg.citations && msg.citations.length > 0 && (
            <div className={`mt-3 pt-3 border-t ${isColored ? 'border-white/30' : 'border-app-border/50'} space-y-1.5`}>
              <p className="text-[10px] font-bold opacity-80 uppercase tracking-wider text-emerald-400">MAGGI Grounded Citations:</p>
              <div className="space-y-1">
                {msg.citations.map((c) => (
                  <div key={c.marker} className="rounded-lg bg-black/20 border border-app-border/40 px-2.5 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] font-bold text-emerald-300">[{c.marker}]</span>
                      <span className="font-semibold text-app-text truncate">{c.docName}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] opacity-75">{c.snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {msg.maggiMeta && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] opacity-75">
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-bold text-emerald-400">🧠 MAGGI</span>
              {msg.maggiMeta.model && <span>{msg.maggiMeta.model}</span>}
              {msg.maggiMeta.routedVia && <span>· via {msg.maggiMeta.routedVia}</span>}
              {typeof msg.maggiMeta.chunkCount === 'number' && <span>· {msg.maggiMeta.chunkCount} passages</span>}
              {typeof msg.maggiMeta.retrievalMs === 'number' && <span>· {msg.maggiMeta.retrievalMs}ms</span>}
            </div>
          )}
          {msg.groundingChunks && msg.groundingChunks.length > 0 && (
            <div className={`mt-3 pt-3 border-t ${isColored ? 'border-white/30' : 'border-app-border/50'}`}>
              <p className="text-xs font-bold opacity-70 mb-1 uppercase tracking-wider">{t('chat.sources')}:</p>
              <ul className="space-y-1">
                {msg.groundingChunks.map((chunk, idx) => chunk.web && (
                  <li key={idx}>
                    <a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline flex items-center gap-1 truncate opacity-80 hover:opacity-100">
                      <span className="truncate">{chunk.web.title || chunk.web.uri}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {msg.role === 'user' && (
            <div className="mt-2 pt-2 border-t border-white/20 flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity text-white/90">
                <button onClick={() => handleCopyMessage(msg.content, msg.id)} className="flex items-center gap-1 text-[10px] opacity-80 hover:opacity-100 transition-opacity" title={t('chat.copy')}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" /></svg>
                  {copiedMessageId === msg.id ? t('chat.copied') : t('chat.copy')}
                </button>
                 <button onClick={() => setInput(msg.content)} className="flex items-center gap-1 text-[10px] opacity-80 hover:opacity-100 transition-opacity" title={t('chat.retry')}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                    {t('chat.retry')}
                </button>
            </div>
          )}
          {msg.isError && (
            <div className="mt-3 pt-2.5 border-t border-red-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <span className="text-red-300">
                Are you seeing a Quota/API error? You can bypass this instantly by providing your own API key.
              </span>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  Set Custom API Key
                </button>
              )}
            </div>
          )}
          {msg.role === 'model' && !msg.isError && (
            <div className={`mt-2 pt-2 border-t ${isColored ? 'border-white/20' : 'border-app-border/30'} flex flex-wrap justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity`}>
              <button onClick={() => toggleSpeaking(msg.content, msg.id)} className={`flex items-center gap-1 text-xs transition-colors ${speakingMessageId === msg.id ? activeActionClass : actionBaseClass}`} title={t('chat.readAloud')}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
              <button onClick={() => handleCopyMessage(msg.content, msg.id)} className={`flex items-center gap-1 text-xs transition-colors ${actionBaseClass}`} title={t('chat.copy')}>{copiedMessageId === msg.id ? <span className={`${isColored ? 'text-white' : 'text-app-text'} font-bold animate-pulse`}>{t('chat.copied')}</span> : <>{t('chat.copy')}</>}</button>
              <button onClick={() => { setEditingMessageId(msg.id); setEditingContent(msg.content); }} className={`flex items-center gap-1 text-xs transition-colors ${actionBaseClass}`} title="Edit"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>Edit</button>
              <button onClick={() => onSaveAsSource(msg.content)} className={`flex items-center gap-1 text-xs transition-colors ${isColored ? 'text-white/60 hover:text-white' : 'text-app-dim hover:text-green-400'}`} title={t('chat.addSource')}><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>{t('chat.source')}</button>
              {onSaveToMaggi && msg.content.trim() && (
                <button
                  onClick={async () => {
                    await onSaveToMaggi(msg, precedingQuery || 'Workspace Query');
                    setSavedMaggiMessageIds((prev) => ({ ...prev, [msg.id]: true }));
                  }}
                  className={`flex items-center gap-1 text-xs transition-colors font-semibold ${
                    savedMaggiMessageIds[msg.id]
                      ? 'text-emerald-400'
                      : (isColored ? 'text-white/70 hover:text-emerald-300' : 'text-app-dim hover:text-emerald-400')
                  }`}
                  title="Save this query and answer into MAGGI Saved Queries"
                >
                  {savedMaggiMessageIds[msg.id] ? '✓ Saved to MAGGI' : '🔖 Save to MAGGI'}
                </button>
              )}
              {msg.category && (
                <div className="relative">
                  <button onClick={() => setDownloadMenuId(downloadMenuId === msg.id ? null : msg.id)} className={`flex items-center gap-1 text-xs transition-colors ${actionBaseClass}`} title="Download">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    Download
                  </button>
                  {downloadMenuId === msg.id && (
                    <div className="absolute bottom-full right-0 mb-2 p-2 bg-app-card border border-app-border rounded shadow-lg z-50 flex flex-col gap-2 w-48">
                      <label className="flex items-center gap-2 text-xs text-app-text cursor-pointer">
                        <input type="checkbox" checked={includeQuestion} onChange={e => setIncludeQuestion(e.target.checked)} />
                        Include Question
                      </label>
                      <button onClick={() => handleDownloadMessage(msg, index)} className="bg-purple-600 hover:bg-purple-500 text-white text-xs py-1 rounded w-full">Confirm Download</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  );
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-app-bg relative transition-colors duration-300 min-w-0">
      <div className="p-3 border-b border-app-border flex justify-between items-center bg-app-bg/80 backdrop-blur z-10 sticky top-0">
        <div className="flex items-center gap-3 relative">
          <button 
            onClick={() => setIsSidebarVisible(!isSidebarVisible)}
            className="p-1.5 text-app-dim hover:text-app-text transition-colors"
            title={isSidebarVisible ? t('chat.hideSidebar') : t('chat.showSidebar')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transform transition-transform ${isSidebarVisible ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex flex-col">
            <button 
               onClick={() => setIsSourceDropdownOpen(!isSourceDropdownOpen)}
               className="flex items-center gap-2 hover:bg-app-card rounded-lg px-2 py-1 transition-colors group relative"
            >
               <h1 className="text-lg font-bold text-app-text truncate max-w-[200px] md:max-w-md" title={sessionName}>{sessionName}</h1>
               <div className="bg-app-dim/20 text-app-text text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-app-dim/30">
                  {activeMediaItems.length}
               </div>
               <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-app-dim transition-transform ${isSourceDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                 <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
               </svg>
            </button>
            <div className="px-2">
              <button 
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className="text-[10px] text-app-dim hover:text-app-text flex items-center gap-1 transition-colors"
              >
                {isDescriptionExpanded ? 'Hide Description' : 'Show Description'}
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 transform transition-transform ${isDescriptionExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {isDescriptionExpanded && (
                <div className="mt-1 w-full max-w-md animate-fade-in">
                  <textarea
                    value={localDescription}
                    onChange={(e) => setLocalDescription(e.target.value)}
                    onBlur={() => onUpdateDescription && onUpdateDescription(localDescription)}
                    placeholder="Add a description for this session..."
                    className="w-full bg-app-panel border border-app-border rounded-lg p-2 text-xs text-app-text focus:outline-none focus:border-app-text resize-none"
                    rows={2}
                  />
                </div>
              )}
            </div>
          </div>
          
          {isLoading && (
             <div className="flex items-center gap-2 px-3 py-1 bg-app-card border border-app-border rounded-full animate-fade-in">
                <svg className="animate-spin h-3.5 w-3.5 text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-[10px] font-bold text-app-text tracking-widest uppercase">{t('chat.thinking')}</span>
             </div>
          )}

          {isSourceDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-app-card border border-app-border rounded-xl shadow-2xl z-50 animate-fade-in flex flex-col max-h-80">
                 <div className="p-3 border-b border-app-border bg-app-panel rounded-t-xl">
                    <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">{t('chat.activeSources')} ({activeMediaItems.length})</h3>
                 </div>
                 <div className="overflow-y-auto flex-1 p-2 space-y-1">
                    {activeMediaItems.length === 0 ? (
                       <p className="text-xs text-app-dim p-2 text-center italic">{t('chat.noSources')}</p>
                    ) : (
                       activeMediaItems.map(item => (
                          <div key={item.id} className="flex items-center gap-2 p-2 rounded hover:bg-app-bg transition-colors">
                              <div className="w-4 h-4 rounded-sm bg-app-dim/20 flex items-center justify-center text-app-text text-[8px] font-bold uppercase shrink-0">
                                 {item.type.slice(0,3)}
                              </div>
                              <span className="text-xs text-app-text truncate" title={item.name}>{item.name}</span>
                          </div>
                       ))
                    )}
                 </div>
              </div>
          )}
        </div>
        
        <div className="flex items-center gap-1">
           <div className="flex bg-app-panel rounded-lg p-0.5 border border-app-border mr-2 relative">
              <button onClick={onGenerateReport} className="p-2 text-white hover:text-white/80 rounded hover:bg-app-card transition-colors" title={t('chat.generateReport')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
              </button>
              <button onClick={() => onRunTool('data_table')} className={`p-2 text-yellow-500 hover:text-yellow-400 rounded hover:bg-app-card transition-colors ${toolLoadingState['data_table'] ? 'animate-pulse' : ''}`} title={t('chat.dataTable')}>
                {toolLoadingState['data_table'] ? (
                  <svg className="animate-spin h-4 w-4 text-yellow-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4"><path d="M9 6H5C4.44772 6 4 6.44772 4 7V20C4 20.5523 4.44772 21 5 21H19C19.5523 21 20 20.5523 20 20V16M9 6V3C9 2.44772 9.44772 2 10 2H14C14.5523 2 15 2.44772 15 3V6M9 6H15M20 16V7C20 6.44772 19.5523 6 19 6H15M20 16H14.5M14.5 16L11.5 13L14.5 10M14.5 16L17.5 13L14.5 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                )}
              </button>
              <button onClick={onOpenAudio} className="p-2 text-red-500 hover:text-red-400 rounded hover:bg-app-card transition-colors" title={t('chat.audioOverview')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" /></svg>
              </button>
              {onSwitchProvider && (
                <button
                  type="button"
                  onClick={() => onSwitchProvider(provider === 'ollama' ? 'gemini' : 'ollama')}
                  className="mx-1 self-center flex items-center gap-0.5 rounded-md border border-app-border bg-app-bg/90 px-2 py-1 text-[10px] font-bold tracking-wider transition-all hover:border-app-text/50"
                  aria-label="FL/GM model switch"
                  title={`FL/GM: ${provider === 'ollama' ? 'Local LLM active — click to switch to Gemini' : provider === 'gemini' ? 'Gemini active — click to switch to Local LLM' : `${provider.toUpperCase()} active — click to switch to Local LLM`}`}
                >
                  <span className={provider === 'ollama' ? 'text-emerald-400 font-black' : 'text-app-dim'}>FL</span>
                  <span className="text-app-dim/50">/</span>
                  <span className={provider === 'gemini' ? 'text-blue-400 font-black' : 'text-app-dim'}>GM</span>
                </button>
              )}
              <button onClick={onToggleMindMap} className={`p-2 text-purple-500 hover:text-purple-400 rounded hover:bg-app-card transition-colors ${isMindMapLoading ? 'animate-pulse' : ''}`} title={t('chat.mindMapView')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" /></svg>
              </button>
              <div className="w-px bg-app-border mx-1 my-1"></div>
              <button onClick={onClearHistory} className="p-2 text-blue-500 hover:text-blue-400 rounded hover:bg-app-card transition-colors" title={t('chat.clearHistory')}>
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
              </button>
              {onDownloadSession && (
                <button onClick={onDownloadSession} className="p-2 text-emerald-500 hover:text-emerald-400 rounded hover:bg-app-card transition-colors" title="Download Session">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
              )}
           </div>
           <button onClick={() => { setIsSearchOpen(!isSearchOpen); if (!isSearchOpen) setSearchQuery(''); }} className={`p-2 rounded-lg transition-colors ${isSearchOpen ? 'bg-app-text text-app-bg' : 'text-app-dim hover:text-app-text hover:bg-app-panel'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
           </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="px-4 py-2 bg-app-panel border-b border-app-border animate-pulse-fast-once">
          <input type="text" autoFocus placeholder={t('chat.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:border-app-text" />
        </div>
      )}

      <div className="flex-1 p-4" onClick={() => { setActiveMenu(null); setIsSourceDropdownOpen(false); }}>
        {history.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-app-dim opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <p className="text-lg font-medium">{t('chat.startConversation')}</p>
          </div>
        )}
        {filteredHistory.length > 0 && <Virtuoso ref={virtuosoRef} style={{ height: '100%' }} data={filteredHistory} itemContent={renderMessageRow} followOutput={'auto'} alignToBottom={true} className="overflow-x-hidden" />}
        {isLoading && (
           <div className="flex justify-start pt-4"><div className="bg-app-card rounded-2xl rounded-tl-sm px-5 py-4 border border-app-border"><div className="flex space-x-1"><div className="w-2 h-2 bg-app-dim rounded-full animate-bounce delay-0"></div><div className="w-2 h-2 bg-app-dim rounded-full animate-bounce delay-150"></div><div className="w-2 h-2 bg-app-dim rounded-full animate-bounce delay-300"></div></div></div></div>
        )}
      </div>

      {(suggestions.length > 0 || isSuggestionsLoading) && (
        <div className="px-4 py-2 bg-app-bg border-t border-app-border transition-all duration-300 ease-in-out" onClick={() => setActiveMenu(null)}>
           <div className="flex items-center justify-between mb-1">
             <p className="text-[10px] font-bold text-app-dim uppercase tracking-widest flex items-center gap-2">
               {t('chat.suggestedQuestions')}
             </p>
             <div className="flex items-center gap-2">
               {isSuggestionsLoading && (
                 <span className="animate-spin h-3 w-3 border-2 border-purple-500 border-t-transparent rounded-full"></span>
               )}
               {onRefreshSuggestions && (
                 <button 
                   onClick={onRefreshSuggestions}
                   disabled={isSuggestionsLoading}
                   className="p-1 text-app-dim hover:text-app-text hover:bg-app-panel rounded transition-colors disabled:opacity-50"
                   title="Refresh Suggestions"
                 >
                   <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${isSuggestionsLoading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                     <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                   </svg>
                 </button>
               )}
               <button 
                  onClick={() => setIsSuggestionsMinimized(!isSuggestionsMinimized)}
                  className="p-1 text-app-dim hover:text-app-text hover:bg-app-panel rounded transition-colors"
                  title={isSuggestionsMinimized ? t('chat.expandSuggestions') : t('chat.minimizeSuggestions')}
               >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 transform transition-transform ${isSuggestionsMinimized ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                     <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
               </button>
             </div>
           </div>
           {!isSuggestionsMinimized && (
             <div className="flex flex-wrap gap-2 pb-1 animate-fade-in">
               {suggestions.map((s, i) => (
                  <button 
                      key={i} 
                      onClick={() => setInput(s)}
                      disabled={isLoading} 
                      className={`px-3 py-1.5 border text-xs rounded-lg transition-colors text-left max-w-full truncate ${getSuggestionStyle(i)}`}
                  >
                      {s}
                  </button>
               ))}
             </div>
           )}
        </div>
      )}

      <div className="p-4 bg-app-panel border-t border-app-border relative">
        {['insight', 'discovery', 'structure'].map(menuType => activeMenu === menuType && (
          <div key={menuType} className={`absolute bottom-20 ${menuType === 'insight' ? 'left-4' : menuType === 'discovery' ? 'left-12' : 'left-20'} w-64 bg-app-card border border-app-border rounded-xl shadow-2xl p-2 z-20 animate-pulse-fast-once`}>
            <div className={`text-xs font-bold uppercase tracking-wider px-2 py-1 mb-1 ${menuType === 'insight' ? 'text-cyan-400' : menuType === 'discovery' ? 'text-fuchsia-400' : 'text-amber-400'}`}>{menuType}</div>
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {(menuType === 'insight' ? insightPrompts : menuType === 'discovery' ? discoveryPrompts : structurePrompts).map((p, i) => (
                <button key={i} onClick={() => handleMenuClick(p.content, menuType as any)} className="text-left text-xs text-app-text hover:bg-app-panel px-2 py-2 rounded-lg transition-colors">{p.content}</button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-3 relative items-end">
          <div className="flex gap-2 pb-3">
             <button onClick={() => setIsLibraryOpen(true)} className="p-2 rounded-full transition-colors hover:bg-app-bg text-emerald-500/70 hover:text-emerald-500" title={t('chat.library')}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" /></svg></button>
             <button onClick={() => toggleMenu('insight')} className={`p-2 rounded-full transition-colors ${activeMenu === 'insight' ? 'bg-emerald-500/20 text-emerald-500' : 'hover:bg-app-bg text-blue-500/70 hover:text-emerald-500'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg></button>
             <button onClick={() => toggleMenu('discovery')} className={`p-2 rounded-full transition-colors ${activeMenu === 'discovery' ? 'bg-emerald-500/20 text-emerald-500' : 'hover:bg-app-bg text-purple-500/70 hover:text-emerald-500'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg></button>
             <button onClick={() => toggleMenu('structure')} className={`p-2 rounded-full transition-colors ${activeMenu === 'structure' ? 'bg-emerald-500/20 text-emerald-500' : 'hover:bg-app-bg text-orange-500/70 hover:text-emerald-500'}`}><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg></button>
          </div>
          <div className="flex-1 relative">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('chat.askPlaceholder')} disabled={isLoading} className="w-full bg-app-input border border-app-border text-app-text rounded-xl pl-4 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-app-text/50 focus:border-app-text transition-all placeholder-app-dim disabled:opacity-50" />
            <button onClick={toggleListening} className={`absolute right-3 top-1/2 transform -translate-y-1/2 p-1.5 rounded-full transition-all ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'text-app-dim hover:text-app-text hover:bg-app-bg'}`} title={t('chat.voiceInput')}><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" /></svg></button>
          </div>
          <button onClick={() => onSend()} disabled={isLoading} className="bg-app-text text-app-bg p-3 rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center">
            {isLoading ? <span className="animate-spin h-6 w-6 border-2 border-purple-500 border-t-transparent rounded-full"></span> : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>}
          </button>
        </div>
      </div>
      <PromptLibraryModal 
         isOpen={isLibraryOpen}
         onClose={() => setIsLibraryOpen(false)}
         prompts={prompts}
         onSelect={(content) => { setInput(content); setIsLibraryOpen(false); }}
         onAdd={onAddPrompt}
         onDelete={onDeletePrompt}
      />

      {editingMessageId && (
        <div className="fixed inset-0 z-[100] flex flex-col p-4 md:p-12 bg-slate-900/95 backdrop-blur-3xl overflow-hidden animate-fade-in">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-amber-400 flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Reply
            </h2>
            <button 
              onClick={() => { setEditingMessageId(null); setEditingContent(''); setEditingSelectionContext(null); }}
              className="p-2 rounded-full hover:bg-white/10 text-slate-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 flex flex-col relative space-y-4">
             <div className="flex-1 flex flex-col relative border-2 border-slate-700 rounded-2xl overflow-hidden shadow-2xl bg-slate-800">
               {!editingSelectionContext ? (
                 <>
                   <div className="p-2 bg-slate-800/80 border-b border-slate-700 flex gap-2">
                     <button 
                       onClick={() => {
                         if (!editTextAreaRef.current) return;
                         const start = editTextAreaRef.current.selectionStart;
                         const end = editTextAreaRef.current.selectionEnd;
                         if (start !== end && start !== undefined && end !== undefined) {
                           setEditingSelectionContext({
                             before: editingContent.substring(0, start),
                             editing: editingContent.substring(start, end),
                             after: editingContent.substring(end)
                           });
                         } else {
                           alert("Please highlight the text you want to edit first.");
                         }
                       }} 
                       className="text-xs px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500 rounded text-indigo-200 hover:text-white transition-colors"
                       title="Edit only the highlighted text"
                     >
                       Edit Highlighted Text Only
                     </button>
                   </div>
                   <textarea 
                      ref={editTextAreaRef}
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="w-full flex-1 p-6 bg-transparent text-amber-300 font-mono text-lg leading-relaxed focus:outline-none resize-none"
                      placeholder="Edit this response..."
                   />
                 </>
               ) : (
                 <>
                   <div className="p-4 bg-slate-900/50 text-slate-500 whitespace-pre-wrap shrink-0 max-h-32 overflow-y-auto text-sm border-b border-slate-700 select-none">
                     {editingSelectionContext.before.slice(-300)}
                   </div>
                   
                   <textarea 
                      value={editingSelectionContext.editing}
                      onChange={(e) => setEditingSelectionContext({...editingSelectionContext, editing: e.target.value})}
                      className="w-full flex-1 p-6 bg-transparent text-amber-300 font-mono text-xl leading-relaxed focus:outline-none resize-none border-y-2 border-indigo-500/50 bg-indigo-900/10 shadow-inner"
                      autoFocus
                   />
                   
                   <div className="p-4 bg-slate-900/50 text-slate-500 whitespace-pre-wrap shrink-0 max-h-32 overflow-y-auto text-sm border-t border-slate-700 select-none">
                     {editingSelectionContext.after.slice(0, 300)}
                   </div>
                 </>
               )}
             </div>
             
             {editingSelectionContext ? (
               <div className="flex justify-end gap-4 shrink-0">
                  <button 
                    onClick={() => setEditingSelectionContext(null)} 
                    className="px-6 py-3 rounded-xl font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  >
                    Cancel Selection Edit
                  </button>
                  <button 
                    onClick={() => {
                       setEditingContent(editingSelectionContext.before + editingSelectionContext.editing + editingSelectionContext.after);
                       setEditingSelectionContext(null);
                    }} 
                    className="px-8 py-3 rounded-xl font-bold bg-indigo-500 text-white hover:bg-indigo-400 shadow-lg shadow-indigo-500/20 transition-all transform hover:-translate-y-0.5"
                  >
                    Apply Changes to Main Editor
                  </button>
               </div>
             ) : (
               <div className="flex justify-end gap-4 shrink-0">
                  <button 
                    onClick={() => { setEditingMessageId(null); setEditingContent(''); }} 
                    className="px-6 py-3 rounded-xl font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                       if(onEditMessage) onEditMessage(editingMessageId, editingContent);
                       setEditingMessageId(null);
                       setEditingContent('');
                       setEditingSelectionContext(null);
                    }} 
                    className="px-8 py-3 rounded-xl font-bold bg-amber-500 text-slate-900 hover:bg-amber-400 shadow-lg shadow-amber-500/20 transition-all transform hover:-translate-y-0.5"
                  >
                    Save & Update Complete Message
                  </button>
               </div>
             )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatPanel;
