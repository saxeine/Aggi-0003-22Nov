import { AudioEngine, generateCustomSpeech } from './services/customSpeech';

import React, { useState, useEffect } from 'react';
import MediaPanel from './components/MediaPanel';
import ChatPanel from './components/ChatPanel';
import SessionModal from './components/SessionModal';
import ArtifactPreview from './components/ArtifactPreview';
import MediaViewer from './components/MediaViewer';
import MindMapViewer from './components/MindMapViewer';
import MindMapPopup from './components/MindMapPopup';
import LibraryView from './components/LibraryView';
import SettingsPanel from './components/SettingsPanel';
import StudioView from './components/StudioView';
import OfficeTools from './components/OfficeTools';
import { MediaSuiteView } from './components/MediaSuiteView';
import MIPrOMPTLibraryView from './components/MIPrOMPTLibraryView';
import { FinanceView } from './components/FinanceView';
import MaggiView, { MaggiTab } from './components/MaggiView';
import SxaBoardApp from './src/media_suite/SxaBoardTool/App';
import { MediaItem, Message, VoiceSettings, PromptTemplate, CastMember, MIPrOMPTItem, ThemeSettings } from './types';
import { useThemeEngine } from './hooks/useThemeEngine';
import { useSessionManager } from './hooks/useSessionManager';
import { useAI } from './hooks/useAI';
import { usePromptLibrary } from './hooks/usePromptLibrary';
import { useMIPrOMPTLibrary } from './hooks/useMIPrOMPTLibrary';
import { useCastLibrary } from './hooks/useCastLibrary';
import { useCharacterLibrary } from './hooks/useCharacterLibrary';
import { generateResponse, generateSpeech, searchWeb, chunkText, base64ToText, translateText } from './services/gemini'; 
import { generateUnifiedAIResponse } from './services/unifiedAi';
import { buildToolPrompt } from './utils/toolPrompts';
import { buildAudioPlayerHtml, buildAudioNoticeHtml, buildPodcastDocumentHtml, buildErrorHtml } from './utils/podcastHtml';
import { buildSessionWebsiteHtml, sessionWebsiteFilename, sessionWebsiteSourceName, downloadSessionWebsiteHtml } from './utils/sessionWebsite';
import type { PodcastRole } from './utils/podcastGating';
import { loadAudioBlobFromIDB } from './services/storage';
import { saveGlobalHistorySafely } from './services/historyStorage';
import { savePodcastToHistory } from './utils/podcastHistory';
import {
  buildMaggiFallbackMediaItem,
  filterNonDuplicateSessionMedia,
  loadAutoPodcastDraftFromStore,
  MAGGI_CONTENTS_HEADER,
} from './utils/podcastSources';
import { getMaggiStore } from './services/maggi/store';
import { generateMaggiSpeech } from './services/maggi/brain';
import { DEFAULT_GEMINI_MODEL } from './constants/geminiModels';

const App: React.FC = () => {
  const { theme, setTheme, settings, setSettings } = useThemeEngine();
  const { castLibrary, addCastMember, updateCastMember, deleteCastMember, resetLibrary } = useCastLibrary();
  const { characters, addCharacter, updateCharacter, deleteCharacter } = useCharacterLibrary();
  const { miprompts, addMIPrOMPT, updateMIPrOMPT, deleteMIPrOMPT, importCSV } = useMIPrOMPTLibrary();
  
  const { 
    sessions, 
    setSessions,
    activeSessionId, 
    setActiveSessionId, 
    activeSession, 
    createNewSession, 
    deleteSession, 
    renameSession, 
    updateSessionDescription,
    combineSessions,
    reorderSessions,
    clearSessionHistory,
    updateActiveSession,
    updateSessionById,
    handleExportSession,
    processUploadedFiles,
    addTextItem,
    handleAddLink,
    batchAddLinks,
    handleRemoveMedia,
    handleToggleMedia,
    handleToggleAllMedia,
    combineMediaItems,
    addHtmlItem,
    saveSessionWebsite,
    isStorageInitialized
  } = useSessionManager();

  // Layout State
  const [viewMode, setViewMode] = useState<'library' | 'workspace' | 'studio' | 'miprompt' | 'finance' | 'media' | 'office_tools' | 'sxa_board' | 'maggi'>('library');
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [lastUsedBuilder, setLastUsedBuilder] = useState<MIPrOMPTItem['type'] | null>(null);
  const [generatedAudio, setGeneratedAudio] = useState<string | null>(null);
  const [focusedMediaItem, setFocusedMediaItem] = useState<MediaItem | null>(null);
  const [isMindMapOpen, setIsMindMapOpen] = useState(false);
  const [isFullWidthPreview, setIsFullWidthPreview] = useState(false);
  const [isPreviewMinimized, setIsPreviewMinimized] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  
  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'ai' | 'visual' | 'cast'>('ai');

  const toggleSettings = (tab: 'ai' | 'visual' | 'cast' = 'ai') => {
    setActiveSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  // Sidebar State
  const [activeSideTab, setActiveSideTab] = useState<'sessions' | 'sources' | 'tools' | 'audio'>('sources');
  const [maggiInitialTab, setMaggiInitialTab] = useState<MaggiTab>('chat');
  const [studioInitialTool, setStudioInitialTool] = useState<string | null>(null);
  const [podcastDraftTrigger, setPodcastDraftTrigger] = useState<{ text: string; key: number } | null>(null);
  const [hasExplicitAudioProvider, setHasExplicitAudioProvider] = useState<boolean>(() => {
    try {
      return localStorage.getItem('gemini_media_aggregator_explicit_audio_provider') === '1';
    } catch {
      return false;
    }
  });

  const markExplicitAudioProvider = () => {
    setHasExplicitAudioProvider(true);
    try {
      localStorage.setItem('gemini_media_aggregator_explicit_audio_provider', '1');
    } catch {
      /* ignore storage errors */
    }
  };

  const handleSettingsUpdateFromPanel = (next: ThemeSettings) => {
    if (next.provider !== settings.provider) {
      markExplicitAudioProvider();
    }
    setSettings(next);
  };

  // Drawer States
  const [isMainPanelCollapsed, setIsMainPanelCollapsed] = useState(false); 
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false); 
  
  // Tool Loading State
  const [toolLoadingState, setToolLoadingState] = useState<Record<string, boolean>>({});

  // Voice Settings State
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
      host: 'Kore',
      hostLabel: 'Narrator Bot',
      hostBio: 'A clear, authoritative, and friendly voice, perfect for hosting and guiding the listener through complex topics.',
      hostAvatar: 'https://picsum.photos/seed/narrator/60/60',
      hostMemberId: 'sys-host-1',
      expert: 'Puck',
      expertLabel: 'Dr. Insight',
      expertBio: 'A knowledgeable and articulate voice, ideal for explaining intricate details and offering expert opinions.',
      expertAvatar: 'https://picsum.photos/seed/expert/60/60',
      expertMemberId: 'sys-expert-1',
      guest: 'Zephyr',
      guestLabel: 'Curious Listener',
      guestBio: 'An engaging and inquisitive voice, representing the audience and asking clarifying questions.',
      guestAvatar: 'https://picsum.photos/seed/listener/60/60',
      guestMemberId: 'sys-guest-1',
      length: 'Short (1-2 min)',
      language: 'English'
  });

  // Explicitly configured podcast speaker roles; starts empty so users must
  // configure speaker(s) (or press Use Default) before generating a podcast.
  const [touchedRoles, setTouchedRoles] = useState<PodcastRole[]>([]);

  const [selectedMIPrOMPT, setSelectedMIPrOMPT] = useState<{type: 'prB' | 'ctB' | 'txS', content: string} | null>(null);

  // MindMap Popup State
  const [mindMapPopup, setMindMapPopup] = useState<{ title: string, content: string | null, isLoading: boolean } | null>(null);

  const backgroundTemplateImage = activeSession?.mediaItems.find(item => item.type === 'image');

  // Initial Route Check
  useEffect(() => {
    if (isStorageInitialized) {
      if (sessions.length > 0) {
        setViewMode('library');
      } else {
        setViewMode('workspace');
      }
    }
  }, [isStorageInitialized]);

  // Auto-Preview Callback for Maps
  const handleAutoPreview = (code: string) => {
      setPreviewCode(code);
      setFocusedMediaItem(null);
      setIsPreviewMinimized(false);
      setIsFullWidthPreview(false);
      if (isMindMapOpen) setIsMainPanelCollapsed(true);
  };

  const {
    input,
    setInput,
    isLoading,
    isSuggestionsLoading,
    handleSend,
    triggerSuggestion,
    generateSuggestionsForSession,
    autoTagMediaItems,
    generateMindMap,
    isMindMapLoading
  } = useAI(activeSession, updateActiveSession, updateSessionById, settings, handleAutoPreview);
  
  const { prompts, addPrompt, removePrompt } = usePromptLibrary();

  const [isCastLibraryOpen, setIsCastLibraryOpen] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSessionDefaultName, setNewSessionDefaultName] = useState('Session 001');

  const handleOpenCreateSessionModal = () => {
      const nextNum = sessions.length + 1;
      const paddedNum = nextNum.toString().padStart(3, '0');
      setNewSessionDefaultName(`Session ${paddedNum}`);
      setIsModalOpen(true);
  };

  const handleCreateSession = (name: string, description?: string) => {
      createNewSession(name, description);
      setInput('');
      setPreviewCode(null);
      setFocusedMediaItem(null);
      setIsMindMapOpen(false);
      setIsModalOpen(false);
      setViewMode('workspace'); 
  };

  const handleDeleteSession = (id: string) => {
      deleteSession(id);
      if (activeSessionId === id) {
          setPreviewCode(null);
          setFocusedMediaItem(null);
          setIsMindMapOpen(false);
      }
  };

  const handleDownloadSession = () => {
      if (!activeSession) return;
      
      let txt = `Session: ${activeSession.name}\n`;
      txt += `Created: ${new Date(activeSession.createdAt).toLocaleString()}\n\n`;
      txt += `--- SOURCES (${activeSession.mediaItems.length}) ---\n`;
      activeSession.mediaItems.forEach(item => {
          txt += `\n[${item.type.toUpperCase()}] ${item.name}\n`;
          if (item.type === 'text') {
              try {
                  const decoded = new TextDecoder().decode(Uint8Array.from(atob(item.data), c => c.charCodeAt(0)));
                  txt += `${decoded}\n`;
              } catch(err){}
          } else {
              txt += `(Binary or Base64 data hidden)\n`;
          }
      });
      txt += `\n--- HISTORY ---\n`;
      activeSession.history.forEach(msg => {
          txt += `\n[${msg.role.toUpperCase()}] ${new Date(msg.timestamp).toLocaleString()}\n`;
          txt += `${msg.content}\n`;
      });
      
      const blob = new Blob([txt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const safeName = activeSession.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `session_${safeName}_${new Date().toISOString().slice(0,10)}.txt`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleSelectSession = (id: string) => {
      setActiveSessionId(id);
      setViewMode('workspace');
  };

  // Offline "session → website": no AI call, no API key. Builds a
  // self-contained page from the session's (selected) sources, downloads
  // it as <session>-website.html, saves it back into the session as a
  // `Website: …` HTML source, and opens it in the preview pane.
  const handleGenerateSessionWebsite = (sessionId: string) => {
      const target = sessions.find(s => s.id === sessionId);
      if (!target) return;
      const html = buildSessionWebsiteHtml(target);
      downloadSessionWebsiteHtml(html, sessionWebsiteFilename(target));
      saveSessionWebsite(target.id, sessionWebsiteSourceName(target), html);
      setActiveSessionId(target.id);
      setViewMode('workspace');
      setPreviewCode(html);
      setFocusedMediaItem(null);
      setIsPreviewMinimized(false);
      setIsFullWidthPreview(false);
      if (isMindMapOpen) setIsMainPanelCollapsed(true);
  };

  const onFileUpload = async (files: File[]) => {
      const result = await processUploadedFiles(files);
      if (result) {
          generateSuggestionsForSession(result.targetId, result.combinedMedia);
          if (settings.autoTagSources && result.newItems) {
              autoTagMediaItems(result.targetId, result.newItems);
          }
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const onAddLink = (url: string) => {
      const result = handleAddLink(url);
      if (result) {
          generateSuggestionsForSession(result.targetId, result.combinedMedia);
          if (settings.autoTagSources && result.newItems) {
              autoTagMediaItems(result.targetId, result.newItems);
          }
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const handleAddText = (title: string, content: string) => {
      const result = addTextItem(title, content);
      if (result) {
          generateSuggestionsForSession(result.targetId, result.combinedMedia);
          if (settings.autoTagSources && result.newItems) {
              autoTagMediaItems(result.targetId, result.newItems);
          }
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const handleSearchWeb = async (query: string) => {
      const results = await searchWeb(query);
      if (results && results.length > 0) {
          const result = batchAddLinks(results);
          if (result) {
              generateSuggestionsForSession(result.targetId, result.combinedMedia);
              if (settings.autoTagSources && result.newItems) {
                  autoTagMediaItems(result.targetId, result.newItems);
              }
              if (isMindMapOpen && activeSession) {
                  updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
                  setTimeout(() => generateMindMap(), 100);
              }
          }
      } else {
          alert("No search results found or API search limit reached.");
      }
  };

  const handleRefillSearch = async (query: string) => {
      if (!activeSession) return;
      const activeIds = activeSession.selectedMediaIds;
      const unselectedLinks = activeSession.mediaItems.filter(item => item.type === 'link' && !activeIds.includes(item.id));
      const keptLinks = activeSession.mediaItems.filter(item => item.type === 'link' && activeIds.includes(item.id));
      if (unselectedLinks.length > 0) {
          unselectedLinks.forEach(item => {
              handleRemoveMedia(item.id);
          });
      }
      const excludeUrls = keptLinks.map(item => item.data);
      const results = await searchWeb(query, excludeUrls);
      if (results && results.length > 0) {
          const result = batchAddLinks(results);
          if (result) {
              generateSuggestionsForSession(result.targetId, result.combinedMedia);
              if (settings.autoTagSources && result.newItems) {
                  autoTagMediaItems(result.targetId, result.newItems);
              }
              if (isMindMapOpen) {
                  updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
                  setTimeout(() => generateMindMap(), 100);
              }
          }
      } else {
          alert("Could not find new unique resources for this topic.");
      }
  };


  const onRemoveMedia = (id: string) => {
      const result = handleRemoveMedia(id);
      
      // Also remove from global history
      try {
          const savedGlobal = localStorage.getItem('global_podcast_history');
          if (savedGlobal) {
              const globalHistory = JSON.parse(savedGlobal);
              const updated = globalHistory.filter((item: any) => item.id !== id);
              saveGlobalHistorySafely(updated);
          }
      } catch (err) {
          console.error("Failed to remove from global podcast history:", err);
      }

      if (focusedMediaItem?.id === id) setFocusedMediaItem(null);

      if (result) {
          generateSuggestionsForSession(result.targetId, result.updatedMedia);
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const handleRenameMediaItem = (id: string, newName: string) => {
    if (activeSession) {
      updateActiveSession(s => ({
        ...s,
        mediaItems: s.mediaItems.map(item =>
          item.id === id ? { ...item, name: newName } : item
        )
      }));
      // Re-generate suggestions as media item name might affect prompts/context
      generateSuggestionsForSession(activeSession.id, activeSession.mediaItems.map(item => 
          item.id === id ? { ...item, name: newName } : item
      ));
      if (isMindMapOpen && activeSession) {
          updateSessionById(activeSession.id, s => ({ ...s, mindMapData: undefined }));
          setTimeout(() => generateMindMap(), 100);
      }
    }

    // Also rename in global history
    try {
        const savedGlobal = localStorage.getItem('global_podcast_history');
        if (savedGlobal) {
            const globalHistory = JSON.parse(savedGlobal);
            const updated = globalHistory.map((item: any) => 
                item.id === id ? { ...item, name: newName } : item
            );
            saveGlobalHistorySafely(updated);
        }
    } catch (err) {
        console.error("Failed to rename in global podcast history:", err);
    }
  };

  const onToggleMedia = (id: string) => {
      const result = handleToggleMedia(id);
      if (result) {
          generateSuggestionsForSession(result.targetId, result.activeItems);
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const onToggleAllMedia = (selectAll: boolean) => {
      const result = handleToggleAllMedia(selectAll);
      if (result) {
          generateSuggestionsForSession(result.targetId, result.activeItems);
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const onCombineMedia = (ids: string[], name: string) => {
      const result = combineMediaItems(ids, name);
      if (result) {
          generateSuggestionsForSession(result.targetId, result.combinedMedia);
          if (settings.autoTagSources && result.newItems) {
              autoTagMediaItems(result.targetId, result.newItems);
          }
          if (isMindMapOpen && activeSession) {
             updateSessionById(result.targetId, s => ({ ...s, mindMapData: undefined }));
             setTimeout(() => generateMindMap(), 100);
          }
      }
  };

  const handleSeekMedia = (timeString: string) => {
    const parts = timeString.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    
    const performSeek = () => {
      const focusedMediaEl = document.querySelector('.active-media-viewer') as HTMLMediaElement;
      if (focusedMediaEl) {
          focusedMediaEl.currentTime = seconds;
          focusedMediaEl.play().catch(e => console.log("Autoplay blocked", e));
          return true;
      }
      const allMedia = Array.from(document.querySelectorAll('video, audio')) as HTMLMediaElement[];
      
      // Also check inside iframes (like ArtifactPreview)
      const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
      iframes.forEach(iframe => {
        try {
          if (iframe.contentDocument) {
            const iframeMedia = Array.from(iframe.contentDocument.querySelectorAll('video, audio')) as HTMLMediaElement[];
            allMedia.push(...iframeMedia);
          }
        } catch (e) {
          // Ignore cross-origin errors if any
        }
      });

      const playingMedia = allMedia.find(el => !el.paused && !el.ended);
      if (playingMedia) {
          playingMedia.currentTime = seconds;
          playingMedia.play().catch(e => console.log("Autoplay blocked", e));
          return true;
      }
      if (allMedia.length > 0) {
          const firstMedia = allMedia[0];
          firstMedia.currentTime = seconds;
          firstMedia.play().catch(e => console.log("Autoplay blocked", e));
          return true;
      }
      return false;
    };

    if (!performSeek()) {
      // If no media element is found, try to find a media item in the session and focus it
      const mediaItem = activeSession?.mediaItems.find(item => item.type === 'video' || item.type === 'audio');
      if (mediaItem) {
        setFocusedMediaItem(mediaItem);
        setPreviewCode(null);
        setIsPreviewMinimized(false);
        if (isMindMapOpen) setIsMainPanelCollapsed(true);
        
        // Wait for render then seek
        setTimeout(() => {
          performSeek();
        }, 100);
      }
    }
  };

  const handleFocusMedia = (item: MediaItem) => {
    if (focusedMediaItem?.id === item.id) {
      setFocusedMediaItem(null);
      setIsFullWidthPreview(false);
    } else {
      setFocusedMediaItem(item);
      setPreviewCode(null);
      setIsFullWidthPreview(false); 
    }
  };

  const handleGenerateReport = () => {
    handleSend("Please analyze the currently selected media sources and generate a comprehensive, structured report. Include an Executive Summary, Key Findings, Detailed Analysis of the content, and Conclusions.");
  };

  const handleToolAction = async (toolId: string, payload?: any) => {
     const isPodcastFormatTool = toolId === 'podcast_1' || toolId === 'podcast_2' || toolId === 'podcast_3';
     if (isPodcastFormatTool && !touchedRoles.includes('host')) {
       setActiveSideTab('audio');
       return;
     }
     if (!activeSession && (!payload || !payload.isIndependent)) return;
     setPreviewCode(null);
     setGeneratedAudio(null);
     setIsPreviewMinimized(false);
     setToolLoadingState(prev => ({ ...prev, [toolId]: true }));
     
     if (toolId === 'prompt_builder') setLastUsedBuilder('prB');
     else if (toolId === 'content_builder') setLastUsedBuilder('ctB');
     else if (toolId === 'text_summarizer') setLastUsedBuilder('txS');
     else setLastUsedBuilder(null);
     
     const isPodcastTool = isPodcastFormatTool || toolId === 'podcast_creator';
     let activeMediaItems: MediaItem[] = [];
     
     // Resolve independent tool sessions
     if (payload?.isIndependent && payload?.builderSessionId) {
         const targetSession = sessions.find(s => s.id === payload.builderSessionId);
         if (targetSession) {
             activeMediaItems = targetSession.mediaItems;
         }
     } else if (activeSession && (!payload?.isIndependent || (payload?.isIndependent && !payload.builderSessionId && payload.includeSessionData))) {
         const selected = activeSession.mediaItems.filter(item =>
             activeSession.selectedMediaIds.includes(item.id)
         );
         activeMediaItems = selected.length > 0
             ? selected
             : (payload?.includeSessionData ? activeSession.mediaItems : []);
     }

     if (isPodcastTool) {
         activeMediaItems = filterNonDuplicateSessionMedia(activeMediaItems, payload?.customInput);
         if (!payload?.customInput || !payload.customInput.includes(MAGGI_CONTENTS_HEADER)) {
             try {
                 const maggiStore = getMaggiStore();
                 await maggiStore.hydrate();
                 const maggiFallback = buildMaggiFallbackMediaItem(maggiStore, activeSession);
                 if (maggiFallback) {
                     activeMediaItems = [...activeMediaItems, maggiFallback];
                 }
             } catch (maggiErr) {
                 console.warn('Could not attach MAGGI fallback sources:', maggiErr);
             }
         }
     }
     
     if ((toolId === 'youtube_transcript' || toolId === 'text_summarizer') && payload?.mediaItem) {
         activeMediaItems = [payload.mediaItem];
     } else if (activeMediaItems.length === 0 && (!payload || !payload.isIndependent) && (!payload?.builderSessionId) && (!payload?.includeSessionData) && toolId !== 'crypto_analyst') {
         alert("Please select at least one source to generate content.");
         setToolLoadingState(prev => ({ ...prev, [toolId]: false }));
         return;
     }

     if (!isPodcastTool && payload?.isIndependent && !payload?.builderSessionId && !payload?.includeSessionData) {
         activeMediaItems = []; // Ensure no session data is used unless requested
     }

     if (payload?.customInput) {
         activeMediaItems = [
             ...activeMediaItems,
             {
                 id: `custom-input-${Date.now()}`,
                 type: 'text',
                 name: 'Custom Content / Topic Input',
                 mimeType: 'text/plain',
                 data: btoa(unescape(encodeURIComponent(payload.customInput)))
             }
         ];
     }
     const { prompt, isPodcast } = buildToolPrompt(toolId, payload, voiceSettings);

     try {
        const model = settings.model || DEFAULT_GEMINI_MODEL;
        const cacheName = (toolId === 'youtube_transcript' || toolId === 'text_summarizer') ? undefined : activeSession?.geminiCacheName;
        
        let code = "";
        
        // Special handling for Text Summarizer & Translator to handle large documents via chunking
        if (toolId === 'text_summarizer') {
            const action = payload?.action || 'summarize';
            const lang = payload?.lang || 'swedish';
            
            if (action === 'translate' || action === 'summarize_translate') {
                // Extract full text for translation
                let fullText = "";
                for (const item of activeMediaItems) {
                    if (item.type === 'text' || item.type === 'document' || item.type === 'sql') {
                        fullText += (fullText ? '\n\n' : '') + base64ToText(item.data);
                    }
                }
                
                if (settings.provider !== 'gemini') {
                    const unifiedPrompt = action === 'summarize_translate'
                      ? `Summarize the provided sources concisely and then translate that summary cleanly into ${lang}. Return ONLY the translated text.`
                      : `Translate the following text cleanly into ${lang}. Return ONLY the translated text.\n\n${fullText}`;
                    code = await generateUnifiedAIResponse(unifiedPrompt, activeMediaItems, settings);
                } else if (action === 'summarize_translate') {
                    // 1. Summarize the whole document first
                    const summaryPrompt = `Provide a comprehensive summary of the provided text. Return ONLY the summary content.`;
                    const summaryResult = await generateResponse(summaryPrompt, [], activeMediaItems, model, cacheName);
                    // 2. Translate the summary (usually small enough for one go, but translateText handles chunks anyway)
                    code = await translateText(summaryResult.text, lang, model);
                } else {
                    // Just translate the whole document in chunks
                    code = await translateText(fullText, lang, model);
                }
                
                // Wrap the translated result in the expected HTML format
                code = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Translation Result</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: 'Inter', sans-serif; background-color: #0f172a; color: #e2e8f0; padding: 2rem; }
        .content-container { max-width: 800px; margin: 0 auto; background: rgba(30, 41, 59, 0.5); padding: 2rem; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); }
        h1 { color: #fff; font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem; border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem; }
        p { margin-bottom: 1rem; line-height: 1.7; }
    </style>
</head>
<body>
    <div class="content-container">
        <h1>${action === 'summarize_translate' ? 'Summary & Translation' : 'Translation'} (${lang})</h1>
        <div class="prose prose-invert max-w-none">
            ${code.split('\n').map(line => line.trim() ? `<p>${line}</p>` : '<br>').join('')}
        </div>
    </div>
</body>
</html>`;
            } else if (settings.provider !== 'gemini') {
                code = await generateUnifiedAIResponse(prompt, activeMediaItems, settings);
            } else {
                // Default summarization (one-shot)
                const result = await generateResponse(prompt, [], activeMediaItems, model, cacheName);
                code = result.text;
            }
        } else if (settings.provider !== 'gemini') {
            code = await generateUnifiedAIResponse(prompt, activeMediaItems, settings);
        } else {
            const result = await generateResponse(prompt, [], activeMediaItems, model, cacheName, toolId === 'crypto_analyst');
            code = result.text;
        }
        if (isPodcast) {
            code = (code || '').replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
            const strippedText = code
                .replace(/<\/?[a-zA-Z!/?][^>]*>/gm, ' ')
                .replace(/[ \t]+/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            const rawText = strippedText || code.trim();
            const speechText = rawText.substring(0, 4000).trim();
            const fallbackSpeakers = toolId === 'podcast_2' ? 2 : toolId === 'podcast_3' ? 3 : 1;
            const payloadSpeakerCount = Number(payload?.speakerCount);
            const speakers = Number.isFinite(payloadSpeakerCount) && payloadSpeakerCount >= 1 ? payloadSpeakerCount : fallbackSpeakers;

            let audioBase64: string | null = null;
            let audioMimeType = 'audio/wav';
            let audioNote = '';
            if (!speechText) {
                audioNote = 'Podcast script text was empty — audio synthesis was skipped. Try again or check Settings → AI Engine.';
            } else if (settings.provider === 'gemini') {
                try {
                    audioBase64 = await generateSpeech(speechText, speakers, voiceSettings);
                } catch (speechErr) {
                    console.warn('Audio generation failed:', speechErr);
                }
                if (!audioBase64) {
                    audioNote = 'Audio generation failed with the Gemini engine. Your transcript is ready below — you can retry audio from the player.';
                }
            } else if (settings.provider === 'maggi') {
                try {
                    const maggiStore = getMaggiStore();
                    await maggiStore.hydrate();
                    const currentMaggiSettings = maggiStore.getSettings();
                    const maggiResult = await generateMaggiSpeech(
                        speechText,
                        speakers,
                        voiceSettings,
                        currentMaggiSettings,
                    );
                    audioBase64 = maggiResult.audioBase64;
                    audioMimeType = maggiResult.mimeType || 'audio/wav';
                    if (
                        maggiResult.fallbackUsed
                        && maggiResult.assignedVoiceModel
                        && !maggiResult.routedVia?.startsWith('server-gemini/')
                        && maggiResult.assignedVoiceModel !== currentMaggiSettings.freeLlmVoiceModel
                    ) {
                        maggiStore.updateSettings({ freeLlmVoiceModel: maggiResult.assignedVoiceModel });
                    }
                } catch (speechErr: any) {
                    console.warn('MAGGI TTS audio generation failed:', speechErr);
                    audioNote = `FreeLLMAPI (MAGGI) voice synthesis failed (${speechErr?.message || 'unavailable'}). Check Settings → AI Engine → MAGGI → Podcast Voice / TTS Model or assign an available TTS next in sequence. Your transcript is ready below.`;
                }
            } else {
                const providerLabel = settings.provider === 'ollama' ? 'Ollama' : 'Custom AI';
                audioNote = `Audio (TTS) is not available with the ${providerLabel} brain — it produces text only. Your transcript is ready below; switch Settings → AI Engine to Gemini or FreeLLMAPI (MAGGI) to generate audio.`;
            }
            if (audioBase64) {
                setGeneratedAudio(audioBase64);
            }

            // Format the script with color-coded blocks
            const audioPlayerHtml = buildAudioPlayerHtml(audioBase64, audioMimeType);
            const audioNoticeHtml = (!audioBase64 && audioNote) ? buildAudioNoticeHtml(audioNote) : '';

            code = buildPodcastDocumentHtml({
                script: code,
                voiceSettings,
                audioBase64,
                audioNoticeHtml,
                audioPlayerHtml,
            });

            // Auto save generations to a history library for later retrieval, use, edit/delete.
            // The transcript is saved even when audio is unavailable.
            {
                let formatLabel = "Report Podcast";
                if (toolId === 'podcast_2') formatLabel = "Dialogue Podcast";
                if (toolId === 'podcast_3') formatLabel = "Roundtable Podcast";
                if (toolId === 'podcast_creator') formatLabel = "Interactive Podcast";
                // Host-only report (multiple speakers configured) — always a single-host report.
                if (payload?.hostOnly) formatLabel = "Report Podcast";

                const timestamp = new Date().toLocaleString();
                const filename = audioBase64 ? `${formatLabel} - ${timestamp}` : `Transcript — ${formatLabel} - ${timestamp}`;

                const newMediaItem: MediaItem = {
                    id: `audio-${Date.now()}`,
                    type: 'audio',
                    name: filename,
                    mimeType: audioMimeType,
                    data: audioBase64 || '',
                    scriptHtml: code
                };

                if (audioBase64 && activeSession) {
                    updateActiveSession(s => ({
                        ...s,
                        mediaItems: [newMediaItem, ...s.mediaItems],
                        selectedMediaIds: [...s.selectedMediaIds, newMediaItem.id]
                    }));
                }

                // Always save to global history library
                savePodcastToHistory(newMediaItem);
            }

            setIsFullWidthPreview(true);
        } else {
             // Robust code cleaning for Markdown artifacts
             code = code.replace(/```[hH][tT][mM][lL]\s?([\s\S]*?)```/g, '$1')
                        .replace(/```\s?([\s\S]*?)```/g, '$1')
                        .trim();
             
             setIsFullWidthPreview(toolId === 'crypto_analyst' || toolId === 'content_builder'); 
        }
        setPreviewCode(code);
        setFocusedMediaItem(null); 
        setIsPreviewMinimized(false); 
        if (isMindMapOpen) setIsMainPanelCollapsed(true);
     } catch (e: any) {
         const msg = e?.message || String(e);
         console.warn("Tool generation notice:", msg);
         const errorHtml = buildErrorHtml(msg);
         setPreviewCode(errorHtml);
         setFocusedMediaItem(null);
         setIsPreviewMinimized(false);
     } finally {
         setToolLoadingState(prev => ({ ...prev, [toolId]: false }));
     }
  };

  const handleOpenAudio = () => {
      setActiveSideTab('audio');
      if (isMindMapOpen && isMainPanelCollapsed) {
          setIsMainPanelCollapsed(false);
      }
  };

  const handleSaveAsSource = (content: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const title = `AI Answer ${timestamp}`;
    const result = addTextItem(title, content);
    if (result) {
      generateSuggestionsForSession(result.targetId, result.combinedMedia);
      if (settings.autoTagSources && result.newItems) {
          autoTagMediaItems(result.targetId, result.newItems);
      }
    }
  };

  const handleSaveArtifactToSession = (code: string, title: string) => {
    const result = addHtmlItem(title, code);
    if (result) {
      generateSuggestionsForSession(result.targetId, result.combinedMedia);
      if (settings.autoTagSources && result.newItems) {
          autoTagMediaItems(result.targetId, result.newItems);
      }
      console.info(`"${title}" saved to session sources.`);
    }
  };

  const handleToggleMindMap = async () => {
      if (!isMindMapOpen) {
          setIsMindMapOpen(true);
          setIsMainPanelCollapsed(true); 
          setIsSourcesPanelOpen(false);  
          setFocusedMediaItem(null);
          setPreviewCode(null);
          if (!activeSession?.mindMapData) {
              await generateMindMap();
          }
      } else {
          setIsMindMapOpen(false);
          setIsMainPanelCollapsed(false);
          setIsSourcesPanelOpen(false);
      }
  };

  const handleRefreshMindMap = () => {
    if (!activeSession) return;
    updateActiveSession(s => ({ ...s, mindMapData: undefined }));
    setTimeout(() => generateMindMap(), 100);
  };

  const handleMindMapNodeDoubleClick = async (label: string) => {
      setIsMainPanelCollapsed(true);
      setMindMapPopup({ title: label, content: null, isLoading: true });
      try {
          const activeMediaItems = activeSession?.mediaItems.filter(item => 
              activeSession.selectedMediaIds.includes(item.id)
          ) || [];
          const prompt = `Tell me more about "${label}" and its context based on the sources. Provide a detailed summary and analysis.`;
          const model = settings.model || DEFAULT_GEMINI_MODEL;
          const result = await generateResponse(prompt, [], activeMediaItems, model, activeSession?.geminiCacheName);
          setMindMapPopup({ title: label, content: result.text, isLoading: false });
      } catch (e) {
          console.error("MindMap node detail failed", e);
          setMindMapPopup({ title: label, content: "Failed to generate details. Please check API connection.", isLoading: false });
      }
  };

  if (!isStorageInitialized) {
      return <div className="bg-app-bg h-screen text-app-text p-10 flex items-center justify-center">Loading Library...</div>;
  }

  const handleSaveAudio = async (audioData: string, filename: string) => {
      // Add to session media items
      const newMediaItem: MediaItem = {
          id: `audio-${Date.now()}`,
          type: 'audio',
          name: `${filename}.wav`,
          mimeType: 'audio/wav',
          data: audioData
      };

      if (activeSession) {
          const updatedSessions = sessions.map(s => {
              if (s.id === activeSession.id) {
                  return {
                      ...s,
                      mediaItems: [...s.mediaItems, newMediaItem],
                      selectedMediaIds: [...s.selectedMediaIds, newMediaItem.id]
                  };
              }
              return s;
          });

          setSessions(updatedSessions);
          setActiveSessionId(activeSession.id);
      }

      // Save to global history
      savePodcastToHistory(newMediaItem);

      alert("Audio added to history library!");
  };

  const handleLoadAudio = async (item: MediaItem) => {
      if (item.type !== 'audio') return;
      
      let audioData = item.data;
      let scriptCode = item.scriptHtml;

      // If data is stripped from lightweight history in localStorage, recover it
      if (!audioData) {
          const foundInSession = activeSession?.mediaItems.find(m => m.id === item.id) 
              || sessions.flatMap(s => s.mediaItems).find(m => m.id === item.id);
          if (foundInSession?.data) {
              audioData = foundInSession.data;
              if (!scriptCode && foundInSession.scriptHtml) {
                  scriptCode = foundInSession.scriptHtml;
              }
          } else {
              const cachedBlob = await loadAudioBlobFromIDB(item.id);
              if (cachedBlob?.data) {
                  audioData = cachedBlob.data;
                  if (!scriptCode && cachedBlob.scriptHtml) {
                      scriptCode = cachedBlob.scriptHtml;
                  }
              }
          }
      }

      setPreviewCode(scriptCode || '<!-- Audio Only Mode -->');
      
      if (audioData) {
          setGeneratedAudio(audioData);
      } else if ((item as any).file) {
          const file = (item as any).file as File;
          const reader = new FileReader();
          reader.onload = (e) => {
              const result = e.target?.result as string;
              const base64 = result.split(',')[1];
              setGeneratedAudio(base64);
          };
          reader.readAsDataURL(file);
      }
  };

  const handleRegenerate = async (newScript: string, engine: AudioEngine) => {
      setToolLoadingState(prev => ({ ...prev, 'regenerate': true }));
      setGeneratedAudio(null);
      try {
          // 1. Generate Audio
          let speakers = 1;
          if (newScript.includes('Expert:') || newScript.includes(`${voiceSettings.expertLabel}:`)) speakers = 2;
          if (newScript.includes('Guest:') || newScript.includes(`${voiceSettings.guestLabel}:`)) speakers = 3;
          
          let audioBase64: string | null = null;
          let audioMimeType = 'audio/wav';
          let audioNote = '';
          const cleanedRegen = (newScript || '')
              .replace(/<\/?[a-zA-Z!/?][^>]*>/gm, ' ')
              .replace(/[ \t]+/g, ' ')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
          const speechText = (cleanedRegen || (newScript || '').trim()).substring(0, 4000).trim();
          if (!speechText) {
              audioNote = 'Podcast script text was empty — audio synthesis was skipped.';
          } else if (engine.type === 'gemini') {
              try {
                  audioBase64 = await generateSpeech(speechText, speakers, voiceSettings);
              } catch (speechErr) {
                  console.warn('Audio regeneration failed:', speechErr);
              }
              if (audioBase64) {
                  setGeneratedAudio(audioBase64);
              } else {
                  audioNote = 'Audio generation failed with the Gemini engine. Your transcript is ready below — you can retry audio from the player.';
              }
          } else if (engine.type === 'maggi') {
              try {
                  const maggiStore = getMaggiStore();
                  await maggiStore.hydrate();
                  const currentMaggiSettings = maggiStore.getSettings();
                  const maggiResult = await generateMaggiSpeech(
                      speechText,
                      speakers,
                      voiceSettings,
                      currentMaggiSettings,
                  );
                  audioBase64 = maggiResult.audioBase64;
                  audioMimeType = maggiResult.mimeType || 'audio/wav';
                  if (
                      maggiResult.fallbackUsed
                      && maggiResult.assignedVoiceModel
                      && !maggiResult.routedVia?.startsWith('server-gemini/')
                      && maggiResult.assignedVoiceModel !== currentMaggiSettings.freeLlmVoiceModel
                  ) {
                      maggiStore.updateSettings({ freeLlmVoiceModel: maggiResult.assignedVoiceModel });
                  }
                  if (audioBase64) setGeneratedAudio(audioBase64);
              } catch (speechErr: any) {
                  console.warn('MAGGI TTS regeneration failed:', speechErr);
                  audioNote = `FreeLLMAPI (MAGGI) voice synthesis failed (${speechErr?.message || 'unavailable'}). Check Settings → AI Engine → MAGGI → Podcast Voice / TTS Model or assign an available TTS next in sequence.`;
              }
          } else {
              try {
                  audioBase64 = await generateCustomSpeech(speechText, engine.settings);
                  audioMimeType = 'audio/mpeg';
                  setGeneratedAudio(audioBase64);
              } catch (speechErr: any) {
                  audioNote = `Custom speech synthesis failed (${speechErr?.message || 'unavailable'}). Check the endpoint, model, voice, credentials and browser CORS access, then retry.`;
              }
          }

          // 2. Update Preview Code (HTML)
          const code = buildPodcastDocumentHtml({
              script: newScript,
              voiceSettings,
              audioBase64,
              audioNoticeHtml: (!audioBase64 && audioNote) ? buildAudioNoticeHtml(audioNote) : '',
              audioPlayerHtml: buildAudioPlayerHtml(audioBase64, audioMimeType),
          });
          setPreviewCode(code);

      } catch (e) {
          console.error("Regeneration failed", e);
          alert("Failed to regenerate audio.");
      } finally {
          setToolLoadingState(prev => ({ ...prev, 'regenerate': false }));
      }
  };

  if (viewMode === 'media') {
      return (
          <div className="h-full w-full relative" data-theme={theme}>
              <MediaSuiteView 
                  onBack={() => setViewMode('library')} 
                  session={activeSession}
                  sessions={sessions}
                  onSaveArtifact={(item) => {
                      if (activeSession) {
                          updateActiveSession(s => ({
                              ...s,
                              mediaItems: [item, ...s.mediaItems],
                              selectedMediaIds: [...s.selectedMediaIds, item.id]
                          }));
                          const sourceTypeName = item.type === 'pdf' ? 'PDF source' : 'text source';
                          alert(`"${item.name}" saved as a ${sourceTypeName} in the active workspace!`);
                      }
                  }}
                  onRunTool={handleToolAction}
                  miprompts={miprompts}
                  onAddMIPrOMPT={addMIPrOMPT}
                  onUpdateMIPrOMPT={updateMIPrOMPT}
                  onDeleteMIPrOMPT={deleteMIPrOMPT}
                  onImportCSV={importCSV}
                  currentTheme={theme}
                  isLoading={Object.values(toolLoadingState).some(Boolean)}
              />
          </div>
      );
  }

  if (viewMode === 'studio') {
      return (
          <div className="h-full w-full relative" data-theme={theme}>
              <StudioView 
                  onBack={() => { setStudioInitialTool(null); setViewMode('library'); }}
                  initialTool={studioInitialTool}
                  onClearInitialTool={() => setStudioInitialTool(null)}
                  initialPodcastDraft={podcastDraftTrigger}
                  onClearInitialPodcastDraft={() => setPodcastDraftTrigger(null)}
                  audioProvider={settings.provider}
                  onChangeAudioProvider={(provider) => {
                      markExplicitAudioProvider();
                      setSettings(prev => ({ ...prev, provider }));
                  }}
                  voiceSettings={voiceSettings}
                  onUpdateVoiceSettings={setVoiceSettings}
                  onRunTool={handleToolAction}
                  isLoading={Object.values(toolLoadingState).some(Boolean)}
                  hasActiveSession={!!activeSession}
                  session={activeSession}
                  sessions={sessions}
                  previewCode={previewCode}
                  onClosePreview={() => setPreviewCode(null)}
                  generatedAudio={generatedAudio}
                  onSaveAudio={handleSaveAudio}
                  onLoadAudio={handleLoadAudio}
                  onRemoveMediaItem={handleRemoveMedia}
                  onRenameMediaItem={handleRenameMediaItem}
                  onRegenerate={handleRegenerate}
                  prompts={prompts}
                  onAddPrompt={addPrompt}
                  onDeletePrompt={removePrompt}
                  castLibrary={castLibrary}
                  onAddCastMember={addCastMember}
                  onUpdateCastMember={updateCastMember}
                  onDeleteCastMember={deleteCastMember}
                  isCastLibraryOpen={isCastLibraryOpen}
                  setIsCastLibraryOpen={setIsCastLibraryOpen}
                  touchedRoles={touchedRoles}
                  setTouchedRoles={setTouchedRoles}
                                                      miprompts={miprompts}
                  onAddMIPrOMPT={addMIPrOMPT}
                  onUpdateMIPrOMPT={updateMIPrOMPT}
                  onDeleteMIPrOMPT={deleteMIPrOMPT}
                  initialBuilderData={selectedMIPrOMPT}
                  onClearInitialBuilderData={() => setSelectedMIPrOMPT(null)}
                  onSaveArtifact={(item) => {
                      if (activeSession) {
                          updateActiveSession(s => ({
                              ...s,
                              mediaItems: [item, ...s.mediaItems],
                              selectedMediaIds: [...s.selectedMediaIds, item.id]
                          }));
                          alert(`"${item.name}" saved as a text source in the active workspace!`);
                      }
                  }}
              />
              <SettingsPanel 
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentTheme={theme}
                onSetTheme={setTheme}
                settings={settings}
                onUpdateSettings={handleSettingsUpdateFromPanel}
                initialTab={activeSettingsTab}
                voiceSettings={voiceSettings}
                onUpdateVoiceSettings={setVoiceSettings}
                onTouchRole={(role) => setTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]))}
                castLibrary={castLibrary}
                onAddCastMember={addCastMember}
                onUpdateCastMember={updateCastMember}
                onDeleteCastMember={deleteCastMember}
                onResetLibrary={resetLibrary}
                onOpenMaggi={(tab = 'chat') => { setIsSettingsOpen(false); setMaggiInitialTab(tab); setViewMode('maggi'); }}
              />
          </div>
      );
  }

  if (viewMode === 'office_tools') {
      return (
          <div className="h-full w-full relative" data-theme={theme}>
              <OfficeTools 
                  onBack={() => setViewMode('library')}
                  voiceSettings={voiceSettings}
                  onUpdateVoiceSettings={setVoiceSettings}
                  onRunTool={handleToolAction}
                  isLoading={Object.values(toolLoadingState).some(Boolean)}
                  hasActiveSession={!!activeSession}
                  session={activeSession}
                  sessions={sessions}
                  previewCode={previewCode}
                  onClosePreview={() => setPreviewCode(null)}
                  generatedAudio={generatedAudio}
                  onSaveAudio={handleSaveAudio}
                  onLoadAudio={handleLoadAudio}
                  onRemoveMediaItem={handleRemoveMedia}
                  onRenameMediaItem={handleRenameMediaItem}
                  onRegenerate={handleRegenerate}
                  prompts={prompts}
                  onAddPrompt={addPrompt}
                  onDeletePrompt={removePrompt}
                  castLibrary={castLibrary}
                  onAddCastMember={addCastMember}
                  onUpdateCastMember={updateCastMember}
                  onDeleteCastMember={deleteCastMember}
                  isCastLibraryOpen={isCastLibraryOpen}
                  setIsCastLibraryOpen={setIsCastLibraryOpen}
                  touchedRoles={touchedRoles}
                  setTouchedRoles={setTouchedRoles}
                  miprompts={miprompts}
                  onAddMIPrOMPT={addMIPrOMPT}
                  onUpdateMIPrOMPT={updateMIPrOMPT}
                  onDeleteMIPrOMPT={deleteMIPrOMPT}
                  initialBuilderData={selectedMIPrOMPT}
                  onClearInitialBuilderData={() => setSelectedMIPrOMPT(null)}
                  onSaveArtifact={(item) => {
                      if (activeSession) {
                          updateActiveSession(s => ({
                              ...s,
                              mediaItems: [item, ...s.mediaItems],
                              selectedMediaIds: [...s.selectedMediaIds, item.id]
                          }));
                          alert(`"${item.name}" saved as a text source in the active workspace!`);
                      }
                  }}
              />
              <SettingsPanel 
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentTheme={theme}
                onSetTheme={setTheme}
                settings={settings}
                onUpdateSettings={handleSettingsUpdateFromPanel}
                initialTab={activeSettingsTab}
                voiceSettings={voiceSettings}
                onUpdateVoiceSettings={setVoiceSettings}
                onTouchRole={(role) => setTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]))}
                castLibrary={castLibrary}
                onAddCastMember={addCastMember}
                onUpdateCastMember={updateCastMember}
                onDeleteCastMember={deleteCastMember}
                onResetLibrary={resetLibrary}
                onOpenMaggi={(tab = 'chat') => { setIsSettingsOpen(false); setMaggiInitialTab(tab); setViewMode('maggi'); }}
              />
          </div>
      );
  }

  if (viewMode === 'miprompt') {
      return (
          <div className="h-full w-full relative" data-theme={theme}>
              <MIPrOMPTLibraryView
                  miprompts={miprompts}
                  onAdd={addMIPrOMPT}
                  onUpdate={updateMIPrOMPT}
                  onDelete={deleteMIPrOMPT}
                  onImport={importCSV}
                  onSelectPrompt={(item) => {
                      setSelectedMIPrOMPT({ type: item.type, content: item.content });
                      setViewMode('studio');
                  }}
              />
              <button 
                  onClick={() => setViewMode('library')}
                  className="absolute top-8 left-8 p-3 bg-app-panel text-app-text rounded-full shadow-lg hover:bg-app-card border border-app-border z-50 transition-transform hover:scale-105"
                  title="Back to Library"
              >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
              </button>
          </div>
      );
  }

  if (viewMode === 'maggi') {
      return (
          <div className="h-full w-full relative" data-theme={theme}>
              <MaggiView
                  onBack={() => setViewMode('library')}
                  initialTab={maggiInitialTab}
                  workspaceName={activeSession?.name}
                  workspaceItems={(activeSession?.mediaItems ?? []).map((m) => ({
                      id: m.id,
                      name: m.name,
                      type: m.type,
                      mimeType: m.mimeType,
                      data: m.data,
                  }))}
                  onSaveToSession={(title, content) => {
                      addTextItem(title, content);
                  }}
                  onOpenPodcast={async () => {
                      if (!hasExplicitAudioProvider) {
                          const maggiStore = getMaggiStore();
                          await maggiStore.hydrate();
                          if (maggiStore.getSettings().provider !== 'freellmapi') {
                              await maggiStore.updateSettings({ provider: 'freellmapi' });
                          }
                          setSettings(prev => ({ ...prev, provider: 'maggi' }));
                      }
                      try {
                          const autoDraft = await loadAutoPodcastDraftFromStore(activeSession);
                          if (autoDraft.draft) {
                              setPodcastDraftTrigger({ text: autoDraft.draft, key: Date.now() });
                          }
                      } catch (err) {
                          console.warn('Could not preload podcast sources:', err);
                      }
                      setStudioInitialTool('podcast_creator');
                      setViewMode('studio');
                  }}
              />
          </div>
      );
  }

  if (viewMode === 'finance') {
      return (
          <FinanceView onBack={() => setViewMode('library')} />
      );
  }

  if (viewMode === 'sxa_board') {
      return (
          <SxaBoardApp 
              onBack={() => setViewMode('library')} 
              activeSession={activeSession}
              onSaveArtifact={(item) => {
                  if (activeSession) {
                      updateActiveSession(s => ({
                          ...s,
                          mediaItems: [item, ...s.mediaItems],
                          selectedMediaIds: [...s.selectedMediaIds, item.id]
                      }));
                      const sourceTypeName = item.type === 'pdf' ? 'PDF source' : 'text source';
                      alert(`"${item.name}" saved as a ${sourceTypeName} in the active workspace!`);
                  }
              }}
          />
      );
  }

  if (viewMode === 'library') {
      return (
          <div className="h-full w-full relative" data-theme={theme}>
              <LibraryView 
                  sessions={sessions}
                  onSelectSession={handleSelectSession}
                  onCreateSession={handleOpenCreateSessionModal}
                  onDeleteSession={handleDeleteSession}
                  onRenameSession={renameSession}
                  onReorderSession={reorderSessions}
                  onCombineSessions={(ids, name, description) => {
                      const newSession = combineSessions(ids, name, description);
                      if (newSession) {
                          setViewMode('studio');
                      }
                  }}
                  onOpenSettings={() => toggleSettings('ai')}
                  onOpenStudio={() => setViewMode('studio')}
                  onOpenOfficeTools={() => setViewMode('office_tools')}
                  onOpenMedia={() => setViewMode('media')}
                  onOpenMIPrOMPT={() => setViewMode('miprompt')}
                  onOpenFinance={() => setViewMode('finance')}
                  onOpenMaggi={() => { setMaggiInitialTab('chat'); setViewMode('maggi'); }}
                  onGenerateWebsite={handleGenerateSessionWebsite}
              />
              <SessionModal 
                  isOpen={isModalOpen} 
                  onClose={() => setIsModalOpen(false)} 
                  onCreate={handleCreateSession}
                  defaultValue={newSessionDefaultName}
                  sessions={sessions}
              />
              <SettingsPanel 
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                currentTheme={theme}
                onSetTheme={setTheme}
                settings={settings}
                onUpdateSettings={handleSettingsUpdateFromPanel}
                initialTab={activeSettingsTab}
                voiceSettings={voiceSettings}
                onUpdateVoiceSettings={setVoiceSettings}
                onTouchRole={(role) => setTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]))}
                castLibrary={castLibrary}
                onAddCastMember={addCastMember}
                onUpdateCastMember={updateCastMember}
                onDeleteCastMember={deleteCastMember}
                onResetLibrary={resetLibrary}
                onOpenMaggi={(tab = 'chat') => { setIsSettingsOpen(false); setMaggiInitialTab(tab); setViewMode('maggi'); }}
              />
          </div>
      );
  }

  if (!activeSession) return <div className="bg-app-bg h-screen text-app-text p-10 flex items-center justify-center">Loading Session...</div>;

  const isPreviewActive = previewCode || focusedMediaItem;
  
  const chatPanelClasses = `flex flex-col h-full transition-all duration-500 ease-in-out ${
      (!isMindMapOpen && isPreviewActive)
          ? (isPreviewMinimized 
                ? 'w-full opacity-100' 
                : (isFullWidthPreview ? 'w-0 opacity-0 overflow-hidden border-0' : 'w-1/2 border-r border-app-border opacity-100')
            )
          : 'w-full opacity-100'
  }`;

  const previewPanelClasses = `
      bg-app-bg border-l border-app-border transition-all duration-500 ease-in-out
      ${isMindMapOpen 
          ? 'fixed top-0 right-0 bottom-0 w-[50%] z-40 shadow-2xl' 
          : (isPreviewMinimized 
              ? 'fixed bottom-4 right-4 w-0 h-0 opacity-0 pointer-events-none overflow-hidden' 
              : (isFullWidthPreview ? 'w-full h-full' : 'w-1/2 h-full')
            )
      }
  `;

  return (
    <div className="h-full w-full relative overflow-hidden flex flex-col" data-theme={theme}>
      {theme === 'olive' && backgroundTemplateImage && (
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-1000 ease-in-out blur-sm opacity-40 scale-105"
          style={{ backgroundImage: `url(data:${backgroundTemplateImage.mimeType};base64,${backgroundTemplateImage.data})` }}
        />
      )}
      
      <div className="absolute inset-0 z-0 bg-app-bg transition-colors duration-300" />

      {isMindMapOpen && (
          <div className="absolute inset-0 z-0 animate-fade-in">
              {activeSession.mindMapData ? (
                <MindMapViewer 
                    data={activeSession.mindMapData} 
                    onClose={handleToggleMindMap} 
                    onNodeDoubleClick={handleMindMapNodeDoubleClick}
                    onRefresh={handleRefreshMindMap}
                    sources={activeSession.mediaItems}
                />
              ) : (
                <div className="h-full w-full flex flex-col items-center justify-center text-app-dim bg-app-bg/90">
                     <div className="animate-spin h-10 w-10 border-4 border-app-text border-t-transparent rounded-full mb-4"></div>
                     <p className="animate-pulse">Synthesizing Context Graph...</p>
                </div>
              )}
          </div>
      )}
      
      {isMindMapOpen && isMainPanelCollapsed && (
        <button
          onClick={() => { setIsMainPanelCollapsed(false); setIsSourcesPanelOpen(false); }}
          className="fixed left-0 top-[40%] transform -translate-y-1/2 z-50 bg-transparent text-app-text hover:bg-app-panel/20 rounded-r-lg p-1 transition-all"
          title="Open Chat & Sessions"
        >
           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
           </svg>
        </button>
      )}

      {isMindMapOpen && !isSourcesPanelOpen && isMainPanelCollapsed && (
         <button
            onClick={() => setIsSourcesPanelOpen(true)}
            className="fixed left-0 top-[45%] transform -translate-y-1/2 z-50 bg-transparent text-cyan-500 hover:bg-app-panel/20 rounded-r-lg p-1 transition-all"
            title="Open Sources Only"
          >
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
             </svg>
          </button>
      )}

      <div 
          className={`
            relative z-30 flex flex-col md:flex-row h-full transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]
            ${isMindMapOpen ? 'absolute top-0 bottom-0 shadow-2xl border-r border-app-border bg-app-bg/95 backdrop-blur-md' : 'w-full'}
            ${isMindMapOpen ? (isMainPanelCollapsed ? '-translate-x-full' : 'translate-x-0') : ''}
          `}
          style={{ width: '100%' }} 
      >
        {isMindMapOpen && (
             <button 
                onClick={() => setIsMainPanelCollapsed(true)}
                className={`absolute left-4 top-4 w-10 h-10 bg-app-panel border border-app-border rounded-full flex items-center justify-center text-app-text hover:text-blue-400 z-50 shadow-lg`}
                title="Back to Mind Map"
             >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                 </svg>
             </button>
        )}

        <div className={`transition-all duration-500 ease-in-out overflow-hidden flex shrink-0 ${isSidebarVisible ? 'w-full md:w-80' : 'w-0'}`}>
          <MediaPanel 
            activeTab={activeSideTab}
            onTabChange={setActiveSideTab}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSwitchSession={setActiveSessionId}
            onCreateSession={handleOpenCreateSessionModal}
            onDeleteSession={handleDeleteSession}
            onRenameSession={renameSession}
            onExportSession={handleExportSession}
            activeMediaItems={activeSession.mediaItems} 
            selectedMediaIds={activeSession.selectedMediaIds || []}
            onToggleMedia={onToggleMedia}
            onToggleAllMedia={onToggleAllMedia}
            onFileUpload={onFileUpload}
            onAddLink={onAddLink}
            onAddText={handleAddText}
            onSearchWeb={handleSearchWeb}
            onRefillSearch={handleRefillSearch}
            onRemove={onRemoveMedia}
            onRenameMediaItem={handleRenameMediaItem} // Pass the new handler
            onCombineMedia={onCombineMedia}
            onViewMedia={handleFocusMedia}
            onGenerateWebsite={handleGenerateSessionWebsite}
            onLoadAudio={handleLoadAudio}
            currentTheme={theme}
            onSetTheme={setTheme}
            settings={settings}
            onUpdateSettings={setSettings}
            onRunTool={handleToolAction}
            toolLoadingState={toolLoadingState}
            voiceSettings={voiceSettings}
            onUpdateVoiceSettings={setVoiceSettings}
            touchedRoles={touchedRoles}
            setTouchedRoles={setTouchedRoles}
            onGoHome={() => setViewMode('library')}
            isSettingsOpen={isSettingsOpen}
            activeSettingsTab={activeSettingsTab}
            onToggleSettings={toggleSettings}
            viewMode={viewMode}
            characters={characters}
            onAddCharacter={addCharacter}
            onUpdateCharacter={updateCharacter}
            onDeleteCharacter={deleteCharacter}
            castLibrary={castLibrary}
            onAddCastMember={addCastMember}
            onUpdateCastMember={updateCastMember}
            onDeleteCastMember={deleteCastMember}
          />
        </div>
        
        <div className="flex-1 flex overflow-hidden flex-col md:flex-row min-w-0">
           <div className={chatPanelClasses}>
              <ChatPanel 
                sessionName={activeSession.name}
                history={activeSession.history}
                isLoading={isLoading}
                input={input}
                setInput={setInput}
                onSend={() => handleSend()}
                suggestions={activeSession.suggestions}
                onSuggestionClick={triggerSuggestion}
                isSuggestionsLoading={isSuggestionsLoading}
                onSeekMedia={handleSeekMedia}
                onPreviewArtifact={(code) => { setPreviewCode(code); setFocusedMediaItem(null); setIsPreviewMinimized(false); if(isMindMapOpen) setIsMainPanelCollapsed(true); setIsFullWidthPreview(false); }}
                onSaveAsSource={handleSaveAsSource}
                onGenerateReport={handleGenerateReport}
                onOpenAudio={handleOpenAudio}
                onClearHistory={() => clearSessionHistory(activeSession.id)}
                onDeleteSession={() => handleDeleteSession(activeSession.id)}
                onDownloadSession={handleDownloadSession}
                onRunTool={handleToolAction}
                toolLoadingState={toolLoadingState}
                prompts={prompts}
                onAddPrompt={addPrompt}
                onDeletePrompt={removePrompt}
                onToggleMindMap={handleToggleMindMap}
                isMindMapLoading={isMindMapLoading}
                activeMediaItems={activeSession.mediaItems.filter(item => activeSession.selectedMediaIds.includes(item.id))}
                isSidebarVisible={isSidebarVisible}
                setIsSidebarVisible={setIsSidebarVisible}
                onRefreshSuggestions={() => generateSuggestionsForSession(activeSession.id, activeSession.mediaItems.filter(item => activeSession.selectedMediaIds.includes(item.id)))}
                sessionDescription={activeSession.description}
                onUpdateDescription={(desc) => updateSessionDescription(activeSession.id, desc)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                provider={settings.provider}
                onSwitchProvider={(provider) => setSettings(prev => ({ ...prev, provider }))}
                onSaveToMaggi={async (msg: Message, queryText: string) => {
                  const store = getMaggiStore();
                  await store.saveQuery({
                    query: queryText,
                    answer: msg.content,
                    citations: msg.citations,
                    workspaceName: activeSession.name,
                    usage: msg.maggiMeta
                      ? {
                        model: msg.maggiMeta.model,
                        provider: msg.maggiMeta.provider,
                        routedVia: msg.maggiMeta.routedVia,
                      }
                      : undefined,
                  });
                }}
                onEditMessage={(id, newContent) => {
                  updateActiveSession((s) => ({
                    ...s,
                    history: s.history.map(m => m.id === id ? { ...m, content: newContent } : m)
                  }));
                }}
              />
           </div>
           
           {isPreviewActive && (
             <div className={previewPanelClasses}>
                {previewCode ? (
                   <ArtifactPreview 
                      code={previewCode} 
                      theme={theme} 
                      onClose={() => { setPreviewCode(null); setIsFullWidthPreview(false); }} 
                      onMinimize={() => setIsPreviewMinimized(true)}
                      onToggleFullWidth={() => setIsFullWidthPreview(prev => !prev)}
                      isFullWidth={isFullWidthPreview}
                      onSaveToSession={handleSaveArtifactToSession}
                      onSaveToMIPrOMPT={(title) => {
                          const type = lastUsedBuilder || 'prB';
                          addMIPrOMPT(type, previewCode, title);
                          alert(`Successfully saved to mIPrOMPT Library as a ${type === 'prB' ? 'Prompt' : type === 'txS' ? 'Summarizer Output' : 'Content'}!`);
                      }}
                   />
                ) : focusedMediaItem ? (
                   <MediaViewer item={focusedMediaItem} onClose={() => { setFocusedMediaItem(null); setIsFullWidthPreview(false); }} />
                ) : null}
             </div>
           )}
        </div>
      </div>
      
      {!isMindMapOpen && previewCode && isPreviewMinimized && (
          <div className="absolute bottom-6 right-6 z-50 animate-fade-in">
              <button 
                  onClick={() => setIsPreviewMinimized(false)}
                  className="flex items-center gap-3 px-4 py-3 bg-app-card border border-app-border rounded-full shadow-2xl text-app-text hover:bg-app-panel transition-all group"
              >
                  <div className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </div>
                  <span className="text-sm font-bold pr-1">Playing Audio...</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
              </button>
          </div>
      )}

      {isMindMapOpen && (
          <div 
             className={`
                absolute top-0 bottom-0 left-0 z-20 w-80 bg-app-panel border-r border-app-border shadow-2xl transition-transform duration-300 ease-out
                ${isSourcesPanelOpen ? 'translate-x-0' : '-translate-x-full'}
             `}
          >
             <div className="relative h-full flex flex-col">
                <button 
                  onClick={() => setIsSourcesPanelOpen(false)}
                  className="absolute -right-6 top-[60%] transform -translate-y-1/2 w-6 h-10 bg-transparent text-cyan-500 rounded-r-lg flex items-center justify-center hover:bg-app-panel/20 border-y border-r border-app-border/30 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                       <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                </button>

                <MediaPanel 
                   activeTab="sources"
                   onTabChange={() => {}}
                   sessions={sessions}
                   activeSessionId={activeSessionId}
                   onSwitchSession={setActiveSessionId}
                   onCreateSession={handleOpenCreateSessionModal}
                   onDeleteSession={handleDeleteSession}
                   onRenameSession={renameSession}
                   onExportSession={handleExportSession}
                   activeMediaItems={activeSession.mediaItems} 
                   selectedMediaIds={activeSession.selectedMediaIds || []}
                   onToggleMedia={onToggleMedia}
                   onToggleAllMedia={onToggleAllMedia}
                   onFileUpload={onFileUpload}
                   onAddLink={onAddLink}
                   onAddText={handleAddText}
                   onSearchWeb={handleSearchWeb}
                   onRefillSearch={handleRefillSearch}
                   onRemove={onRemoveMedia}
                   onRenameMediaItem={handleRenameMediaItem} // Pass the new handler
                   onViewMedia={handleFocusMedia}
                   onGenerateWebsite={handleGenerateSessionWebsite}
                   currentTheme={theme}
                   onSetTheme={setTheme}
                   settings={settings}
                   onUpdateSettings={setSettings}
                   onRunTool={handleToolAction}
                   toolLoadingState={toolLoadingState}
                   onlySourcesView={true}
                   onLoadAudio={handleLoadAudio}
                   voiceSettings={voiceSettings}
                   onUpdateVoiceSettings={setVoiceSettings}
                   onGoHome={() => setViewMode('library')}
                   isSettingsOpen={isSettingsOpen}
                   activeSettingsTab={activeSettingsTab}
                   onToggleSettings={toggleSettings}
                   viewMode={viewMode}
                   characters={characters}
                   onAddCharacter={addCharacter}
                   onUpdateCharacter={updateCharacter}
                   onDeleteCharacter={deleteCharacter}
                   castLibrary={castLibrary}
                   onAddCastMember={addCastMember}
                   onUpdateCastMember={updateCastMember}
                   onDeleteCastMember={deleteCastMember}
                />
             </div>
          </div>
      )}
      
      {mindMapPopup && (
        <MindMapPopup 
           title={mindMapPopup.title}
           content={mindMapPopup.content}
           isLoading={mindMapPopup.isLoading}
           onClose={() => setMindMapPopup(null)}
        />
      )}

      <SessionModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onCreate={handleCreateSession}
        defaultValue={newSessionDefaultName}
        sessions={sessions}
      />
      
      <SettingsPanel 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentTheme={theme}
        onSetTheme={setTheme}
        settings={settings}
        onUpdateSettings={handleSettingsUpdateFromPanel}
        initialTab={activeSettingsTab}
        voiceSettings={voiceSettings}
        onUpdateVoiceSettings={setVoiceSettings}
        onTouchRole={(role) => setTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]))}
        castLibrary={castLibrary}
        onAddCastMember={addCastMember}
        onUpdateCastMember={updateCastMember}
        onDeleteCastMember={deleteCastMember}
        onResetLibrary={resetLibrary}
        onOpenMaggi={(tab = 'chat') => { setIsSettingsOpen(false); setMaggiInitialTab(tab); setViewMode('maggi'); }}
      />
    </div>
  );
};

export default App;
