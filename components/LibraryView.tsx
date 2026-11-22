
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Session } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import SessionModal from './SessionModal';
import { TemplateManagerModal, getCustomTemplates, addCustomTemplate } from './TemplateManager';

interface LibraryViewProps {
  sessions: Session[];
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  onReorderSession: (sourceIndex: number, destIndex: number) => void;
  onCombineSessions?: (ids: string[], newName: string, description?: string) => void;
  onOpenSettings?: () => void;
  onOpenStudio?: () => void;
  onOpenOfficeTools?: () => void;
  onOpenMedia?: () => void;
  onOpenMIPrOMPT?: () => void;
  onOpenFinance?: () => void;
  onOpenMaggi?: () => void;
  /** Build a self-contained website from this session (no AI call needed). */
  onGenerateWebsite?: (id: string) => void;
}

const LibraryView: React.FC<LibraryViewProps> = ({ 
  sessions, 
  onSelectSession, 
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onReorderSession,
  onCombineSessions,
  onOpenSettings,
  onOpenStudio,
  onOpenOfficeTools,
  onOpenMedia,
  onOpenMIPrOMPT,
  onOpenFinance,
  onOpenMaggi,
  onGenerateWebsite
}) => {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'icon'>('grid');
  const [search, setSearch] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCombineModalOpen, setIsCombineModalOpen] = useState(false);
  
  // Template States
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [changeTemplateSession, setChangeTemplateSession] = useState<Session | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [customCategoryInput, setCustomCategoryInput] = useState('');

  useEffect(() => {
    setTemplates(getCustomTemplates());
    const handleUpdate = () => {
      setTemplates(getCustomTemplates());
    };
    window.addEventListener('aggrigator_templates_updated', handleUpdate);
    return () => {
      window.removeEventListener('aggrigator_templates_updated', handleUpdate);
    };
  }, []);

  const getNextSessionName = (category: string, sessionsList: Session[]): string => {
    let maxNum = 0;
    const prefix = `${category} `;
    sessionsList.forEach(s => {
      if (s.name && s.name.startsWith(prefix)) {
        const numPart = s.name.substring(prefix.length).trim();
        const num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    const nextNum = maxNum + 1;
    return `${category} ${nextNum.toString().padStart(3, '0')}`;
  };

  const handleSaveAsTemplate = (e: React.MouseEvent, sessionName: string) => {
    e.stopPropagation();
    // Clean up number suffixes like "Research 001" if present, or just use the name
    let cleanName = sessionName.trim();
    const regex = /\s\d{3,}$/; // Matches spaces followed by 3+ digits at the end
    if (regex.test(cleanName)) {
      cleanName = cleanName.replace(regex, '');
    }
    
    if (confirm(`Do you want to add "${cleanName}" as a new Category Template?`)) {
      const success = addCustomTemplate(cleanName);
      if (success) {
        alert(`Successfully added "${cleanName}" as a template category!`);
      } else {
        alert(`"${cleanName}" is already a template category.`);
      }
    }
  };

  const handleChangeSessionTemplate = (session: Session, newTemplateCategory: string) => {
    const newName = getNextSessionName(newTemplateCategory, sessions);
    onRenameSession(session.id, newName);
    setChangeTemplateSession(null);
  };
  
  // Drag and Drop State
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

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

  const handleBatchDelete = () => {
    if (selectedSessionIds.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedSessionIds.size} sessions?`)) {
      selectedSessionIds.forEach(id => onDeleteSession(id));
      setSelectedSessionIds(new Set());
    }
  };

  const handleClearEmptySessions = () => {
    const emptySessionIds = sessions.filter(s => s.mediaItems.length === 0 && s.history.length === 0).map(s => s.id);
    if (emptySessionIds.length === 0) {
        alert("No empty sessions found.");
        return;
    }
    if (confirm(`Found ${emptySessionIds.length} empty sessions. Delete them?`)) {
        emptySessionIds.forEach(id => onDeleteSession(id));
    }
  };

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.history.some(m => m.content.toLowerCase().includes(q))
    );
  }, [sessions, search]);

  const getSessionGradient = (id: string) => {
    const gradients = [
      'from-blue-500/20 to-cyan-500/5',
      'from-purple-500/20 to-pink-500/5',
      'from-emerald-500/20 to-teal-500/5',
      'from-amber-500/20 to-orange-500/5',
      'from-rose-500/20 to-red-500/5',
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) { hash = id.charCodeAt(i) + ((hash << 5) - hash); }
    return gradients[Math.abs(hash) % gradients.length];
  };

  const handleStartRename = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditName(session.name);
  };

  const handleDownloadSessionTxt = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    let txt = `Session: ${session.name}\n`;
    txt += `Created: ${new Date(session.createdAt).toLocaleString()}\n\n`;
    if (session.description) {
        txt += `Description: ${session.description}\n\n`;
    }
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

  const handleSaveRename = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingSessionId && editName.trim()) {
      onRenameSession(editingSessionId, editName.trim());
    }
    setEditingSessionId(null);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, position: number) => {
    dragItem.current = position;
    // Set transparent image or effect
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, position: number) => {
    e.preventDefault();
    dragOverItem.current = position;
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = "1";
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
        onReorderSession(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  return (
    <div className="flex flex-col h-full w-full bg-app-bg text-app-text overflow-y-auto animate-fade-in p-6 md:p-10">
      
      {/* Header */}
      <div className="max-w-7xl w-full mx-auto mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-app-text to-blue-500 mb-1">
              {t('library.title')}
            </h1>
            <p className="text-app-dim text-xs">
              {sessions.length} {t('library.sessionsStored')}
            </p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
            {selectedSessionIds.size > 0 && (
                <>
                {selectedSessionIds.size > 1 && onCombineSessions && (
                    <button 
                        onClick={() => setIsCombineModalOpen(true)}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
                        </svg>
                        Combine ({selectedSessionIds.size})
                    </button>
                )}
                <button 
                    onClick={handleBatchDelete}
                    className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {t('library.delete')} ({selectedSessionIds.size})
                </button>
                </>
            )}
            <button 
                onClick={handleClearEmptySessions}
                className="p-2 bg-app-panel hover:bg-app-card border border-app-border rounded-lg text-app-dim hover:text-app-text transition-all hover:scale-105 active:scale-95 shadow-sm flex items-center justify-center"
                title={t('library.clearEmpty')}
            >
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.895-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
            <button 
                onClick={() => setIsTemplateManagerOpen(true)}
                className="p-2 bg-app-panel hover:bg-app-card border border-app-border rounded-lg text-app-dim hover:text-app-text transition-all hover:scale-105 active:scale-95 shadow-sm flex items-center justify-center"
                title="Manage Category Templates"
            >
                <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
            </button>
            <div className="flex items-center gap-1 p-1 bg-app-panel border border-app-border rounded-lg mr-1 hidden sm:flex">
               <button
                  onClick={() => setViewMode(prev => prev === 'grid' ? 'list' : prev === 'list' ? 'icon' : 'grid')}
                  className="p-1.5 rounded-md transition-colors bg-app-card text-app-text shadow-sm hover:bg-app-card/80"
                  title="Toggle View Mode"
               >
                  {viewMode === 'list' ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                  ) : viewMode === 'grid' ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                  ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM10 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM16 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
                      </svg>
                  )}
               </button>
            </div>
            <div className="relative flex-1 md:w-80 group">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-app-dim group-focus-within:text-app-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input 
                type="text" 
                placeholder={t('library.search')} 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-app-panel border border-app-border rounded-lg pl-9 pr-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-text/50 focus:border-transparent transition-all shadow-sm"
                />
            </div>
            {onOpenStudio && (
                <button 
                    onClick={onOpenStudio}
                    className="p-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg transition-all shadow-lg shadow-purple-500/20 flex items-center justify-center"
                    title={t('nav.studio')}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                    </svg>
                </button>
            )}
            {onOpenMedia && (
                <button 
                    onClick={onOpenMedia}
                    className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-lg transition-all shadow-lg shadow-orange-500/20"
                    title="Media Suite"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </button>
            )}
            {onOpenFinance && (
                <button 
                    onClick={onOpenFinance}
                    className="p-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center"
                    title="Finance Terminal"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </button>
            )}
            {onOpenOfficeTools && (
                <button 
                    onClick={onOpenOfficeTools}
                    className="p-2 bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-500 hover:to-blue-500 text-white rounded-lg transition-all shadow-lg shadow-teal-500/20 flex items-center justify-center"
                    title="Office Tools"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                </button>
            )}
            {onOpenMaggi && (
                <button
                    onClick={onOpenMaggi}
                    className="p-2 bg-gradient-to-r from-lime-500 to-emerald-600 hover:from-lime-400 hover:to-emerald-500 text-black rounded-lg transition-all shadow-lg shadow-emerald-500/30 flex items-center justify-center font-black text-xs"
                    title="MAGGI — RAG research engine"
                >
                    🧠
                </button>
            )}
            {onOpenSettings && (
                <button 
                    onClick={onOpenSettings}
                    className="p-2 bg-app-panel hover:bg-app-card border border-app-border rounded-lg text-app-dim hover:text-app-text transition-colors"
                    title={t('nav.settings')}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                    </svg>
                </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid / List */}
      <div className={`max-w-7xl w-full mx-auto ${viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4' : viewMode === 'icon' ? 'grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-4' : 'flex flex-col gap-3'}`}>
        
        {/* Create New Card */}
        <button 
          onClick={onCreateSession}
          className={`flex ${viewMode === 'grid' ? 'flex-col justify-center min-h-[160px]' : viewMode === 'icon' ? 'flex-col items-center justify-center min-h-[80px]' : 'flex-row items-center min-h-[80px] px-6'} p-4 rounded-xl border-2 border-dashed border-app-border hover:border-app-text hover:bg-app-panel/50 transition-all group`}
        >
          <div className={`w-10 h-10 rounded-full bg-app-panel border border-app-border flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg group-hover:shadow-app-text/20 ${viewMode === 'grid' || viewMode === 'icon' ? 'mb-3' : 'mr-4'}`}>
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
             </svg>
          </div>
          {viewMode !== 'icon' && <span className="font-bold text-sm text-green-500">{t('library.newSession')}</span>}
        </button>

        {/* Session Cards */}
        {filteredSessions.map((session, index) => {
          return (
            <div 
              key={session.id}
              draggable={!search.trim()} // Only draggable if not searching
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => onSelectSession(session.id)}
              className={`relative flex ${viewMode === 'grid' ? 'flex-col min-h-[160px]' : viewMode === 'icon' ? 'flex-col items-center justify-center min-h-[80px] aspect-square p-2' : 'flex-row items-center min-h-[80px] p-4'} rounded-xl border border-app-border hover:border-app-text/50 bg-gradient-to-br ${getSessionGradient(session.id)} hover:shadow-lg transition-all cursor-pointer group active:scale-95`}
            >
              <div className={`flex ${viewMode === 'grid' ? 'justify-between items-start mb-2 w-full' : viewMode === 'icon' ? 'absolute top-1 left-1 right-1 justify-between' : 'items-center mr-4 w-auto'}`}>
                 <div className="flex items-center gap-2">
                     <div 
                        onClick={(e) => { e.stopPropagation(); toggleSessionSelection(session.id); }}
                        className={`w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-colors ${selectedSessionIds.has(session.id) ? 'bg-blue-500 border-blue-500 text-white' : 'bg-app-bg/60 border-app-border/50 hover:border-app-text/50'}`}
                     >
                        {selectedSessionIds.has(session.id) && <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                     </div>
                 </div>
                 {(viewMode === 'grid' || viewMode === 'icon') && (
                 <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${viewMode === 'icon' ? 'bg-black/40 rounded-md backdrop-blur-sm flex-wrap justify-end' : ''}`}>
                    {onGenerateWebsite && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onGenerateWebsite(session.id); }}
                        className={`p-1.5 text-app-dim hover:text-sky-400 hover:bg-sky-500/20 rounded-md transition-colors`}
                        title="Turn session into a website (offline, no AI)"
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
                        </svg>
                    </button>
                    )}
                    <button 
                        onClick={(e) => handleStartRename(e, session)}
                        className={`p-1.5 text-green-500 hover:text-green-500 hover:bg-green-500/20 rounded-md transition-colors ${viewMode === 'grid' ? 'text-app-dim hover:text-app-text hover:bg-app-bg/80' : ''}`}
                        title="Rename"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => handleSaveAsTemplate(e, session.name)}
                        className={`p-1.5 text-green-500 hover:text-purple-300 hover:bg-green-500/20 rounded-md transition-colors ${viewMode === 'grid' ? 'text-app-dim hover:text-purple-400 hover:bg-app-bg/80' : ''}`}
                        title="Save Name as Template"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setChangeTemplateSession(session); }}
                        className={`p-1.5 text-green-500 hover:text-blue-300 hover:bg-green-500/20 rounded-md transition-colors ${viewMode === 'grid' ? 'text-app-dim hover:text-blue-400 hover:bg-app-bg/80' : ''}`}
                        title="Change Category Template"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => handleDownloadSessionTxt(e, session)}
                        className={`p-1.5 text-green-500 hover:text-emerald-300 hover:bg-green-500/20 rounded-md transition-colors ${viewMode === 'grid' ? 'text-app-dim hover:text-emerald-500 hover:bg-app-bg/80' : ''}`}
                        title="Save to TXT"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                        className={`p-1.5 text-green-500 hover:text-red-400 hover:bg-green-500/20 rounded-md transition-colors ${viewMode === 'grid' ? 'text-app-dim hover:text-red-500 hover:bg-app-bg/80' : ''}`}
                        title="Delete Session"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                 </div>
                 )}
              </div>

              <div className={`flex-1 ${viewMode === 'list' ? 'flex items-center gap-6 justify-between overflow-hidden' : viewMode === 'icon' ? 'flex flex-col items-center justify-center w-full h-full mt-2' : 'flex flex-col'}`}>
                  {editingSessionId === session.id ? (
                      <form onSubmit={handleSaveRename} onClick={(e) => e.stopPropagation()} className={viewMode === 'grid' ? "mb-2" : viewMode === 'icon' ? "w-full" : "flex-1 mr-4"}>
                      <input 
                          type="text" 
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => handleSaveRename()}
                          autoFocus
                          className={`w-full bg-app-input/80 border border-app-text rounded px-1 py-0.5 text-sm text-app-text focus:outline-none ${viewMode === 'icon' ? 'text-center' : ''}`}
                      />
                  </form>
              ) : (
                  <h3 className={`text-sm font-bold text-green-500 truncate leading-tight drop-shadow-md ${viewMode === 'grid' ? 'mb-2' : viewMode === 'icon' ? 'm-0 text-center text-xs max-w-full' : 'flex-1 m-0 text-base max-w-[200px] sm:max-w-md'}`} title={session.name}>{session.name}</h3>
              )}
              
              {viewMode !== 'icon' && (
              <div className={`mt-auto pt-2 border-t border-green-500/20 flex justify-between items-center text-[10px] text-green-500/80 font-medium ${viewMode === 'list' ? 'border-none pt-0 ml-auto gap-4' : ''}`}>
                 <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                 <span className="bg-black/20 px-1.5 py-0.5 rounded border border-green-500/10 backdrop-blur-sm shadow-sm">{session.mediaItems.length} items</span>
              </div>
              )}
              </div>
              
              {viewMode === 'list' && (
                 <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity ml-4 pl-4 border-l border-app-border/40">
                    {onGenerateWebsite && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onGenerateWebsite(session.id); }}
                        className="p-1.5 text-app-dim hover:text-sky-400 hover:bg-sky-500/20 rounded-md transition-colors"
                        title="Turn session into a website (offline, no AI)"
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="12" r="9" />
                            <path strokeLinecap="round" d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
                        </svg>
                    </button>
                    )}
                    <button 
                        onClick={(e) => handleStartRename(e, session)}
                        className="p-1.5 text-app-dim hover:text-app-text hover:bg-app-bg/80 rounded-md transition-colors"
                        title="Rename"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => handleSaveAsTemplate(e, session.name)}
                        className="p-1.5 text-app-dim hover:text-purple-400 hover:bg-app-bg/80 rounded-md transition-colors"
                        title="Save Name as Template"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setChangeTemplateSession(session); }}
                        className="p-1.5 text-app-dim hover:text-blue-400 hover:bg-app-bg/80 rounded-md transition-colors"
                        title="Change Category Template"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => handleDownloadSessionTxt(e, session)}
                        className="p-1.5 text-app-dim hover:text-emerald-500 hover:bg-app-bg/80 rounded-md transition-colors"
                        title="Save to TXT"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                        className="p-1.5 text-app-dim hover:text-red-500 hover:bg-app-bg/80 rounded-md transition-colors"
                        title="Delete Session"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                 </div>
              )}
            </div>
          );
        })}
      </div>

      {isCombineModalOpen && (
        <SessionModal
          isOpen={isCombineModalOpen}
          onClose={() => setIsCombineModalOpen(false)}
          defaultValue="Combined Session"
          sessions={sessions}
          onCreate={(name, description) => {
            if (onCombineSessions) {
              onCombineSessions(Array.from(selectedSessionIds), name, description);
              setSelectedSessionIds(new Set());
              setIsCombineModalOpen(false);
            }
          }}
        />
      )}

      {/* Template Manager Modal */}
      <TemplateManagerModal 
        isOpen={isTemplateManagerOpen}
        onClose={() => setIsTemplateManagerOpen(false)}
      />

      {/* Change Session Category Template Overlay */}
      {changeTemplateSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => { setChangeTemplateSession(null); setCustomCategoryInput(''); }}>
          <div className="bg-app-card border border-app-border rounded-xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-pulse-fast-once" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-bold text-app-text">Change Category Template</h3>
              <p className="text-app-dim text-xs mt-1">
                Select a category template to rename and re-number session <span className="font-semibold text-app-text">"{changeTemplateSession.name}"</span>.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-app-dim uppercase tracking-wider">
                Select Category
              </label>
              {templates.length === 0 ? (
                <div className="text-sm text-app-muted py-2">
                  No templates available. Create templates first or import them.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 max-h-[140px] overflow-y-auto custom-scrollbar pr-1">
                  {templates.map(category => (
                    <button
                      key={category}
                      onClick={() => {
                        handleChangeSessionTemplate(changeTemplateSession, category);
                        setCustomCategoryInput('');
                      }}
                      className="w-full text-left px-4 py-2 bg-app-panel hover:bg-blue-600 hover:text-white text-app-text rounded-lg text-sm font-medium transition-all"
                    >
                      {category}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-app-border/40">
              <label className="block text-xs font-semibold text-app-dim uppercase tracking-wider">
                Custom Assignment
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customCategoryInput}
                  onChange={(e) => setCustomCategoryInput(e.target.value)}
                  placeholder="Enter custom category..."
                  className="flex-1 bg-app-input border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    const trimmed = customCategoryInput.trim();
                    if (trimmed && changeTemplateSession) {
                      addCustomTemplate(trimmed);
                      handleChangeSessionTemplate(changeTemplateSession, trimmed);
                      setCustomCategoryInput('');
                    }
                  }}
                  disabled={!customCategoryInput.trim()}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
                >
                  Assign
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-app-border/40">
              <button
                onClick={() => { setChangeTemplateSession(null); setCustomCategoryInput(''); }}
                className="px-4 py-2 bg-app-panel hover:bg-app-card border border-app-border rounded-lg text-app-text text-xs font-semibold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryView;
