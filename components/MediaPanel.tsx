
import React, { useRef, useState, useMemo } from 'react';
import { MediaItem, Session, Theme, ThemeSettings, VoiceSettings, CharacterPrompt, CastMember } from '../types';
import CharacterLibraryModal from './CharacterLibraryModal';
import CastLibraryModal from './CastLibraryModal';
import { useLanguage } from '../contexts/LanguageContext';
import { computePodcastGate, requiredRolesFor, buildStaggeredDefaultVoiceSettings, PodcastRole, PodcastFormatId } from '../utils/podcastGating';

interface MediaPanelProps {
  activeTab: 'sessions' | 'sources' | 'tools' | 'audio';
  onTabChange: (tab: 'sessions' | 'sources' | 'tools' | 'audio') => void;
  sessions: Session[];
  activeSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  onExportSession: (id: string, format: 'json' | 'md') => void;
  activeMediaItems: MediaItem[];
  selectedMediaIds: string[];
  onToggleMedia: (id: string) => void;
  onToggleAllMedia: (selectAll: boolean) => void;
  onFileUpload: (files: File[]) => void;
  onAddLink: (url: string) => void;
  onAddText: (title: string, content: string) => void;
  onSearchWeb: (query: string) => Promise<void>;
  onRefillSearch?: (query: string) => Promise<void>;
  onRemove: (id: string) => void;
  onRenameMediaItem: (id: string, newName: string) => void; 
  onViewMedia: (item: MediaItem) => void;
  /** Build a self-contained website from a session (no AI call needed). */
  onGenerateWebsite?: (sessionId: string) => void;
  onLoadAudio?: (item: MediaItem) => void;
  currentTheme: Theme;
  onSetTheme: (theme: Theme) => void;
  settings: ThemeSettings;
  onUpdateSettings: (s: ThemeSettings) => void;
  onRunTool: (toolId: string, payload?: any) => void;
  toolLoadingState: Record<string, boolean>;
  onlySourcesView?: boolean;
  voiceSettings: VoiceSettings;
  onUpdateVoiceSettings: (v: VoiceSettings) => void;
  touchedRoles?: PodcastRole[];
  setTouchedRoles?: React.Dispatch<React.SetStateAction<PodcastRole[]>>;
  onGoHome: () => void;
  isSettingsOpen?: boolean;
  activeSettingsTab?: 'ai' | 'visual' | 'cast';
  onToggleSettings?: (tab: 'ai' | 'visual' | 'cast') => void;
  onCombineMedia?: (ids: string[], name: string) => void;
  viewMode?: 'library' | 'workspace' | 'studio';
  characters?: CharacterPrompt[];
  onAddCharacter?: (char: Omit<CharacterPrompt, 'id' | 'category'>) => void;
  onUpdateCharacter?: (id: string, updates: Partial<CharacterPrompt>) => void;
  onDeleteCharacter?: (id: string) => void;
  castLibrary?: CastMember[];
  onAddCastMember?: (member: Omit<CastMember, 'id'>) => void;
  onUpdateCastMember?: (id: string, updates: Partial<CastMember>) => void;
  onDeleteCastMember?: (id: string) => void;
}

const MediaPanel: React.FC<MediaPanelProps> = ({ 
  activeTab,
  onTabChange,
  sessions, 
  activeSessionId, 
  onSwitchSession, 
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onExportSession,
  activeMediaItems, 
  selectedMediaIds,
  onToggleMedia,
  onToggleAllMedia,
  onFileUpload, 
  onAddLink,
  onAddText,
  onSearchWeb,
  onRefillSearch,
  onRemove,
  onRenameMediaItem, 
  onViewMedia,
  onGenerateWebsite,
  onLoadAudio,
  currentTheme,
  onSetTheme,
  settings,
  onUpdateSettings,
  onRunTool,
  toolLoadingState,
  onlySourcesView = false,
  voiceSettings,
  onUpdateVoiceSettings,
  touchedRoles: propTouchedRoles,
  setTouchedRoles: propSetTouchedRoles,
  onGoHome,
  isSettingsOpen,
  activeSettingsTab,
  onToggleSettings,
  onCombineMedia,
  viewMode = 'workspace',
  characters = [],
  onAddCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  castLibrary = [],
  onAddCastMember,
  onUpdateCastMember,
  onDeleteCastMember
}) => {
  const { t } = useLanguage();
  const [localTouchedRoles, setLocalTouchedRoles] = useState<PodcastRole[]>([]);
  const effectiveTouchedRoles = propTouchedRoles ?? localTouchedRoles;
  const setEffectiveTouchedRoles = propSetTouchedRoles ?? setLocalTouchedRoles;
  const touchRole = (role: PodcastRole) => setEffectiveTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]));
  const untouchRole = (role: PodcastRole) => setEffectiveTouchedRoles(prev => prev.filter(r => r !== role));
  const configuredRoles = (['host', 'expert', 'guest'] as const).filter(r => effectiveTouchedRoles.includes(r));
  const hostConfigured = effectiveTouchedRoles.includes('host');
  const multipleConfigured = configuredRoles.length > 1;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLinkInputOpen, setIsLinkInputOpen] = useState(false);
  const [isTextInputOpen, setIsTextInputOpen] = useState(false);
  const [isSearchInputOpen, setIsSearchInputOpen] = useState(false);
  
  // Data Table Tool State
  const [isDataTableOpen, setIsDataTableOpen] = useState(false);
  const [tableInstructions, setTableInstructions] = useState('');
  const [tableLanguage, setTableLanguage] = useState('English');

  const [linkUrl, setLinkUrl] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchQuery, setLastSearchQuery] = useState<string | null>(null);
  const [isRefilling, setIsRefilling] = useState(false);
  const [isCharacterModalOpen, setIsCharacterModalOpen] = useState(false);
  const [isCastLibraryOpen, setIsCastLibraryOpen] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  
  // Session Selection State
  const [isSessionSelectionMode, setIsSessionSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());

  const toggleSessionSelection = (id: string) => {
    const newSelection = new Set(selectedSessionIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedSessionIds(newSelection);
  };

  const handleBatchDeleteSessions = () => {
    if (selectedSessionIds.size === 0) return;
    if (!showBatchDeleteConfirm) {
      setShowBatchDeleteConfirm(true);
      return;
    }
    selectedSessionIds.forEach(id => onDeleteSession(id));
    setSelectedSessionIds(new Set());
    setIsSessionSelectionMode(false);
    setShowBatchDeleteConfirm(false);
  };

  const [editingMediaItemId, setEditingMediaItemId] = useState<string | null>(null); 
  const [editMediaName, setEditMediaName] = useState(''); 

  const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);
  const [genderFilters, setGenderFilters] = useState<Record<string, 'All' | 'Female' | 'Male'>>({ host: 'All', expert: 'All', guest: 'All' });
  const [historyEditingItemId, setHistoryEditingItemId] = useState<string | null>(null);
  const [historyEditItemName, setHistoryEditItemName] = useState(''); 
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [globalPodcastHistory, setGlobalPodcastHistory] = useState<MediaItem[]>([]);

  React.useEffect(() => {
    const loadGlobalHistory = () => {
      try {
        const saved = localStorage.getItem('global_podcast_history');
        if (saved) {
          setGlobalPodcastHistory(JSON.parse(saved));
        } else {
          setGlobalPodcastHistory([]);
        }
      } catch (err) {
        console.error("Failed to load global podcast history:", err);
      }
    };

    loadGlobalHistory();
    window.addEventListener('global_podcast_history_updated', loadGlobalHistory);
    return () => {
      window.removeEventListener('global_podcast_history_updated', loadGlobalHistory);
    };
  }, []);
  
  const showLabels = settings.showLabels;

  const availableVoices = [
      { name: 'Puck', gender: 'Male', style: 'Deep', lang: 'English' },
      { name: 'Charon', gender: 'Male', style: 'Deep', lang: 'English' },
      { name: 'Kore', gender: 'Female', style: 'Calm', lang: 'English' },
      { name: 'Fenrir', gender: 'Male', style: 'Intense', lang: 'English' },
      { name: 'Zephyr', gender: 'Female', style: 'High', lang: 'English' },
      { name: 'Aoede', gender: 'Female', style: 'Soft', lang: 'English' },
      { name: 'Lars', gender: 'Male', style: 'Swedish-Natural', lang: 'Swedish', voice: 'Fenrir' },
      { name: 'Elena', gender: 'Female', style: 'Swedish-Natural', lang: 'Swedish', voice: 'Zephyr' },
      { name: 'Astrid', gender: 'Female', style: 'Swedish-Natural', lang: 'Swedish', voice: 'Kore' },
      { name: 'Oskar', gender: 'Male', style: 'Swedish-Natural', lang: 'Swedish', voice: 'Puck' },
      { name: 'Freja', gender: 'Female', style: 'Swedish-Natural', lang: 'Swedish', voice: 'Aoede' },
  ];

  const filteredSessions = useMemo(() => {
    if (!globalSearch.trim()) return sessions;
    const lowerQuery = globalSearch.toLowerCase();
    return sessions.filter(s => 
      s.name.toLowerCase().includes(lowerQuery) || 
      s.history.some(m => m.content.toLowerCase().includes(lowerQuery))
    );
  }, [sessions, globalSearch]);

  const hasUnselectedLinks = useMemo(() => {
      return activeMediaItems.some(item => item.type === 'link' && !selectedMediaIds.includes(item.id));
  }, [activeMediaItems, selectedMediaIds]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(Array.from(e.target.files));
      e.target.value = ''; 
    }
  };

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (linkUrl.trim()) {
      onAddLink(linkUrl.trim());
      setLinkUrl('');
      setIsLinkInputOpen(false);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textTitle.trim() && textContent.trim()) {
      onAddText(textTitle.trim(), textContent.trim());
      setTextTitle('');
      setTextContent('');
      setIsTextInputOpen(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setIsSearching(true);
      setLastSearchQuery(searchQuery.trim());
      await onSearchWeb(searchQuery.trim());
      setIsSearching(false);
      setSearchQuery('');
      setIsSearchInputOpen(false);
    }
  };

  const handleRefillSubmit = async () => {
      if (lastSearchQuery && onRefillSearch) {
          setIsRefilling(true);
          await onRefillSearch(lastSearchQuery);
          setIsRefilling(false);
      }
  };

  const allSelected = activeMediaItems.length > 0 && selectedMediaIds.length === activeMediaItems.length;
  const handleMasterToggle = () => onToggleAllMedia(!allSelected);

  const startEditing = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditName(session.name);
  };

  const saveSessionName = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingSessionId && editName.trim()) onRenameSession(editingSessionId, editName.trim());
    setEditingSessionId(null);
  };

  const startEditingMediaItem = (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    setEditingMediaItemId(item.id);
    setEditMediaName(item.name);
  };

  const saveMediaItemName = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingMediaItemId && editMediaName.trim()) {
      onRenameMediaItem(editingMediaItemId, editMediaName.trim());
    }
    setEditingMediaItemId(null);
  };

  const handleSaveSessionTxt = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    let txt = `Session: ${session.name}\n`;
    txt += `Created: ${new Date(session.createdAt).toLocaleString()}\n\n`;
    txt += `--- SOURCES ---\n`;
    session.mediaItems.forEach(item => {
        txt += `\n[${item.type.toUpperCase()}] ${item.name}\n`;
        if (item.type === 'text' || item.type === 'link' || item.type === 'html') {
           try {
               const decoded = new TextDecoder().decode(Uint8Array.from(atob(item.data), c => c.charCodeAt(0)));
               txt += `${decoded}\n`;
           } catch(err){}
        } else {
           txt += `(Binary or Base64 data hidden)\n`;
        }
    });
    txt += `\n--- HISTORY ---\n`;
    session.history.forEach(msg => {
        txt += `\n[${msg.role.toUpperCase()}] ${new Date(msg.timestamp).toLocaleString()}\n`;
        txt += `${msg.content}\n`;
    });
    
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_${session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveMediaTxt = (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    let txt = `Source: ${item.name}\nType: ${item.type}\n\n`;
    if (item.type === 'text' || item.type === 'link' || item.type === 'html' || item.type === 'sql') {
        try {
            txt += new TextDecoder().decode(Uint8Array.from(atob(item.data), c => c.charCodeAt(0)));
        } catch(err){
            txt += "Error decoding content.";
        }
    } else {
        txt += "(Binary data, cannot be exported as plain text)";
    }
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `source_${item.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getNextClipTitle = () => {
    const clipRegex = /^Clip (\d+)$/i;
    let maxNum = 0;
    
    activeMediaItems.forEach(item => {
      const match = item.name.match(clipRegex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    
    const nextNum = maxNum + 1;
    return `Clip ${nextNum.toString().padStart(4, '0')}`;
  };

  const getSessionStyles = (id: string) => {
    const styles = [
      { border: 'border-blue-500', text: 'text-blue-400', bg: 'bg-blue-500/10' },
      { border: 'border-green-500', text: 'text-green-400', bg: 'bg-green-500/10' },
      { border: 'border-purple-500', text: 'text-purple-400', bg: 'bg-purple-500/10' },
      { border: 'border-pink-500', text: 'text-pink-400', bg: 'bg-pink-500/10' },
      { border: 'border-yellow-500', text: 'text-yellow-400', bg: 'bg-yellow-500/10' },
      { border: 'border-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/10' },
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) { hash = id.charCodeAt(i) + ((hash << 5) - hash); }
    return styles[Math.abs(hash) % styles.length];
  };

  const renderIcon = (item: MediaItem) => {
    if (item.type === 'image') return <img src={`data:${item.mimeType};base64,${item.data}`} alt={item.name} className="h-full w-full object-cover" />;
    if (item.type === 'video') return <video src={`data:${item.mimeType};base64,${item.data}`} className="h-full w-full object-cover" />;
    
    let path = "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"; 
    let color = "text-gray-400"; 

    if (item.type === 'audio') { 
        path = "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"; 
        color = "text-amber-400"; 
    }
    else if (item.type === 'pdf') { 
        path = "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"; 
        color = "text-rose-500"; 
    }
    else if (item.type === 'link') { 
        path = "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"; 
        color = "text-blue-400"; 
    }
    else if (item.type === 'sql') { 
        path = "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"; 
        color = "text-violet-400"; 
    }
    else if (item.type === 'text') {
        color = "text-cyan-400";
    }
    else if (item.type === 'document') {
        color = "text-blue-500";
    }
    
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
      </svg>
    );
  };

  const TabButton = ({ id, label, icon, colorClass, activeColorClass }: { id: 'sessions' | 'sources' | 'tools' | 'audio', label: string, icon: React.ReactElement, colorClass?: string, activeColorClass?: string }) => {
      const isActive = activeTab === id || (id === 'tools' && activeTab === 'audio');
      const activeStyle = isActive 
        ? `border-green-500 text-green-500 bg-app-card/30` 
        : `border-transparent ${colorClass || 'text-app-dim'} hover:text-green-500 hover:bg-app-card/10`;
      
      return (
        <button 
            onClick={() => onTabChange(id)}
            className={`flex-1 py-4 flex flex-col items-center justify-center gap-1 transition-all border-b-2 ${activeStyle}`}
            title={label}
        >
            <div className={`w-6 h-6 ${!isActive && colorClass ? 'transition-all' : ''}`}>{icon}</div>
        </button>
      );
  };

  return (
    <div 
      className={`flex flex-col h-full bg-app-panel border-r w-full md:w-80 shrink-0 transition-colors duration-300 relative overflow-hidden ${isDragging ? 'border-blue-500 bg-blue-900/10' : 'border-app-border'}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if(e.dataTransfer.files.length) onFileUpload(Array.from(e.dataTransfer.files)); }}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-app-panel/95 z-50 flex flex-col items-center justify-center pointer-events-none animate-pulse">
           <svg className="w-16 h-16 text-app-text mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
           <p className="text-xl font-bold text-app-text uppercase tracking-widest">Drop Files</p>
        </div>
      )}

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        multiple 
        accept=".doc,.docx,.pdf,.txt,.md,.json,.sql,.html,.css,.js,.ts,.tsx,.csv,.xls,.xlsx,image/*,video/*,audio/*"
        onChange={handleInputChange} 
      />

      {!onlySourcesView ? (
        <div className="flex border-b border-app-border bg-app-bg/50 backdrop-blur-sm z-10">
          <button 
             onClick={onGoHome}
             className={`w-14 py-4 flex flex-col items-center justify-center gap-1 transition-all border-b-2 border-r border-app-border/30 ${viewMode === 'library' ? 'border-green-500 text-green-500 bg-app-card/30' : 'border-transparent text-blue-500 hover:text-green-500 hover:bg-app-card/10'}`}
             title="Home / Library"
          >
             <div className="w-6 h-6">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
             </div>
          </button>
          <TabButton 
             id="sources" 
             label={t('workspace.sources')} 
             colorClass="text-orange-500"
             icon={<svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>} 
          />
          <TabButton 
             id="sessions" 
             label={t('workspace.sessions')} 
             colorClass="text-purple-500"
             icon={<svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>} 
          />
          <TabButton 
             id="tools" 
             label={t('workspace.tools')} 
             colorClass="text-yellow-500"
             icon={<svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>} 
          />
        </div>
      ) : (
        <div className="flex items-center justify-between p-4 border-b border-app-border bg-app-panel shadow-sm">
           <div className="flex items-center gap-2">
               <svg className="w-5 h-5 text-app-text" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
               <h3 className="text-sm font-bold text-app-text uppercase tracking-wider">Source Manager</h3>
           </div>
           <span className="text-[10px] bg-app-card border border-app-border px-2 py-1 rounded text-app-dim font-mono">{activeMediaItems.length}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto relative bg-app-panel/50">
        
        {activeTab === 'sessions' && !onlySourcesView && (
          <div className="p-3 space-y-3 animate-fade-in pb-20">
            <div className="relative group">
              <svg className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-app-dim group-focus-within:text-app-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text" 
                placeholder={t('library.search')} 
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="w-full bg-app-input border border-app-border rounded-lg pl-9 pr-3 py-2.5 text-xs text-app-text focus:outline-none focus:border-app-text transition-all"
              />
            </div>

            <div className="flex items-center gap-2 mb-2">
                <button onClick={onCreateSession} className="flex-1 p-3 bg-app-card hover:bg-app-text hover:text-app-bg border border-app-border rounded-lg text-app-text transition-all flex items-center justify-center gap-2 shadow-sm group">
                   <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                   {showLabels && <span className="text-xs font-bold uppercase tracking-wider">{t('library.newSession')}</span>}
                </button>
                <button 
                    onClick={() => {
                        setIsSessionSelectionMode(!isSessionSelectionMode);
                        setSelectedSessionIds(new Set());
                    }}
                    className={`p-3 border rounded-lg transition-all flex items-center justify-center shadow-sm ${isSessionSelectionMode ? 'bg-app-text text-app-bg border-app-text' : 'bg-app-card border-app-border text-app-dim hover:text-app-text'}`}
                    title="Select Multiple"
                >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg> </button>
            </div>

            {isSessionSelectionMode && (
                <div className="flex items-center justify-between bg-app-bg/50 px-3 py-2 rounded-lg border border-app-border mb-2 animate-fade-in">
                    <span className="text-[10px] uppercase font-bold text-app-dim tracking-widest">{selectedSessionIds.size} Selected</span>
                    <button 
                        onClick={handleBatchDeleteSessions}
                        disabled={selectedSessionIds.size === 0}
                        className={`px-2 py-1 ${showBatchDeleteConfirm ? 'bg-amber-600 hover:bg-amber-500' : 'bg-red-600 hover:bg-red-500'} disabled:opacity-50 text-white text-[10px] font-bold rounded shadow transition-colors uppercase tracking-wider flex items-center gap-1`}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        {showBatchDeleteConfirm ? 'Confirm Delete?' : t('workspace.delete')}
                    </button>
                </div>
            )}

            <div className="space-y-1">
              {filteredSessions.map(session => {
                const styles = getSessionStyles(session.id);
                const isActive = session.id === activeSessionId;
                const isEditing = editingSessionId === session.id;
                
                return (
                  <div 
                    key={session.id} 
                    onClick={() => {
                        if (isSessionSelectionMode) {
                            toggleSessionSelection(session.id);
                        } else if (!isEditing) {
                            onSwitchSession(session.id);
                        }
                    }}
                    className={`relative flex items-center p-3 rounded-lg cursor-pointer group transition-all border ${
                        isSessionSelectionMode 
                            ? (selectedSessionIds.has(session.id) ? 'bg-app-card border-blue-500 shadow-md' : 'border-app-border hover:bg-app-card/50')
                            : (isActive ? `${styles.border} ${styles.bg}` : `border-transparent hover:bg-app-card hover:border-app-border`)
                    }`}
                  >
                    {isSessionSelectionMode && (
                        <div className={`w-4 h-4 rounded border mr-3 flex items-center justify-center transition-colors ${selectedSessionIds.has(session.id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-app-dim'}`}>
                            {selectedSessionIds.has(session.id) && <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                    )}
                    <div className="flex flex-col flex-1 min-w-0 mr-2">
                       {isEditing ? (
                         <input 
                           type="text" 
                           value={editName}
                           onChange={(e) => setEditName(e.target.value)}
                           onBlur={() => saveSessionName()}
                           onKeyDown={(e) => { if (e.key === 'Enter') saveSessionName(); if (e.key === 'Escape') setEditingSessionId(null); }}
                           autoFocus
                           className="bg-app-input border border-app-text rounded px-1 py-0.5 text-sm text-app-text w-full focus:outline-none"
                           onClick={(e) => e.stopPropagation()}
                         />
                       ) : (
                         <span className={`text-sm font-bold truncate ${isActive ? styles.text : 'text-app-text'}`}>{session.name}</span>
                       )}
                       <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-app-dim">{new Date(session.createdAt).toLocaleDateString()}</span>
                          <span className="w-1 h-1 rounded-full bg-app-border"></span>
                          <span className="text-[10px] text-app-dim">{session.mediaItems.length} items</span>
                       </div>
                    </div>
                    
                    {!isEditing && (
                        <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity bg-app-panel shadow-md p-1 rounded-lg border border-app-border`}>
                            {onGenerateWebsite && (
                            <>
                            <button onClick={(e) => { e.stopPropagation(); onGenerateWebsite(session.id); }} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-sky-500 hover:text-white text-app-dim transition-colors" title="Turn session into a website (offline, no AI)">
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></svg>
                            {showLabels && <span className="text-[9px] font-bold uppercase">Web</span>}
                            </button>
                            <div className="w-px h-3 bg-app-border mx-0.5"></div>
                            </>
                            )}
                            <button onClick={(e) => startEditing(e, session)} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-app-text hover:text-app-bg text-app-dim transition-colors" title="Rename">
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                            {showLabels && <span className="text-[9px] font-bold uppercase">Edit</span>}
                            </button>
                            <div className="w-px h-3 bg-app-border mx-0.5"></div>
                            <button onClick={(e) => handleSaveSessionTxt(e, session)} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-emerald-500 hover:text-white text-app-dim transition-colors" title="Save to TXT">
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            {showLabels && <span className="text-[9px] font-bold uppercase">Save</span>}
                            </button>
                            <div className="w-px h-3 bg-app-border mx-0.5"></div>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-500 hover:text-white text-app-dim transition-colors" title="Delete">
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            {showLabels && <span className="text-[9px] font-bold uppercase">Del</span>}
                            </button>
                        </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'sources' && (
          <div className="p-3 space-y-3 animate-fade-in pb-20">
             
            {!isLinkInputOpen && !isTextInputOpen && !isSearchInputOpen ? (
              <div className="grid grid-cols-2 gap-2">
                 <button onClick={handleUploadClick} className="flex items-center justify-center gap-2 py-3 rounded-lg bg-app-card hover:bg-emerald-500/10 border border-app-border hover:border-emerald-500/50 transition-all group" title={!showLabels ? t('workspace.upload') : undefined}>
                    <svg className="w-4 h-4 text-emerald-400 group-hover:text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    {showLabels && <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500/70 group-hover:text-emerald-400">{t('workspace.upload')}</span>}
                 </button>
                 <button onClick={() => setIsLinkInputOpen(true)} className="flex items-center justify-center gap-2 py-3 rounded-lg bg-app-card hover:bg-blue-500/10 border border-app-border hover:border-blue-500/50 transition-all group" title={!showLabels ? t('workspace.addLink') : undefined}>
                    <svg className="w-4 h-4 text-blue-400 group-hover:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                    {showLabels && <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500/70 group-hover:text-blue-400">{t('workspace.addLink')}</span>}
                 </button>
                 <button onClick={() => { setTextTitle(getNextClipTitle()); setIsTextInputOpen(true); }} className="flex items-center justify-center gap-2 py-3 rounded-lg bg-app-card hover:bg-purple-500/10 border border-app-border hover:border-purple-500/50 transition-all group" title={!showLabels ? t('workspace.addText') : undefined}>
                    <svg className="w-4 h-4 text-purple-400 group-hover:text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 022 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    {showLabels && <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500/70 group-hover:text-purple-400">{t('workspace.addText')}</span>}
                 </button>
                 <button onClick={() => setIsSearchInputOpen(true)} className="flex items-center justify-center gap-2 py-3 rounded-lg bg-app-card hover:bg-orange-500/10 border border-app-border hover:border-orange-500/50 transition-all group" title={!showLabels ? t('workspace.searchWeb') : undefined}>
                    <svg className="w-4 h-4 text-orange-400 group-hover:text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    {showLabels && <span className="text-[10px] font-bold uppercase tracking-wider text-orange-500/70 group-hover:text-orange-400">{t('workspace.searchWeb')}</span>}
                 </button>
              </div>
            ) : null }
            
            {lastSearchQuery && hasUnselectedLinks && !isSearchInputOpen && onRefillSearch && (
                <div className="bg-app-card border border-purple-500/30 rounded-lg p-2 flex items-center justify-between shadow-lg animate-fade-in">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Refine Search</span>
                        <span className="text-[9px] text-app-dim truncate max-w-[120px]">Replacing unselected...</span>
                    </div>
                    <button 
                        onClick={handleRefillSubmit}
                        disabled={isRefilling}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded shadow transition-colors flex items-center gap-1"
                    >
                        {isRefilling ? (
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        )}
                        FIND NEW
                    </button>
                </div>
            )}
            
            {isLinkInputOpen && (
              <form onSubmit={handleLinkSubmit} className="bg-app-card p-3 rounded-lg border border-app-border shadow-md animate-fade-in">
                <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." className="w-full bg-app-input border border-app-border rounded px-2 py-2 text-xs text-app-text mb-2 focus:outline-none focus:border-blue-500" autoFocus />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setIsLinkInputOpen(false); setLinkUrl(''); }} className="px-3 py-1 text-xs font-bold text-app-dim hover:text-app-text">CANCEL</button>
                  <button type="submit" disabled={!linkUrl.trim()} className="px-3 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded shadow disabled:opacity-50">ADD URL</button>
                </div>
              </form>
            )}

            {isTextInputOpen && (
              <form onSubmit={handleTextSubmit} className="bg-app-card p-3 rounded-lg border border-app-border shadow-md animate-fade-in flex flex-col gap-2">
                <input type="text" value={textTitle} onChange={(e) => setTextTitle(e.target.value)} placeholder="Title (e.g. Meeting Notes)" className="w-full bg-app-input border border-app-border rounded px-2 py-2 text-xs text-app-text focus:outline-none focus:border-blue-500" autoFocus />
                <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)} placeholder="Paste text content here..." className="w-full h-32 bg-app-input border border-app-border rounded px-2 py-2 text-xs text-app-text focus:outline-none focus:border-blue-500 resize-none custom-scrollbar" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setIsTextInputOpen(false); setTextTitle(''); setTextContent(''); }} className="px-3 py-1 text-xs font-bold text-app-dim hover:text-app-text">CANCEL</button>
                  <button type="submit" disabled={!textTitle.trim() || !textContent.trim()} className="px-3 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded shadow disabled:opacity-50">SAVE</button>
                </div>
              </form>
            )}

            {isSearchInputOpen && (
              <form onSubmit={handleSearchSubmit} className="bg-app-card p-3 rounded-lg border border-app-border shadow-md animate-fade-in">
                <div className="mb-2">
                    <p className="text-[10px] text-app-dim uppercase tracking-wider mb-1">Search Topic</p>
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="e.g. Latest advancements in fusion energy" className="w-full bg-app-input border border-app-border rounded px-2 py-2 text-xs text-app-text focus:outline-none focus:border-blue-500" autoFocus />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-app-dim italic">Finds & adds top 5 results as links</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setIsSearchInputOpen(false); setSearchQuery(''); }} className="px-3 py-1 text-xs font-bold text-app-dim hover:text-app-text">CANCEL</button>
                    <button type="submit" disabled={!searchQuery.trim() || isSearching} className="px-3 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded shadow disabled:opacity-50 flex items-center gap-1">
                        {isSearching && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                        SEARCH
                    </button>
                  </div>
                </div>
              </form>
            )}

             {activeMediaItems.length > 0 && (
              <div className="flex items-center justify-between bg-app-bg/50 px-3 py-2 rounded-lg border border-app-border">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-app-dim tracking-widest">Select All Sources</span>
                    {selectedMediaIds.length > 1 && onCombineMedia && (
                        <button 
                            onClick={() => onCombineMedia(selectedMediaIds, getNextClipTitle())}
                            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[9px] font-bold rounded shadow transition-colors uppercase tracking-wider"
                        >
                            Combine
                        </button>
                    )}
                </div>
                <button 
                  onClick={handleMasterToggle}
                  className={`w-9 h-5 rounded-full flex items-center transition-colors p-0.5 focus:outline-none ${allSelected ? 'bg-app-text' : 'bg-app-border'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-app-bg shadow-sm transform transition-transform duration-300 ${allSelected ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            )}

            {activeMediaItems.length === 0 && !isLinkInputOpen && !isTextInputOpen && !isSearchInputOpen && (
               <div className="py-10 text-center text-app-dim border-2 border-dashed border-app-border rounded-xl">
                  <p className="text-xs uppercase font-bold tracking-widest opacity-50">No Sources Added</p>
                  <p className="text-[10px] mt-1 opacity-50">Drag files here to begin</p>
               </div>
            )}

            <div className="space-y-2">
              {activeMediaItems.map((item) => {
                const isSelected = selectedMediaIds.includes(item.id);
                const isEditingMedia = editingMediaItemId === item.id;
                const isLink = item.type === 'link';

                return (
                  <div key={item.id} className={`group relative flex items-center gap-3 p-2 rounded-lg border transition-all ${isSelected ? 'bg-app-card border-app-border shadow-sm' : 'bg-transparent border-transparent opacity-60 hover:opacity-100 hover:bg-app-card/30'}`}>
                    
                    <button onClick={() => onToggleMedia(item.id)} className="flex-shrink-0 focus:outline-none">
                      <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-app-text border-app-text text-app-bg' : 'border-app-dim hover:border-app-text'}`}>
                         {isSelected && <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </div>
                    </button>
                    
                    <div className="w-8 h-8 rounded bg-app-bg flex items-center justify-center border border-app-border shrink-0 overflow-hidden">
                      {renderIcon(item)}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-center h-full">
                       {isEditingMedia ? (
                          <input 
                            type="text" 
                            value={editMediaName}
                            onChange={(e) => setEditMediaName(e.target.value)}
                            onBlur={() => saveMediaItemName()}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveMediaItemName(); if (e.key === 'Escape') setEditingMediaItemId(null); }}
                            autoFocus
                            className="bg-app-input border border-app-text rounded px-1 py-0.5 text-xs text-app-text w-full focus:outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                       ) : (
                          <p className={`text-xs font-bold truncate leading-tight ${isSelected ? 'text-app-text' : 'text-app-dim line-through decoration-app-border'}`} title={item.name}>{item.name}</p>
                       )}
                       <div className="flex items-center gap-2 mt-0.5">
                         <p className="text-[9px] text-app-dim uppercase tracking-wide">{item.type}</p>
                         {item.tags && item.tags.length > 0 && (
                           <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                             {item.tags.map((tag, idx) => (
                               <span key={idx} className="text-[8px] px-1.5 py-0.5 rounded-sm bg-app-dim/10 text-app-dim whitespace-nowrap border border-app-dim/20">
                                 {tag}
                               </span>
                             ))}
                           </div>
                         )}
                       </div>
                    </div>

                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-app-panel shadow-lg p-0.5 rounded-lg border border-app-border z-10">
                      {!isEditingMedia && (
                        <button onClick={(e) => startEditingMediaItem(e, item)} className="p-1.5 rounded hover:bg-app-text hover:text-app-bg text-app-dim transition-colors" title="Rename">
                           <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                        </button>
                      )}
                      <div className="w-px h-3 bg-app-border mx-0.5"></div>
                      <button onClick={(e) => handleSaveMediaTxt(e, item)} className="p-1.5 rounded hover:bg-emerald-500 hover:text-white text-app-dim transition-colors" title="Save Content">
                         <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                      </button>
                      <div className="w-px h-3 bg-app-border mx-0.5"></div>
                      {isLink ? (
                        <button onClick={() => window.open(item.data, '_blank')} className="p-1.5 rounded hover:bg-app-text hover:text-app-bg text-app-dim transition-colors" title="Open Link">
                           <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                        </button>
                      ) : (
                        <button onClick={() => onViewMedia(item)} className="p-1.5 rounded hover:bg-app-text hover:text-app-bg text-app-dim transition-colors" title="Focus View">
                           <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                        </button>
                      )}
                      <div className="w-px h-3 bg-app-border mx-0.5"></div>
                      <button onClick={() => onRemove(item.id)} className="p-1.5 rounded hover:bg-red-500 hover:text-white text-app-dim transition-colors" title="Remove">
                         <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(activeTab === 'tools' || activeTab === 'audio') && !onlySourcesView && (
           <div className="p-3 space-y-3 animate-fade-in pb-20">
              
              {activeTab === 'audio' && (
                <>
                  {/* Step 1 — Speaker Configuration MUST come before creating a podcast */}
                  <div className="bg-app-card border border-app-border rounded-xl p-3 mb-2">
                      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                          <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                              <h4 className="text-xs font-bold text-app-text uppercase tracking-wider">
                                <span className="text-emerald-400">Step 1</span> — Speakers
                              </h4>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                const { voiceSettings: nextVoiceSettings, touchedRoles: nextTouched } =
                                  buildStaggeredDefaultVoiceSettings(
                                    voiceSettings,
                                    castLibrary.length ? castLibrary : undefined,
                                    { shortSwedishLabels: true },
                                  );
                                onUpdateVoiceSettings(nextVoiceSettings);
                                setEffectiveTouchedRoles(nextTouched);
                              }}
                              className="text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/20 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/30 transition-all"
                              title="Insert staggered Male/Female default characters for Host, Expert, and Guest"
                            >
                              {t('studio.useDefault')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsCastLibraryOpen(true)}
                              className="text-[10px] font-bold text-purple-400 hover:bg-purple-500/20 bg-purple-500/10 px-2 py-1 rounded border border-purple-500/30 uppercase tracking-wider flex items-center gap-1 transition-all"
                              title="Open Cast Library"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.149-1.268.432-1.828M14 10a6 6 0 01-6 6H6a6 6 0 01-6-6V7a3 3 0 013-3h7a3 3 0 013 3v3z" /></svg>
                              Cast
                            </button>
                            <button 
                              type="button"
                              onClick={() => setIsCharacterModalOpen(true)}
                              className="text-[10px] font-bold text-rose-500 hover:text-rose-400 uppercase tracking-widest flex items-center gap-1 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20 transition-all"
                              title="Open Character Prompt Library"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" /></svg>
                              Library
                            </button>
                          </div>
                      </div>
                      <div className="space-y-3">
                        {([
                          { key: 'host' as const, labelKey: 'hostLabel' as const, bioKey: 'hostBio' as const, avatarKey: 'hostAvatar' as const, memberKey: 'hostMemberId' as const, title: 'Host', optional: false },
                          { key: 'expert' as const, labelKey: 'expertLabel' as const, bioKey: 'expertBio' as const, avatarKey: 'expertAvatar' as const, memberKey: 'expertMemberId' as const, title: 'Expert', optional: true },
                          { key: 'guest' as const, labelKey: 'guestLabel' as const, bioKey: 'guestBio' as const, avatarKey: 'guestAvatar' as const, memberKey: 'guestMemberId' as const, title: 'Guest', optional: true }
                        ]).map((role) => {
                            const isRoleConfigured = effectiveTouchedRoles.includes(role.key);
                            const assignedMemberId = isRoleConfigured ? voiceSettings[role.memberKey] : undefined;
                            const assignedMember = assignedMemberId ? castLibrary.find(m => m.id === assignedMemberId) : undefined;
                            const currentVoiceValue = isRoleConfigured
                              ? (assignedMember
                                  ? `cast:${assignedMember.id}`
                                  : (voiceSettings.language === 'Swedish'
                                      ? (availableVoices.find(v => v.lang === 'Swedish' && v.voice === voiceSettings[role.key])?.name || voiceSettings[role.key] || '')
                                      : (voiceSettings[role.key] || '')))
                              : '';
                            const currentDisplayLabel = isRoleConfigured ? (voiceSettings[role.labelKey] || '') : '';
                            const currentAvatar = isRoleConfigured ? (voiceSettings[role.avatarKey] || assignedMember?.avatar) : undefined;
                            const currentBio = isRoleConfigured ? (voiceSettings[role.bioKey] || assignedMember?.bio) : undefined;
                            const isSwedish = voiceSettings.language === 'Swedish';
                            const genderFilter = genderFilters[role.key] || 'All';
                            const filteredCastOptions = castLibrary.filter(m => {
                              const langMatch = m.category === 'user' || (isSwedish ? m.id.includes('-sv-') : !m.id.includes('-sv-'));
                              if (!langMatch) return false;
                              if (genderFilter !== 'All') return (m.gender || 'Female') === genderFilter;
                              return true;
                            });
                            const filteredVoiceOptions = availableVoices.filter(v => {
                              const langMatch = isSwedish ? v.lang === 'Swedish' : v.lang === 'English';
                              if (!langMatch) return false;
                              if (genderFilter !== 'All') return v.gender === genderFilter;
                              return true;
                            });
                            return (
                            <div key={role.key} className="p-2.5 bg-app-panel rounded-lg border border-app-border space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {currentAvatar && (
                                          <img
                                            src={currentAvatar}
                                            alt={role.title}
                                            className="w-5 h-5 rounded-full object-cover border border-app-border"
                                            referrerPolicy="no-referrer"
                                          />
                                        )}
                                        <span className="text-[10px] font-bold uppercase text-app-text">{role.title}</span>
                                        {role.optional && (
                                          <span className="text-[8px] text-zinc-500 uppercase">{t('studio.optional')}</span>
                                        )}
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase ${isRoleConfigured ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
                                          {isRoleConfigured ? t('studio.configured') : t('studio.notConfigured')}
                                        </span>
                                    </div>
                                    {isRoleConfigured && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          untouchRole(role.key);
                                          onUpdateVoiceSettings({
                                            ...voiceSettings,
                                            [role.memberKey]: undefined,
                                            [role.avatarKey]: undefined,
                                            [role.bioKey]: undefined,
                                          });
                                        }}
                                        className="text-[9px] text-zinc-500 hover:text-red-400 transition-colors font-semibold uppercase"
                                      >
                                        × {t('studio.clear')}
                                      </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input 
                                        type="text"
                                        value={currentDisplayLabel}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val.trim()) {
                                            touchRole(role.key);
                                            onUpdateVoiceSettings({ ...voiceSettings, [role.labelKey]: val });
                                          } else {
                                            onUpdateVoiceSettings({ ...voiceSettings, [role.labelKey]: val });
                                          }
                                        }}
                                        placeholder={`Enter ${role.title} name...`}
                                        className="flex-1 bg-app-input border border-app-border text-[10px] font-bold uppercase text-app-text rounded px-2 py-1 focus:outline-none focus:border-app-text"
                                    />
                                </div>
                                <div className="flex items-center justify-between my-1">
                                    <div className="text-[9px] font-bold text-app-dim uppercase">Cast / Voice</div>
                                    <div className="flex gap-0.5 bg-zinc-950 px-1 py-0.5 rounded border border-zinc-800">
                                        {(['All', 'Female', 'Male'] as const).map(g => (
                                            <button 
                                                key={g}
                                                type="button"
                                                onClick={() => setGenderFilters(prev => ({ ...prev, [role.key]: g }))}
                                                className={`px-1 py-0.2 rounded text-[8px] font-bold transition-colors ${genderFilters[role.key] === g ? 'bg-purple-500 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                                            >
                                                {g === 'Female' && '♀'}
                                                {g === 'Male' && '♂'}
                                                {g === 'All' && 'All'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <select 
                                    value={currentVoiceValue}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (!val) {
                                          untouchRole(role.key);
                                          onUpdateVoiceSettings({
                                            ...voiceSettings,
                                            [role.memberKey]: undefined,
                                            [role.avatarKey]: undefined,
                                            [role.bioKey]: undefined,
                                          });
                                          return;
                                        }
                                        touchRole(role.key);
                                        const standardNames = ['Sax', 'Chameleon', 'The Pinpoint', 'Lars', 'Elena', 'Astrid', 'Oskar', 'Freja', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Aoede', 'Narrator Bot', 'Dr. Insight', 'Curious Listener', 'Lars (Värd)', 'Elena (Expert)', 'Astrid (Trend)', 'Oskar (Affär)', 'Freja (Berättare)'];
                                        const existingLabel = isRoleConfigured ? (voiceSettings[role.labelKey] || '') : '';
                                        const isCustom = existingLabel && !standardNames.includes(existingLabel) && !castLibrary.some(cm => cm.name === existingLabel);

                                        if (val.startsWith('cast:')) {
                                          const memberId = val.slice(5);
                                          const member = castLibrary.find(cm => cm.id === memberId);
                                          if (member) {
                                            const updates: any = {
                                              [role.key]: member.voice,
                                              [role.memberKey]: member.id,
                                              [role.bioKey]: member.bio,
                                              [role.avatarKey]: member.avatar,
                                            };
                                            if (!isCustom) {
                                              updates[role.labelKey] = member.name;
                                            }
                                            onUpdateVoiceSettings({ ...voiceSettings, ...updates });
                                            return;
                                          }
                                        }

                                        const options = availableVoices.filter(v => isSwedish ? v.lang === 'Swedish' : v.lang === 'English');
                                        const selectedVoice = options.find(v => v.name === val);
                                        const updates: any = {
                                          [role.key]: selectedVoice ? (selectedVoice.voice || selectedVoice.name) : val,
                                          [role.memberKey]: undefined,
                                        };
                                        if (selectedVoice && !isCustom) {
                                            updates[role.labelKey] = selectedVoice.name;
                                        }
                                        onUpdateVoiceSettings({ ...voiceSettings, ...updates });
                                    }}
                                    className="w-full bg-app-input border border-app-border text-xs text-app-text rounded px-2 py-1 focus:outline-none"
                                >
                                    <option value="">{t('studio.selectCastMember')}</option>
                                    {filteredCastOptions.length > 0 && (
                                      <optgroup label="Cast Library">
                                        {filteredCastOptions.map(member => (
                                          <option key={member.id} value={`cast:${member.id}`}>
                                            {member.gender === 'Male' ? '♂' : member.gender === 'Neutral' ? '⚪' : '♀'} {member.name} ({member.voice}{member.category === 'user' ? ' • Custom' : ''})
                                          </option>
                                        ))}
                                      </optgroup>
                                    )}
                                    <optgroup label="Studio Voices">
                                      {filteredVoiceOptions.map(v => (
                                          <option key={v.name} value={v.name}>
                                              {v.gender === 'Male' ? '♂' : '♀'} {v.name} ({v.style})
                                          </option>
                                      ))}
                                    </optgroup>
                                </select>
                                {currentBio && (
                                  <div className="text-[9px] text-app-dim italic line-clamp-2 px-1">
                                    {currentBio}
                                  </div>
                                )}
                                
                                <div className="space-y-1">
                                    <label className="text-[9px] text-app-dim uppercase font-bold">Character Profile</label>
                                    <select 
                                        value={isRoleConfigured ? (voiceSettings[`${role.key}CharacterId` as keyof VoiceSettings] || '') : ''}
                                        onChange={(e) => {
                                          if (e.target.value) touchRole(role.key);
                                          onUpdateVoiceSettings({ ...voiceSettings, [`${role.key}CharacterId`]: e.target.value });
                                        }}
                                        className="w-full bg-app-input border border-app-border text-[10px] text-app-text rounded px-2 py-1 focus:outline-none"
                                    >
                                        <option value="">Default Personality</option>
                                        {characters.map(char => (
                                            <option key={char.id} value={char.id}>{char.title}</option>
                                        ))}
                                    </select>
                                    {isRoleConfigured && voiceSettings[`${role.key}CharacterId` as keyof VoiceSettings] && (
                                        <div className="text-[9px] text-app-dim italic line-clamp-2 px-1">
                                            {characters.find(c => c.id === voiceSettings[`${role.key}CharacterId` as keyof VoiceSettings])?.content}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                        })}
                     </div>
                  </div>

                  <div className="bg-app-card border border-app-border rounded-xl p-3 mb-2">
                      <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-app-text" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <h4 className="text-xs font-bold text-app-text uppercase tracking-wider">Podcast Length</h4>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                          {['Short (1-2 min)', 'Medium (3-5 min)', 'Long (Deep Dive)'].map((len) => (
                              <button
                                  key={len}
                                  onClick={() => onUpdateVoiceSettings({ ...voiceSettings, length: len as any })}
                                  className={`p-2 rounded-lg border text-[10px] font-bold transition-all ${voiceSettings.length === len ? 'bg-app-text text-app-bg border-app-text' : 'bg-app-panel border-app-border text-app-dim hover:text-app-text'}`}
                              >
                                  {len.split(' ')[0]}
                              </button>
                          ))}
                      </div>
                  </div>

                  {/* Step 2 — Generate Podcast (locked until at least Host speaker is configured) */}
                  <div className={`bg-app-card border border-app-border rounded-xl p-3 mb-2 transition-opacity ${hostConfigured ? '' : 'opacity-80'}`}>
                      <div className="flex items-center gap-3 mb-3">
                          <div className="p-2.5 rounded-lg bg-app-panel border border-app-border text-rose-500">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                          </div>
                          <div className="flex-1">
                              <h4 className="text-sm font-bold text-app-text">
                                <span className="text-emerald-400 text-[10px] uppercase mr-1">Step 2</span>
                                Audio Podcast
                              </h4>
                              <div className="flex items-center gap-1.5 mt-1">
                                  <button 
                                      onClick={() => onUpdateVoiceSettings({ ...voiceSettings, language: 'English' })}
                                      className={`text-[9px] px-2 py-0.5 rounded-md border font-bold transition-all ${voiceSettings.language === 'English' || !voiceSettings.language ? 'bg-blue-600 border-blue-500 text-white shadow-sm' : 'bg-app-panel border-app-border text-app-dim hover:text-app-text'}`}
                                  >
                                      EN
                                  </button>
                                  <button 
                                      onClick={() => onUpdateVoiceSettings({ ...voiceSettings, language: 'Swedish' })}
                                      className={`text-[9px] px-2 py-0.5 rounded-md border font-bold transition-all ${voiceSettings.language === 'Swedish' ? 'bg-blue-600 border-blue-500 text-white shadow-sm' : 'bg-app-panel border-app-border text-app-dim hover:text-app-text'}`}
                                  >
                                      SV
                                  </button>
                              </div>
                          </div>
                      </div>
                      {!hostConfigured && (
                        <div className="mb-3 flex items-center gap-2 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-2">
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          <span>{t('studio.configureSpeakersHint')}</span>
                        </div>
                      )}
                      {hostConfigured && multipleConfigured && (
                        <div className="mb-3 text-[10px] text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded-lg px-2.5 py-1.5">
                          {t('studio.soloUsesHostOnly')}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                          {([
                            { id: 'podcast_1' as PodcastFormatId, label: 'Report', hoverClass: 'hover:border-purple-500 hover:bg-purple-500/10', iconColor: 'text-purple-400', path: 'M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z', singlePath: true },
                            { id: 'podcast_2' as PodcastFormatId, label: 'Dialogue', hoverClass: 'hover:border-blue-500 hover:bg-blue-500/10', iconColor: 'text-blue-400', path: 'M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z', singlePath: false },
                            { id: 'podcast_3' as PodcastFormatId, label: 'Roundtable', hoverClass: 'hover:border-amber-500 hover:bg-amber-500/10', iconColor: 'text-amber-400', path: 'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z', singlePath: false },
                          ]).map((fmt) => {
                            const fmtGate = computePodcastGate({
                              touchedRoles: effectiveTouchedRoles,
                              activeFormat: fmt.id,
                              contentReady: true,
                              isLoading: false,
                            });
                            const missing = requiredRolesFor(fmt.id).filter(r => !configuredRoles.includes(r));
                            return (
                              <button 
                                key={fmt.id}
                                onClick={() => {
                                  if (!fmtGate.hostConfigured) return;
                                  onRunTool(fmt.id, { hostOnly: fmtGate.hostOnly, speakerCount: fmtGate.speakerCount });
                                }}
                                disabled={!hostConfigured || toolLoadingState[fmt.id]}
                                className={`flex flex-col items-center justify-center p-2 bg-app-panel border border-app-border rounded-lg transition-all group/btn relative min-h-[60px] disabled:opacity-40 disabled:cursor-not-allowed ${hostConfigured ? fmt.hoverClass : ''}`}
                              >
                                {toolLoadingState[fmt.id] ? (
                                   <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full mb-1"></div>
                                ) : (
                                   <div className="mb-1">
                                      <svg className={`w-5 h-5 ${fmt.iconColor}`} viewBox="0 0 20 20" fill="currentColor">
                                          {fmt.singlePath ? (
                                            <path fillRule="evenodd" d={fmt.path} clipRule="evenodd" />
                                          ) : (
                                            <path d={fmt.path} />
                                          )}
                                      </svg>
                                   </div>
                                )}
                                <span className="text-[9px] opacity-80">{fmt.label}</span>
                                {hostConfigured && missing.length > 0 && (
                                  <span className="text-[8px] text-amber-400/90 mt-0.5 text-center leading-tight">
                                    {t('studio.needs')} {missing.map(r => r[0].toUpperCase() + r.slice(1)).join('+')}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                      </div>
                  </div>

                  {/* Generated History Section */}
                  <div className="bg-app-card border border-app-border rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-3">
                          <svg className="w-4 h-4 text-app-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <h4 className="text-xs font-bold text-app-text uppercase tracking-wider">Generated History</h4>
                      </div>
                      
                      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                          {!globalPodcastHistory.length ? (
                              <div className="text-center py-6 text-[11px] text-app-dim border border-dashed border-app-border rounded-lg bg-app-panel">
                                  No generated podcasts yet.
                              </div>
                          ) : (
                              globalPodcastHistory.map(item => (
                                  <div 
                                      key={item.id}
                                      className="group/hist p-2 bg-app-panel border border-app-border rounded-lg flex items-center justify-between gap-2 hover:border-purple-500/50 transition-all"
                                  >
                                      {historyEditingItemId === item.id ? (
                                          <div className="flex-1 flex items-center gap-1.5">
                                              <input 
                                                  type="text"
                                                  value={historyEditItemName}
                                                  onChange={(e) => setHistoryEditItemName(e.target.value)}
                                                  className="flex-1 bg-app-input border border-purple-500 rounded px-1.5 py-0.5 text-xs text-app-text focus:outline-none"
                                                  autoFocus
                                              />
                                              <button 
                                                  onClick={() => {
                                                      if (historyEditItemName.trim() && onRenameMediaItem) {
                                                          onRenameMediaItem(item.id, historyEditItemName.trim());
                                                      }
                                                      setHistoryEditingItemId(null);
                                                  }}
                                                  className="px-1.5 py-0.5 bg-purple-600 hover:bg-purple-500 text-white text-[9px] font-bold rounded"
                                              >
                                                  Save
                                              </button>
                                              <button 
                                                  onClick={() => setHistoryEditingItemId(null)}
                                                  className="px-1.5 py-0.5 bg-app-card hover:bg-app-border text-app-dim text-[9px] font-bold rounded"
                                              >
                                                  Cancel
                                              </button>
                                          </div>
                                      ) : (
                                          <>
                                              <button 
                                                  onClick={() => onLoadAudio && onLoadAudio(item)}
                                                  className="flex-1 text-left min-w-0 flex items-center gap-2"
                                                  title="Load Podcast"
                                              >
                                                  <div className="w-6 h-6 shrink-0 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover/hist:bg-purple-500 group-hover/hist:text-white transition-colors">
                                                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                                  </div>
                                                  <div className="flex-1 min-w-0">
                                                      <div className="text-xs font-semibold text-app-text truncate">{item.name || 'Untitled Generation'}</div>
                                                      <div className="text-[9px] text-app-dim">{(item as any).file ? new Date((item as any).file.lastModified).toLocaleString() : 'Generated Podcast'}</div>
                                                  </div>
                                              </button>
                                              
                                              <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 group-hover/hist:opacity-100 transition-opacity">
                                                  <button 
                                                      onClick={() => {
                                                          setHistoryEditingItemId(item.id);
                                                          setHistoryEditItemName(item.name || '');
                                                      }}
                                                      className="p-1 text-app-dim hover:text-purple-400 hover:bg-purple-500/10 rounded transition-colors"
                                                      title="Rename"
                                                  >
                                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                      </svg>
                                                  </button>
                                                  <button 
                                                      onClick={() => { if (deleteConfirmId === item.id) { if (onRemove) onRemove(item.id); setDeleteConfirmId(null); } else { setDeleteConfirmId(item.id); } }}
                                                      className={`p-1 rounded transition-all ${deleteConfirmId === item.id ? "text-red-400 bg-red-500/20 font-bold px-1.5 animate-pulse" : "text-app-dim hover:text-red-400 hover:bg-red-500/10"}`} title={deleteConfirmId === item.id ? "Confirm Delete" : "Delete"} > {deleteConfirmId === item.id ? <span className="text-[8px] uppercase tracking-wider font-extrabold text-red-500">Confirm?</span> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                      </svg>}
                                                  </button>
                                              </div>
                                          </>
                                      )}
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
                </>
              )}

              {activeTab === 'tools' && (
                <div className="grid grid-cols-1 gap-3">
                   {/* Data Table Tool Card */}
                   <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
                      <button
                        onClick={() => setIsDataTableOpen(!isDataTableOpen)}
                        className={`w-full p-3 flex items-center gap-3 text-left transition-all ${isDataTableOpen ? 'bg-app-panel' : 'hover:bg-app-panel'}`}
                      >
                         <div className="p-2.5 rounded-lg bg-green-900/30 border border-green-500/30 text-green-400">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                         </div>
                         <div className="flex-1">
                            <h4 className="text-sm font-bold">Data Table</h4>
                            <p className="text-[10px] opacity-70">Extract structured data into Sheets</p>
                         </div>
                         <svg className={`w-4 h-4 transition-transform ${isDataTableOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      
                      {isDataTableOpen && (
                        <div className="p-3 bg-app-panel/50 border-t border-app-border animate-fade-in space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold text-app-dim uppercase tracking-wider mb-1">Extraction Requirements</label>
                                <textarea 
                                    value={tableInstructions}
                                    onChange={(e) => setTableInstructions(e.target.value)}
                                    placeholder="e.g. List all mentioned companies, their revenue, and headquarters location."
                                    className="w-full h-20 bg-app-input border border-app-border rounded p-2 text-xs text-app-text focus:outline-none focus:border-green-500 resize-none"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-app-dim uppercase tracking-wider mb-1">Language</label>
                                    <select 
                                        value={tableLanguage}
                                        onChange={(e) => setTableLanguage(e.target.value)}
                                        className="w-full bg-app-input border border-app-border rounded px-2 py-1 text-xs text-app-text"
                                    >
                                        <option>English</option>
                                        <option>Spanish</option>
                                        <option>French</option>
                                        <option>German</option>
                                        <option>Chinese</option>
                                        <option>Japanese</option>
                                    </select>
                                </div>
                                <button 
                                    onClick={() => onRunTool('data_table', { instructions: tableInstructions, language: tableLanguage })}
                                    disabled={toolLoadingState['data_table']}
                                    className="h-9 px-4 mt-4 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {toolLoadingState['data_table'] ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'GENERATE'}
                                </button>
                            </div>
                        </div>
                      )}
                   </div>

                   {[
                      { id: 'faq', label: 'FAQ', desc: 'Structured Q&A from content', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-amber-500' },
                      { id: 'study_guide', label: 'Study Guide', desc: 'Key terms and quiz', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z', color: 'text-blue-500' },
                      { id: 'timeline', label: 'Timeline', desc: 'Chronological events extraction', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-teal-500' },
                      { id: 'briefing', label: 'Briefing Doc', desc: 'Executive summary & risks', icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: 'text-purple-500' },
                   ].map(tool => (
                     <button
                       key={tool.id}
                       onClick={() => onRunTool(tool.id)}
                       disabled={toolLoadingState[tool.id]}
                       className="relative group bg-app-card hover:bg-app-text hover:text-app-bg border border-app-border rounded-xl p-3 flex items-center gap-3 text-left transition-all"
                     >
                         {toolLoadingState[tool.id] && (
                           <div className="absolute inset-0 bg-app-bg/50 flex items-center justify-center z-10 rounded-xl">
                              <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full"></div>
                           </div>
                         )}
                         <div className={`p-2.5 rounded-lg bg-app-panel border border-app-border group-hover:bg-app-bg transition-colors ${tool.color}`}>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tool.icon} /></svg>
                         </div>
                         <div>
                            <h4 className="text-sm font-bold">{tool.label}</h4>
                            <p className="text-[10px] opacity-70">{tool.desc}</p>
                         </div>
                     </button>
                   ))}
                </div>
              )}
           </div>
        )}
      </div>

      {!onlySourcesView && (
         <div className="pb-20"></div>
      )}

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        multiple 
        accept=".doc,.docx,.pdf,.txt,.md,.json,.sql,.html,.css,.js,.ts,.tsx,.csv,.xls,.xlsx,image/*,video/*,audio/*"
        onChange={handleInputChange} 
      />

      <CharacterLibraryModal 
        isOpen={isCharacterModalOpen}
        onClose={() => setIsCharacterModalOpen(false)}
        characters={characters}
        onAdd={(char) => onAddCharacter?.(char)}
        onDelete={(id) => onDeleteCharacter?.(id)}
      />

      <CastLibraryModal
        isOpen={isCastLibraryOpen}
        onClose={() => setIsCastLibraryOpen(false)}
        castLibrary={castLibrary}
        voiceSettings={voiceSettings}
        onResetVoiceSettings={() => {
          const { voiceSettings: nextVoiceSettings, touchedRoles: nextTouched } =
            buildStaggeredDefaultVoiceSettings(
              voiceSettings,
              castLibrary.length ? castLibrary : undefined,
              { shortSwedishLabels: true },
            );
          setEffectiveTouchedRoles(nextTouched);
          onUpdateVoiceSettings(nextVoiceSettings);
        }}
        onAssignRole={(role, member) => {
          const updates: Partial<VoiceSettings> = {};
          const memberKey = `${role}MemberId` as 'hostMemberId' | 'expertMemberId' | 'guestMemberId';
          const labelKey = `${role}Label` as 'hostLabel' | 'expertLabel' | 'guestLabel';
          const bioKey = `${role}Bio` as 'hostBio' | 'expertBio' | 'guestBio';
          const avatarKey = `${role}Avatar` as 'hostAvatar' | 'expertAvatar' | 'guestAvatar';
          const isAlreadyAssigned = effectiveTouchedRoles.includes(role) && voiceSettings[memberKey] === member.id;

          if (isAlreadyAssigned) {
            untouchRole(role);
            updates[memberKey] = undefined;
            updates[avatarKey] = undefined;
            updates[bioKey] = undefined;
          } else {
            touchRole(role);
            updates[role] = member.voice;
            updates[labelKey] = member.name;
            updates[bioKey] = member.bio;
            updates[avatarKey] = member.avatar;
            updates[memberKey] = member.id;
          }
          onUpdateVoiceSettings({ ...voiceSettings, ...updates });
        }}
        onAdd={(member) => onAddCastMember?.(member)}
        onUpdate={(id, updates) => onUpdateCastMember?.(id, updates)}
        onDelete={(id) => onDeleteCastMember?.(id)}
      />
    </div>
  );
};

export default MediaPanel;
