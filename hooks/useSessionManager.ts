
import { useState, useEffect } from 'react';
import { Session, MediaItem, Message } from '../types';
import { loadSessionsFromDB, saveSessionsToDB } from '../services/storage';
// @ts-ignore
import * as mammoth from 'mammoth';
// @ts-ignore
import * as XLSX from 'xlsx';

const STORAGE_KEY = 'gemini_media_aggregator_sessions';

export const useSessionManager = () => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isStorageInitialized, setIsStorageInitialized] = useState(false);

    const activeSession = sessions.find(s => s.id === activeSessionId) || null;

    // Load and Migrate Data
    useEffect(() => {
        const init = async () => {
          try {
            let loadedSessions = await loadSessionsFromDB();
            
            // Migration: Check LocalStorage if DB is empty
            if (loadedSessions.length === 0) {
              const legacyData = localStorage.getItem(STORAGE_KEY);
              if (legacyData) {
                console.log("Migrating data from LocalStorage to IndexedDB...");
                try {
                  const parsedLegacy = JSON.parse(legacyData);
                  if (Array.isArray(parsedLegacy)) {
                    loadedSessions = parsedLegacy;
                    await saveSessionsToDB(loadedSessions);
                    localStorage.removeItem(STORAGE_KEY);
                  }
                } catch (err) {
                  console.error("Migration failed:", err);
                }
              }
            }
    
            if (loadedSessions.length > 0) {
              // Rehydrate Date objects & Sort
              // Fix: Cast s and m to any to avoid "Spread types may only be created from object types" error
              const rehydrated = loadedSessions.map((s: any) => ({
                ...s,
                selectedMediaIds: s.selectedMediaIds || (s.mediaItems ? s.mediaItems.map((m: any) => m.id) : []),
                history: (s.history || []).map((m: any) => ({
                  ...m,
                  timestamp: new Date(m.timestamp)
                }))
              }));

              // Sort by Order field if available, else by CreatedAt descending
              const sorted = rehydrated.sort((a, b) => {
                  const orderA = a.order !== undefined ? a.order : Number.MAX_SAFE_INTEGER;
                  const orderB = b.order !== undefined ? b.order : Number.MAX_SAFE_INTEGER;
                  
                  if (orderA !== orderB) return orderA - orderB;
                  return b.createdAt - a.createdAt;
              });

              // Filter out empty sessions (no media, no history) on load, unless it's the only one
              const nonEmptySessions = sorted.filter((s: any) => s.mediaItems.length > 0 || s.history.length > 0);
              
              if (nonEmptySessions.length > 0) {
                  setSessions(nonEmptySessions);
                  setActiveSessionId(nonEmptySessions[0].id);
              } else {
                  // If all were empty, or none existed, start fresh
                  createDefaultSession();
              }
            } else {
              // No sessions found, create ONLY ONE default session
              createDefaultSession();
            }
          } catch (e) {
            console.error("Failed to load data:", e);
            createDefaultSession();
          } finally {
            setIsStorageInitialized(true);
          }
        };
        
        init();
    }, []);

    const createDefaultSession = () => {
        const newSession: Session = {
            id: Date.now().toString(),
            name: "Session 1",
            mediaItems: [],
            selectedMediaIds: [],
            history: [],
            suggestions: [],
            createdAt: Date.now(),
            order: 0
        };
        // Ensure we start fresh if this is called
        setSessions([newSession]);
        setActiveSessionId(newSession.id);
        // Also clear DB to match state
        saveSessionsToDB([newSession]).catch(console.error);
    };

    // Save changes
    useEffect(() => {
        if (isStorageInitialized && sessions.length > 0) {
          saveSessionsToDB(sessions).catch(e => console.error("Failed to save to DB:", e));
        }
    }, [sessions, isStorageInitialized]);

    const createNewSession = (name: string, description?: string) => {
        const newSession: Session = {
          id: Date.now().toString(),
          name: name,
          description: description,
          mediaItems: [],
          selectedMediaIds: [],
          history: [],
          suggestions: [],
          createdAt: Date.now(),
          // Put new session at start (order 0), shift others down later if needed, 
          // or just simple unshift. When reordering happens, indices get normalized.
          order: -1 // Temporarily -1 to ensure it sorts to top, we re-normalize below
        };
        
        setSessions(prev => {
            const updated = [newSession, ...prev];
            // Normalize orders
            // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
            return updated.map((s: any, idx) => ({ ...s, order: idx }));
        });
        
        setActiveSessionId(newSession.id);
        return newSession;
    };
    
    const deleteSession = (id: string) => {
        const newSessions = sessions.filter(s => s.id !== id);
        setSessions(newSessions);
        
        if (activeSessionId === id) {
          if (newSessions.length > 0) {
            setActiveSessionId(newSessions[0].id);
          } else {
            createNewSession("Session 1");
          }
        }
    };
    
    const renameSession = (id: string, newName: string) => {
        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => s.id === id ? { ...s, name: newName } : s));
    };

    const updateSessionDescription = (id: string, description: string) => {
        setSessions(prev => prev.map((s: any) => s.id === id ? { ...s, description } : s));
    };

    const combineSessions = (sessionIds: string[], newName: string, description?: string) => {
        if (sessionIds.length < 2) return null;
        
        const sessionsToCombine = sessions.filter(s => sessionIds.includes(s.id));
        if (sessionsToCombine.length === 0) return null;

        // Sort by creation date to keep history chronological
        sessionsToCombine.sort((a, b) => a.createdAt - b.createdAt);

        const combinedMediaItems: MediaItem[] = [];
        const combinedHistory: Message[] = [];
        const combinedSelectedMediaIds: string[] = [];

        sessionsToCombine.forEach(s => {
            s.mediaItems.forEach(item => {
                if (!combinedMediaItems.some(existing => existing.id === item.id)) {
                    combinedMediaItems.push(item);
                }
            });
            s.selectedMediaIds.forEach(id => {
                if (!combinedSelectedMediaIds.includes(id)) {
                    combinedSelectedMediaIds.push(id);
                }
            });
            combinedHistory.push(...s.history);
        });

        // Sort combined history by timestamp
        combinedHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const newSession: Session = {
            id: Date.now().toString(),
            name: newName,
            description: description,
            mediaItems: combinedMediaItems,
            selectedMediaIds: combinedSelectedMediaIds,
            history: combinedHistory,
            suggestions: [],
            createdAt: Date.now(),
            order: 0
        };

        setSessions(prev => {
            const updated = [newSession, ...prev];
            return updated.map((s: any, idx) => ({ ...s, order: idx }));
        });
        
        setActiveSessionId(newSession.id);
        return newSession;
    };

    const reorderSessions = (sourceIndex: number, destinationIndex: number) => {
        setSessions(prev => {
            const result = Array.from(prev);
            const [removed] = result.splice(sourceIndex, 1);
            if (removed) {
                result.splice(destinationIndex, 0, removed);
                // Update order property to persist this state
                // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread at line 150
                return result.map((s: any, index) => ({ ...s, order: index }));
            }
            return prev;
        });
    };

    const updateActiveSession = (updater: (s: Session) => Session) => {
        if (!activeSessionId) return;
        setSessions(prev => prev.map(s => s.id === activeSessionId ? updater(s) : s));
    };

    const updateSessionById = (id: string, updater: (s: Session) => Session) => {
        setSessions(prev => prev.map(s => s.id === id ? updater(s) : s));
    };

    const clearSessionHistory = (id: string) => {
        updateSessionById(id, s => ({ ...s, history: [] }));
    };

    const handleExportSession = (sessionId: string, format: 'json' | 'md') => {
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return;
    
        if (format === 'json') {
          const dataStr = JSON.stringify(session, null, 2);
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_session.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else if (format === 'md') {
          let md = `# Session: ${session.name}\n`;
          md += `Date: ${new Date(session.createdAt).toLocaleString()}\n\n`;
          md += `## Media Sources\n`;
          session.mediaItems.forEach(item => {
            md += `- ${item.name} (${item.type})\n`;
          });
          md += `\n## Chat History\n\n`;
          session.history.forEach(msg => {
            md += `### ${msg.role.toUpperCase()} - ${new Date(msg.timestamp).toLocaleTimeString()}\n`;
            md += `${msg.content}\n\n`;
          });
    
          const blob = new Blob([md], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_chat.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
    };

    const readFile = (file: File): Promise<MediaItem> => {
        return new Promise((resolve, reject) => {
          const isImage = file.type.startsWith('image/');
          const isVideo = file.type.startsWith('video/');
          const isAudio = file.type.startsWith('audio/');
          const isPdf = file.type === 'application/pdf';
          const isText = file.type.startsWith('text/') || 
                         file.name.endsWith('.json') || 
                         file.name.endsWith('.md') || 
                         file.name.endsWith('.ts') || 
                         file.name.endsWith('.tsx') || 
                         file.name.endsWith('.js');
          
          const isSql = file.name.endsWith('.sql');
          const isWord = file.name.endsWith('.docx') || file.name.endsWith('.doc'); 
          const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

          if (!isImage && !isText && !isVideo && !isPdf && !isAudio && !isSql && !isWord && !isExcel) {
            reject(new Error("Unsupported file type"));
            return;
          }

          // Special handling for Office Files (Extract Text)
          if (isWord) {
             const reader = new FileReader();
             reader.onload = async (e) => {
               try {
                 const arrayBuffer = e.target?.result as ArrayBuffer;
                 // Use Mammoth to extract raw text
                 const result = await mammoth.extractRawText({ arrayBuffer });
                 const text = result.value;
                 // Encode text to base64 to store consistently
                 const b64 = btoa(unescape(encodeURIComponent(text)));
                 
                 resolve({
                   id: Math.random().toString(36).substring(7),
                   name: file.name,
                   mimeType: 'text/plain', // Treated as text for API
                   data: b64,
                   type: 'document'
                 });
               } catch (err) {
                 if (file.name.toLowerCase().endsWith('.doc')) {
                     // Graceful fallback for older binary .doc files which mammoth doesn't support
                     resolve({
                        id: Math.random().toString(36).substring(7),
                        name: file.name,
                        mimeType: 'text/plain',
                        data: btoa("⚠️ Error: Legacy .doc file format detected. This format is binary and cannot be read directly by the browser.\n\nPlease convert this file to .docx (Word 2007+) and upload again."),
                        type: 'text' // Treat as text to display the error message
                     });
                 } else {
                     reject(new Error("Failed to parse Word document"));
                 }
               }
             };
             reader.readAsArrayBuffer(file);
             return;
          }

          if (isExcel) {
             const reader = new FileReader();
             reader.onload = (e) => {
               try {
                 const data = new Uint8Array(e.target?.result as ArrayBuffer);
                 const workbook = XLSX.read(data, { type: 'array' });
                 const firstSheetName = workbook.SheetNames[0];
                 const worksheet = workbook.Sheets[firstSheetName];
                 // Convert to CSV for text representation
                 const csv = XLSX.utils.sheet_to_csv(worksheet);
                 
                 const b64 = btoa(unescape(encodeURIComponent(csv)));
                 
                 resolve({
                    id: Math.random().toString(36).substring(7),
                    name: file.name,
                    mimeType: 'text/plain',
                    data: b64,
                    type: 'document'
                 });
               } catch (err) {
                 reject(new Error("Failed to parse Excel file"));
               }
             };
             reader.readAsArrayBuffer(file);
             return;
          }
    
          // Standard handling for natively supported types
          const reader = new FileReader();
          reader.onload = () => {
            let content = reader.result as string;
            if (content.includes(',')) {
               content = content.split(',')[1];
            }
            
            let type: MediaItem['type'] = 'text';
            if (isImage) type = 'image';
            if (isVideo) type = 'video';
            if (isPdf) type = 'pdf';
            if (isAudio) type = 'audio';
            if (isSql) type = 'sql';
    
            resolve({
              id: Math.random().toString(36).substring(7),
              name: file.name,
              mimeType: file.type || (isPdf ? 'application/pdf' : (isSql ? 'application/sql' : 'application/octet-stream')),
              data: content,
              type: type
            });
          };
          
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
    };

    const processUploadedFiles = async (files: File[]) => {
        // Use active session if available, otherwise use the first session, or create one if empty
        let targetId = activeSessionId;
        
        if (!targetId) {
            if (sessions.length > 0) {
                targetId = sessions[0].id;
                setActiveSessionId(targetId);
            } else {
                const newS = createNewSession("Session 1");
                targetId = newS.id;
            }
        }

        const newItems: MediaItem[] = [];
        for (let i = 0; i < files.length; i++) {
          try {
            // Check for saxmulti.txt for batch link import
            if (files[i].name.toLowerCase() === 'saxmulti.txt') {
                const text = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsText(files[i]);
                });
                
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                
                lines.forEach(line => {
                    if (line.startsWith('http://') || line.startsWith('https://')) {
                         newItems.push({
                            id: Math.random().toString(36).substring(7),
                            name: line,
                            mimeType: 'text/uri-list',
                            data: line,
                            type: 'link'
                         });
                    }
                });
                continue; // Processed as batch links, skip standard file read
            }

            const item = await readFile(files[i]);
            newItems.push(item);
          } catch (err) {
            console.error("Skipped file", err);
          }
        }
        
        const newItemIds = newItems.map(i => i.id);
  
        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => {
          if (s.id === targetId) {
            return { 
              ...s, 
              mediaItems: [...s.mediaItems, ...newItems],
              selectedMediaIds: [...(s.selectedMediaIds || []), ...newItemIds]
            };
          }
          return s;
        }));

        const currentSession = sessions.find(s => s.id === targetId);
        const existingMedia = currentSession ? currentSession.mediaItems : [];
        return { targetId, combinedMedia: [...existingMedia, ...newItems], newItems };
    };

    const addTextItem = (title: string, content: string) => {
        let targetId = activeSessionId;
        if (!targetId) {
            if (sessions.length > 0) {
                targetId = sessions[0].id;
                setActiveSessionId(targetId);
            } else {
                const newS = createNewSession("Session 1");
                targetId = newS.id;
            }
        }

        const b64 = btoa(unescape(encodeURIComponent(content)));
        const newItem: MediaItem = {
            id: Math.random().toString(36).substring(7),
            name: title,
            mimeType: 'text/plain',
            data: b64,
            type: 'text'
        };

        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => {
            if (s.id === targetId) {
                return {
                    ...s,
                    mediaItems: [...s.mediaItems, newItem],
                    selectedMediaIds: [...(s.selectedMediaIds || []), newItem.id]
                };
            }
            return s;
        }));
        
        const currentSession = sessions.find(s => s.id === targetId);
        const existingMedia = currentSession ? currentSession.mediaItems : [];
        return { targetId, combinedMedia: [...existingMedia, newItem], newItems: [newItem] };
    };

    const addHtmlItem = (title: string, content: string) => {
        let targetId = activeSessionId;
        if (!targetId) {
            if (sessions.length > 0) {
                targetId = sessions[0].id;
                setActiveSessionId(targetId);
            } else {
                const newS = createNewSession("Session 1");
                targetId = newS.id;
            }
        }

        const b64 = btoa(unescape(encodeURIComponent(content)));
        const newItem: MediaItem = {
            id: Math.random().toString(36).substring(7),
            name: title,
            mimeType: 'text/html',
            data: b64,
            type: 'html'
        };

        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => {
            if (s.id === targetId) {
                return {
                    ...s,
                    mediaItems: [...s.mediaItems, newItem],
                    selectedMediaIds: [...(s.selectedMediaIds || []), newItem.id]
                };
            }
            return s;
        }));
        
        const currentSession = sessions.find(s => s.id === targetId);
        const existingMedia = currentSession ? currentSession.mediaItems : [];
        return { targetId, combinedMedia: [...existingMedia, newItem], newItems: [newItem] };
    };

    /**
     * Save a generated session website back into a specific session as an
     * HTML source (`Website: …`). Replaces the previous website source with
     * the same name instead of stacking duplicates, and deliberately does
     * NOT add it to selectedMediaIds so the next website generation does
     * not nest the previous page inside itself.
     */
    const saveSessionWebsite = (sessionId: string, title: string, html: string) => {
        const b64 = btoa(unescape(encodeURIComponent(html)));
        const newItem: MediaItem = {
            id: Math.random().toString(36).substring(7),
            name: title,
            mimeType: 'text/html',
            data: b64,
            type: 'html'
        };

        setSessions(prev => prev.map((s: any) => {
            if (s.id !== sessionId) return s;
            const existing = s.mediaItems.find((m: MediaItem) => m.type === 'html' && m.name === title);
            if (existing) {
                return {
                    ...s,
                    mediaItems: s.mediaItems.map((m: MediaItem) =>
                        m.id === existing.id ? { ...m, mimeType: 'text/html', data: b64 } : m
                    )
                };
            }
            return { ...s, mediaItems: [...s.mediaItems, newItem] };
        }));

        return { targetId: sessionId, newItem };
    };

    const handleAddLink = (url: string) => {
        let targetId = activeSessionId;
        if (!targetId) {
            if (sessions.length > 0) {
                targetId = sessions[0].id;
                setActiveSessionId(targetId);
            } else {
                const newS = createNewSession("Session 1");
                targetId = newS.id;
            }
        }
    
        const linkItem: MediaItem = {
          id: Math.random().toString(36).substring(7),
          name: url,
          mimeType: 'text/uri-list',
          data: url,
          type: 'link'
        };
    
        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => {
          if (s.id === targetId) {
            return { 
              ...s, 
              mediaItems: [...s.mediaItems, linkItem],
              selectedMediaIds: [...(s.selectedMediaIds || []), linkItem.id]
            };
          }
          return s;
        }));

        const currentSession = sessions.find(s => s.id === targetId);
        const existingMedia = currentSession ? currentSession.mediaItems : [];
        return { targetId, combinedMedia: [...existingMedia, linkItem], newItems: [linkItem] };
    };

    const batchAddLinks = (links: {title: string, uri: string}[]) => {
        if (links.length === 0) return null;
        
        let targetId = activeSessionId;
        if (!targetId) {
            if (sessions.length > 0) {
                targetId = sessions[0].id;
                setActiveSessionId(targetId);
            } else {
                const newS = createNewSession("Session 1");
                targetId = newS.id;
            }
        }

        const newItems: MediaItem[] = links.map(l => ({
            id: Math.random().toString(36).substring(7),
            name: l.title || l.uri,
            mimeType: 'text/uri-list',
            data: l.uri,
            type: 'link'
        }));

        const newItemIds = newItems.map(i => i.id);

        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => {
          if (s.id === targetId) {
            return { 
              ...s, 
              mediaItems: [...s.mediaItems, ...newItems],
              selectedMediaIds: [...(s.selectedMediaIds || []), ...newItemIds]
            };
          }
          return s;
        }));

        const currentSession = sessions.find(s => s.id === targetId);
        const existingMedia = currentSession ? currentSession.mediaItems : [];
        return { targetId, combinedMedia: [...existingMedia, ...newItems], newItems };
    };

    const handleRemoveMedia = (mediaId: string) => {
        if (!activeSession) return null;
        const targetSessionId = activeSession.id;
        
        const updatedMedia = activeSession.mediaItems.filter(item => item.id !== mediaId);
        const updatedSelection = activeSession.selectedMediaIds.filter(id => id !== mediaId);
    
        updateSessionById(targetSessionId, s => ({ 
          ...s, 
          mediaItems: updatedMedia,
          selectedMediaIds: updatedSelection
        }));
        
        return { targetId: targetSessionId, updatedMedia };
    };

    const handleToggleMedia = (mediaId: string) => {
        if (!activeSession) return null;
        const isSelected = activeSession.selectedMediaIds.includes(mediaId);
        const newSelection = isSelected 
          ? activeSession.selectedMediaIds.filter(id => id !== mediaId)
          : [...activeSession.selectedMediaIds, mediaId];
    
        updateActiveSession(s => ({ ...s, selectedMediaIds: newSelection }));
    
        const activeItems = activeSession.mediaItems.filter(item => newSelection.includes(item.id));
        return { targetId: activeSession.id, activeItems };
    };
    
    const handleToggleAllMedia = (selectAll: boolean) => {
        if (!activeSession) return null;
        const newSelection = selectAll 
          ? activeSession.mediaItems.map(item => item.id)
          : [];
        
        updateActiveSession(s => ({ ...s, selectedMediaIds: newSelection }));
    
        const activeItems = activeSession.mediaItems.filter(item => newSelection.includes(item.id));
        return { targetId: activeSession.id, activeItems };
    };

    const combineMediaItems = (ids: string[], newName: string) => {
        if (!activeSession || ids.length < 2) return null;
        
        const itemsToCombine = activeSession.mediaItems.filter(item => ids.includes(item.id));
        if (itemsToCombine.length === 0) return null;

        // Sort items by their order in the mediaItems array to maintain sequence
        const sortedItems = itemsToCombine.sort((a, b) => {
            const indexA = activeSession.mediaItems.findIndex(i => i.id === a.id);
            const indexB = activeSession.mediaItems.findIndex(i => i.id === b.id);
            return indexA - indexB;
        });

        let combinedContent = '';
        
        sortedItems.forEach((item, index) => {
            let text = '';
            try {
                if (item.type === 'text' || item.type === 'document' || item.type === 'sql') {
                    text = decodeURIComponent(escape(atob(item.data)));
                } else if (item.type === 'link') {
                    text = item.data;
                } else {
                    text = `[${item.type}: ${item.name}]`;
                }
            } catch (e) {
                text = `[Error decoding ${item.name}]`;
            }
            
            if (index > 0) combinedContent += '\n\n---\n\n';
            combinedContent += `### ${item.name}\n\n${text}`;
        });

        const b64 = btoa(unescape(encodeURIComponent(combinedContent)));
        const newItem: MediaItem = {
            id: Math.random().toString(36).substring(7),
            name: newName,
            mimeType: 'text/plain',
            data: b64,
            type: 'text'
        };

        const targetId = activeSession.id;
        
        // Fix: Cast s to any to avoid "Spread types may only be created from object types" error on object spread
        setSessions(prev => prev.map((s: any) => {
            if (s.id === targetId) {
                return {
                    ...s,
                    mediaItems: [...s.mediaItems, newItem],
                    selectedMediaIds: [...s.selectedMediaIds, newItem.id]
                };
            }
            return s;
        }));

        const currentSession = sessions.find(s => s.id === targetId);
        const existingMedia = currentSession ? currentSession.mediaItems : [];
        return { targetId, combinedMedia: [...existingMedia, newItem], newItems: [newItem] };
    };

    return {
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
        addHtmlItem,
        saveSessionWebsite,
        handleAddLink,
        batchAddLinks,
        handleRemoveMedia,
        handleToggleMedia,
        handleToggleAllMedia,
        combineMediaItems,
        isStorageInitialized
    };
};
