
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Theme, ThemeSettings, VoiceSettings, CastMember } from '../types';
import {
  cleanOllamaEndpoint,
  isLoopbackOrPrivateEndpoint,
  OllamaModel,
  OllamaTestResult,
  testOllamaConnection,
} from '../services/ollama';
import { useLanguage } from '../contexts/LanguageContext';
import GeminiModelDrawer from './GeminiModelDrawer';
import MaggiSettingsPanel from './maggi/MaggiSettings';
import { getMaggiStore } from '../services/maggi/store';
import { DEFAULT_MAGGI_SETTINGS, MaggiSettings as MaggiConfig } from '../maggi/config';
import { DEFAULT_GEMINI_MODEL } from '../constants/geminiModels';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: Theme;
  onSetTheme: (t: Theme) => void;
  settings: ThemeSettings;
  onUpdateSettings: (s: ThemeSettings) => void;
  initialTab?: 'ai' | 'visual' | 'cast';
  voiceSettings?: VoiceSettings;
  onUpdateVoiceSettings?: (s: VoiceSettings) => void;
  castLibrary?: CastMember[];
  onAddCastMember?: (m: Omit<CastMember, 'id'>) => void;
  onUpdateCastMember?: (id: string, m: Partial<CastMember>) => void;
  onDeleteCastMember?: (id: string) => void;
  onResetLibrary?: () => void;
  onOpenMaggi?: (tab?: 'chat' | 'sources' | 'saved' | 'defaults' | 'settings') => void;
  onTouchRole?: (role: 'host' | 'expert' | 'guest') => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onSetTheme,
  settings,
  onUpdateSettings,
  initialTab = 'ai',
  voiceSettings,
  onUpdateVoiceSettings,
  castLibrary = [],
  onAddCastMember,
  onUpdateCastMember,
  onDeleteCastMember,
  onResetLibrary,
  onOpenMaggi,
  onTouchRole
}) => {
  const { language, setLanguage, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'ai' | 'visual' | 'cast'>(initialTab);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [ollamaTestResult, setOllamaTestResult] = useState<OllamaTestResult | null>(null);
  const [copiedTunnelCmd, setCopiedTunnelCmd] = useState(false);

  const maggiStore = getMaggiStore();
  const [maggiConfig, setMaggiConfig] = useState<MaggiConfig>(() => maggiStore.getSettings());
  const [maggiStats, setMaggiStats] = useState(() => maggiStore.stats());
  const [maggiSavedCount, setMaggiSavedCount] = useState(() => maggiStore.listSavedQueries().length);
  
  // Cast Editing State
  const [editingMember, setEditingMember] = useState<CastMember | null>(null);
  const [isNewMember, setIsNewMember] = useState(false);

  // Architecture Specs State
  const [archContent, setArchContent] = useState<string>('');
  const [showArchDoc, setShowArchDoc] = useState(false);
  const [isLoadingArch, setIsLoadingArch] = useState(false);
  const [accentColor, setAccentColor] = useState<string>(() => {
    const saved = localStorage.getItem('aggrigator_accent_color_hex');
    if (saved) return saved;
    // Fallback if legacy numeric color exists
    const legacy = localStorage.getItem('aggrigator_accent_color');
    if (legacy !== null) {
      const idx = parseInt(legacy, 10);
      const presets = ['#f43f5e', '#f59e0b', '#eab308', '#10b981', '#ffffff', '#3b82f6', '#6366f1', '#a855f7'];
      if (idx >= 0 && idx < presets.length) return presets[idx];
    }
    return '#3b82f6'; // default to Blue
  });
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void maggiStore.hydrate().then(() => {
      if (cancelled) return;
      setMaggiConfig(maggiStore.getSettings());
      setMaggiStats(maggiStore.stats());
      setMaggiSavedCount(maggiStore.listSavedQueries().length);
    });
    const unsub = maggiStore.subscribe(() => {
      if (cancelled) return;
      setMaggiConfig(maggiStore.getSettings());
      setMaggiStats(maggiStore.stats());
      setMaggiSavedCount(maggiStore.listSavedQueries().length);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [isOpen, maggiStore]);

  useEffect(() => {
    localStorage.setItem('aggrigator_accent_color_hex', accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!showArchDoc) {
      setIsColorPickerOpen(false);
    }
  }, [showArchDoc]);

  const handleShowArchitecture = async () => {
    setShowArchDoc(true);
    if (!archContent) {
      setIsLoadingArch(true);
      try {
        const res = await fetch('/api/architecture');
        const data = await res.json();
        if (data.content) {
          setArchContent(data.content);
        } else {
          setArchContent('Failed to load architecture document.');
        }
      } catch (err) {
        setArchContent('Error loading architecture document.');
      } finally {
        setIsLoadingArch(false);
      }
    }
  };

  const handleCopyArch = () => {
    navigator.clipboard.writeText(archContent);
    alert('Architecture specifications copied to clipboard!');
  };

  const handleExportArchTxt = () => {
    const now = new Date();
    const DD = String(now.getDate()).padStart(2, '0');
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const Min = String(now.getMinutes()).padStart(2, '0');
    const timestamp = `${DD}_${MM}-${HH}-${Min}`;

    const blob = new Blob([archContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `architecture_specs_${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportArchCsv = () => {
    const now = new Date();
    const DD = String(now.getDate()).padStart(2, '0');
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const Min = String(now.getMinutes()).padStart(2, '0');
    const SS = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${DD}_${MM}-${HH}-${Min}-${SS}`;

    const lines = archContent.split('\n');
    const csvRows: { heading: string; level: number; content: string[] }[] = [];
    let currentSection: { heading: string; level: number; content: string[] } | null = null;

    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        if (currentSection) {
          csvRows.push(currentSection);
        }
        currentSection = {
          heading: match[2].trim(),
          level: match[1].length,
          content: []
        };
      } else {
        if (currentSection) {
          const trimmed = line.trim();
          if (trimmed) {
            currentSection.content.push(line);
          }
        } else {
          const trimmed = line.trim();
          if (trimmed) {
            currentSection = {
              heading: "Overview/Introduction",
              level: 1,
              content: [line]
            };
          }
        }
      }
    });
    if (currentSection) {
      csvRows.push(currentSection);
    }

    const csvHeader = "Section,Heading Level,Content\n";
    const csvContent = csvHeader + csvRows.map(row => {
      const cleanSection = row.heading.replace(/"/g, '""');
      const cleanContent = row.content.join('\n').trim().replace(/"/g, '""');
      return `"${cleanSection}",${row.level},"${cleanContent}"`;
    }).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `architecture_specss_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Sync internal tab state with prop when panel opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen]);

  // Mixed Content Detection (only local/private HTTP endpoints cannot be reached cleanly from HTTPS)
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpEndpoint = cleanOllamaEndpoint(settings.ollamaEndpoint).startsWith('http://');
  const showMixedContentWarning =
    isHttps &&
    isHttpEndpoint &&
    isLoopbackOrPrivateEndpoint(settings.ollamaEndpoint) &&
    settings.provider === 'ollama';

  useEffect(() => {
    if (showMixedContentWarning) {
      setOllamaError(null);
      setOllamaTestResult(null);
      return;
    }
    if (isOpen && settings.provider === 'ollama' && activeTab === 'ai' && settings.ollamaEndpoint?.trim()) {
      fetchOllamaModels();
    } else if (settings.provider !== 'ollama') {
      setOllamaError(null);
      setOllamaTestResult(null);
    }
  }, [isOpen, settings.provider, activeTab, showMixedContentWarning]);

  const fetchOllamaModels = async () => {
    setIsFetchingModels(true);
    setOllamaError(null);
    try {
      const result = await testOllamaConnection(settings.ollamaEndpoint);
      setOllamaTestResult(result);
      if (result.ok) {
        setOllamaModels(result.models);
        const nextSettings = { ...settings };
        let changed = false;
        if (result.normalizedEndpoint && result.normalizedEndpoint !== settings.ollamaEndpoint) {
          nextSettings.ollamaEndpoint = result.normalizedEndpoint;
          changed = true;
        }
        if (!settings.ollamaModel && result.models.length > 0) {
          nextSettings.ollamaModel = result.models[0].name;
          changed = true;
        }
        if (changed) {
          onUpdateSettings(nextSettings);
        }
      } else {
        setOllamaError(result.detail || "Could not connect to Ollama.");
      }
    } catch (err: any) {
      const msg = err?.message || "Could not connect. Ensure Ollama is running.";
      setOllamaError(msg);
      setOllamaTestResult({
        ok: false,
        detail: msg,
        models: [],
        latencyMs: 0,
        via: 'browser-direct',
        normalizedEndpoint: cleanOllamaEndpoint(settings.ollamaEndpoint) || settings.ollamaEndpoint,
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleCopyTunnelCmd = () => {
    const cmd = 'cloudflared tunnel --url http://localhost:11434';
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopiedTunnelCmd(true);
      setTimeout(() => setCopiedTunnelCmd(false), 1800);
    }).catch(() => {});
  };

  const handleBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateSettings({ ...settings, bgBrightness: Number(e.target.value) });
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateSettings({ ...settings, textBrightness: Number(e.target.value) });
  };

  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateSettings({ ...settings, hue: Number(e.target.value) });
  };

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateSettings({ ...settings, textSize: Number(e.target.value) });
  };

  const handleResetAll = () => {
    onUpdateSettings({ 
      bgBrightness: 100, 
      textBrightness: 100, 
      hue: 0, 
      textSize: 100,
      showLabels: true,
      model: DEFAULT_GEMINI_MODEL,
      provider: 'gemini',
      enableCaching: false,
      maggiAutoIndexSession: true,
      geminiApiKey: '',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: '',
      customBaseUrl: 'https://api.openai.com',
      customApiKey: '',
      customModelName: 'gpt-4o-mini',
      customApiPath: '/v1/chat/completions'
    });
  };

  const handleThemeReset = () => {
    onUpdateSettings({
      ...settings,
      bgBrightness: 100,
      textBrightness: 100,
      hue: 0,
      textSize: 100,
      showLabels: true,
    });
  };

  const handleAssignRole = (role: 'host' | 'expert' | 'guest', member: CastMember) => {
      if (!onUpdateVoiceSettings || !voiceSettings) return;
      
      const updates: Partial<VoiceSettings> = {};
      if (role === 'host') {
          updates.host = member.voice;
          updates.hostLabel = member.name;
          updates.hostBio = member.bio;
          updates.hostAvatar = member.avatar;
      } else if (role === 'expert') {
          updates.expert = member.voice;
          updates.expertLabel = member.name;
          updates.expertBio = member.bio;
          updates.expertAvatar = member.avatar;
      } else if (role === 'guest') {
          updates.guest = member.voice;
          updates.guestLabel = member.name;
          updates.guestBio = member.bio;
          updates.guestAvatar = member.avatar;
      }
      onUpdateVoiceSettings({ ...voiceSettings, ...updates });
      onTouchRole?.(role);
  };

  const handleSaveMember = () => {
      if (!editingMember) return;
      if (isNewMember && onAddCastMember) {
          const { id, ...rest } = editingMember;
          onAddCastMember(rest);
      } else if (!isNewMember && onUpdateCastMember) {
          onUpdateCastMember(editingMember.id, editingMember);
      }
      setEditingMember(null);
      setIsNewMember(false);
  };

  const availableVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Aoide'];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
      <div 
        className="w-full max-w-2xl bg-app-card border border-app-border rounded-2xl shadow-2xl flex flex-col overflow-hidden relative"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-app-border bg-app-panel">
          <div className="flex items-center gap-2">
             <h2 className="text-lg font-bold text-app-text mr-4">{t('settings.title')}</h2>
             {/* Tab Switcher */}
             <div className="flex bg-app-input rounded-lg p-1 border border-app-border">
                <button 
                  onClick={() => setActiveTab('ai')}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'ai' ? 'bg-app-text text-app-bg shadow-sm' : 'text-app-dim hover:text-app-text'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                  {t('settings.ai')}
                </button>
                <button 
                  onClick={() => setActiveTab('visual')}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'visual' ? 'bg-app-text text-app-bg shadow-sm' : 'text-app-dim hover:text-app-text'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                  {t('settings.visual')}
                </button>
                <button 
                  onClick={() => setActiveTab('cast')}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${activeTab === 'cast' ? 'bg-app-text text-app-bg shadow-sm' : 'text-app-dim hover:text-app-text'}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.149-1.268.432-1.828M14 10a6 6 0 01-6 6H6a6 6 0 01-6-6V7a3 3 0 013-3h7a3 3 0 013 3v3zm-4 0a4 4 0 100-8 4 4 0 000 8z" />
                  </svg>
                  {t('settings.cast')}
                </button>
             </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-app-input rounded-lg p-1 border border-app-border mr-2">
              <button
                onClick={() => setLanguage('en')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${language === 'en' ? 'bg-app-text text-app-bg shadow-sm' : 'text-app-dim hover:text-app-text'}`}
              >
                EN
              </button>
              <button
                onClick={() => setLanguage('sv')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${language === 'sv' ? 'bg-app-text text-app-bg shadow-sm' : 'text-app-dim hover:text-app-text'}`}
              >
                SV
              </button>
            </div>
            <button 
              onClick={handleResetAll} 
              className="text-[10px] uppercase font-bold text-app-dim hover:text-red-400 transition-colors px-2 py-1 rounded border border-transparent hover:border-red-400/50"
              title={t('settings.reset')}
            >
              {t('settings.reset')}
            </button>
            <button onClick={onClose} className="text-app-muted hover:text-app-text p-1 bg-app-card rounded-full border border-app-border" title={t('settings.close')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          
          {/* Program Architecture Button */}
          <div className="bg-gradient-to-r from-teal-500/5 to-sky-500/5 hover:from-teal-500/10 hover:to-sky-500/10 border border-teal-500/10 hover:border-teal-500/20 p-4 rounded-xl flex items-center justify-between gap-4 transition-all mb-2">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-teal-400 tracking-wider uppercase">
                {language === 'sv' ? 'Systemarkitektur & Verktygsset' : 'System Architecture & Toolset'}
              </h3>
              <p className="text-[10px] text-app-dim max-w-sm">
                {language === 'sv' ? 'Visa den fullständiga tekniska specifikationen och programstrukturen i realtid.' : 'Examine the full system specifications, data models, and services definition.'}
              </p>
            </div>
            <button
              onClick={handleShowArchitecture}
              className="px-4 py-2 bg-teal-500/10 hover:bg-teal-500/20 border border-teal-500/20 hover:border-teal-500/40 rounded-lg text-teal-400 text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-teal-500/5 shrink-0"
              title="Open Program Architecture Specs"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{language === 'sv' ? 'Öppna arkitektur' : 'Architecture Specs'}</span>
            </button>
          </div>
        
        {/* --- AI SETTINGS TAB --- */}
        {activeTab === 'ai' && (
          <div className="space-y-4 animate-fade-in">
             <div className="bg-app-panel rounded-xl p-3 border border-app-border">
                <label className="block text-xs font-bold text-app-dim uppercase tracking-wider mb-2">AI Provider</label>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-app-card rounded-lg p-1 mb-3">
                  <button
                      onClick={() => onUpdateSettings({ ...settings, provider: 'gemini' })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all ${settings.provider === 'gemini' ? 'bg-app-text text-app-bg shadow' : 'text-app-muted hover:text-app-text'}`}
                  >
                    Gemini
                  </button>
                  <button
                      onClick={() => onUpdateSettings({ ...settings, provider: 'maggi' })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all ${settings.provider === 'maggi' ? 'bg-emerald-500 text-black shadow' : 'text-app-muted hover:text-app-text'}`}
                  >
                    🧠 MAGGI
                  </button>
                  <button
                      onClick={() => onUpdateSettings({ ...settings, provider: 'ollama' })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all ${settings.provider === 'ollama' ? 'bg-app-text text-app-bg shadow' : 'text-app-muted hover:text-app-text'}`}
                  >
                    Ollama
                  </button>
                  <button
                      onClick={() => onUpdateSettings({ ...settings, provider: 'custom' })}
                      className={`py-1.5 text-xs font-bold rounded-md transition-all ${settings.provider === 'custom' ? 'bg-app-text text-app-bg shadow' : 'text-app-muted hover:text-app-text'}`}
                  >
                    Custom AI
                  </button>
                </div>

                {/* Gemini Settings */}
                {settings.provider === 'gemini' && (
                  <div className="space-y-4 animate-pulse-fast-once">
                      <GeminiModelDrawer
                        value={settings.model}
                        onChange={(model) => onUpdateSettings({ ...settings, model })}
                      />

                      <div className="space-y-1.5 pt-1">
                        <label className="block text-[10px] text-app-dim">
                          {language === 'sv' ? 'Egen Gemini API-nyckel (valfritt)' : 'Custom Gemini API Key (Optional)'}
                        </label>
                        <input 
                          type="password" 
                          value={settings.geminiApiKey || ''}
                          onChange={(e) => onUpdateSettings({ ...settings, geminiApiKey: e.target.value })}
                          className="w-full bg-app-input border border-app-border rounded px-2.5 py-1.5 text-xs text-app-text focus:outline-none focus:border-app-text"
                          placeholder={language === 'sv' ? 'Skriv din egen API-nyckel' : 'Enter your own AI Studio API Key'}
                        />
                        <p className="text-[9px] text-app-dim italic">
                          {language === 'sv' ? 'Används om den delade nyckeln har slut på kvot.' : 'Overrides the server API key if the default quota is exhausted.'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between border-t border-app-border pt-3">
                        <div>
                          <p className="text-xs font-bold text-app-text">Context Caching</p>
                          <p className="text-[9px] text-app-dim">Caches media on server for faster queries. (Beta)</p>
                        </div>
                        <button 
                          onClick={() => onUpdateSettings({ ...settings, enableCaching: !settings.enableCaching })}
                          className={`w-10 h-5 rounded-full flex items-center transition-colors p-1 ${settings.enableCaching ? 'bg-app-text' : 'bg-app-border'}`}
                        >
                          <div className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${settings.enableCaching ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between border-t border-app-border pt-3">
                        <div>
                          <p className="text-xs font-bold text-app-text">Auto-Tag Sources</p>
                          <p className="text-[9px] text-app-dim">Automatically generate tags for uploaded media.</p>
                        </div>
                        <button 
                          onClick={() => onUpdateSettings({ ...settings, autoTagSources: !settings.autoTagSources })}
                          className={`w-10 h-5 rounded-full flex items-center transition-colors p-1 ${settings.autoTagSources ? 'bg-app-text' : 'bg-app-border'}`}
                        >
                          <div className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${settings.autoTagSources ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                  </div>
                )}

                {/* MAGGI (Grounded RAG) Settings */}
                {settings.provider === 'maggi' && (
                  <div className="space-y-4 animate-pulse-fast-once">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-emerald-400">
                            🧠 MAGGI RAG Engine Active
                          </div>
                          <p className="text-[10px] text-app-dim mt-0.5">
                            Routes workspace chat, citations, and suggestions through MAGGI hybrid retrieval (BM25 + vectors) and your selected brain.
                          </p>
                        </div>
                        {onOpenMaggi && (
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => onOpenMaggi('defaults')}
                              className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                            >
                              🔑 Edit Defaults Page
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenMaggi('chat')}
                              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-emerald-400 transition-colors"
                            >
                              Open Full MAGGI Workspace →
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-app-text/90">
                        <span className="rounded bg-app-bg px-2 py-0.5 border border-app-border">
                          📚 {maggiStats.documents} docs · {maggiStats.chunks} chunks indexed
                        </span>
                        <span className="rounded bg-app-bg px-2 py-0.5 border border-app-border">
                          🔖 {maggiSavedCount} saved queries
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5">
                      <div>
                        <p className="text-xs font-bold text-app-text">Auto-index Active Session Sources</p>
                        <p className="text-[9px] text-app-dim">
                          Automatically ingest selected workspace sources into MAGGI before answering.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            ...settings,
                            maggiAutoIndexSession: settings.maggiAutoIndexSession === false,
                          })
                        }
                        className={`w-10 h-5 rounded-full flex items-center transition-colors p-1 ${
                          settings.maggiAutoIndexSession !== false ? 'bg-emerald-500' : 'bg-app-border'
                        }`}
                      >
                        <div
                          className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${
                            settings.maggiAutoIndexSession !== false ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="border-t border-app-border pt-3">
                      <MaggiSettingsPanel
                        settings={maggiConfig}
                        onChange={(patch) => setMaggiConfig(maggiStore.updateSettings(patch))}
                        onReset={() => setMaggiConfig(maggiStore.updateSettings({ ...DEFAULT_MAGGI_SETTINGS }))}
                        onOpenDefaults={onOpenMaggi ? () => onOpenMaggi('defaults') : undefined}
                      />
                    </div>
                  </div>
                )}

                {/* Ollama Settings */}
                {settings.provider === 'ollama' && (
                  <div className="space-y-3 animate-pulse-fast-once">
                      {showMixedContentWarning && (
                        <div className="bg-amber-950/30 border border-amber-500/40 p-2.5 rounded-lg text-[10px] text-amber-200 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-bold text-amber-300">⚠️ Local HTTP on HTTPS Preview</p>
                            {typeof window !== 'undefined' && window.self !== window.top && (
                              <a
                                href={window.location.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold transition-colors"
                              >
                                Open in New Tab ↗
                              </a>
                            )}
                          </div>
                          <p>
                            Browsers inside an HTTPS preview iframe block <code>http://localhost:11434</code>.
                            Run a tunnel on your PC — our backend proxies it automatically (no CORS flags needed):
                          </p>
                          <div className="flex items-center gap-1.5 bg-black/40 p-1.5 rounded border border-amber-500/20">
                            <code className="flex-1 text-amber-300 overflow-x-auto whitespace-nowrap">
                              cloudflared tunnel --url http://localhost:11434
                            </code>
                            <button
                              type="button"
                              onClick={handleCopyTunnelCmd}
                              className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold transition-colors"
                            >
                              {copiedTunnelCmd ? 'Copied ✓' : 'Copy'}
                            </button>
                          </div>
                          <p className="opacity-90">
                            Paste the generated <code>https://....trycloudflare.com</code> URL below and click <b>Test Connection</b>.
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] text-app-dim mb-1">Endpoint URL</label>
                        <div className="flex gap-1.5">
                          <input 
                            type="text" 
                            value={settings.ollamaEndpoint}
                            onChange={(e) => {
                              setOllamaTestResult(null);
                              setOllamaError(null);
                              onUpdateSettings({ ...settings, ollamaEndpoint: e.target.value });
                            }}
                            className="flex-1 bg-app-input border border-app-border rounded px-2 py-1.5 text-xs text-app-text"
                            placeholder="https://xyz.trycloudflare.com or http://localhost:11434"
                          />
                          <button
                            type="button"
                            onClick={fetchOllamaModels}
                            disabled={isFetchingModels}
                            className="shrink-0 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold transition-colors disabled:opacity-50"
                            title="Test Ollama connectivity and load installed models"
                          >
                            {isFetchingModels ? 'Testing…' : 'Test Connection'}
                          </button>
                        </div>

                        {ollamaTestResult && ollamaTestResult.ok && (
                          <div className="mt-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 flex items-center justify-between gap-2">
                            <span className="font-semibold">✓ {ollamaTestResult.detail}</span>
                            <span className="text-[9px] uppercase tracking-wider opacity-80 shrink-0">
                              {ollamaTestResult.via === 'server-proxy'
                                ? 'server proxy'
                                : ollamaTestResult.via === 'vite-proxy'
                                  ? 'local proxy'
                                  : 'direct'}
                            </span>
                          </div>
                        )}

                        {ollamaError && (
                          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-950/25 px-2.5 py-2 text-[10px] text-red-300 prose prose-invert prose-p:my-1 prose-ol:my-1 max-w-none">
                            <ReactMarkdown>{ollamaError}</ReactMarkdown>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[10px] text-app-dim">Select Model</label>
                          {ollamaModels.length > 0 && (
                            <button
                              type="button"
                              onClick={fetchOllamaModels}
                              disabled={isFetchingModels}
                              className="text-[10px] text-app-dim hover:text-app-text underline"
                            >
                              Refresh list
                            </button>
                          )}
                        </div>
                        {ollamaModels.length > 0 ? (
                          <select 
                            value={settings.ollamaModel}
                            onChange={(e) => onUpdateSettings({ ...settings, ollamaModel: e.target.value })}
                            className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-xs text-app-text focus:outline-none"
                          >
                            <option value="" disabled>Select a model...</option>
                            {ollamaModels.map(m => (
                              <option key={m.name} value={m.name}>
                                {m.name}{m.size ? ` (${(m.size / 1024 / 1024 / 1024).toFixed(1)}GB)` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={settings.ollamaModel}
                            onChange={(e) => onUpdateSettings({ ...settings, ollamaModel: e.target.value })}
                            placeholder="Test connection to auto-load models, or type e.g. llama3.2"
                            className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-xs text-app-text focus:outline-none"
                          />
                        )}
                      </div>
                      <p className="text-[9px] text-app-dim italic leading-relaxed">
                        Tunnel URLs (`https://....trycloudflare.com`) route through our server proxy with no CORS setup needed. For direct browser loopback, start Ollama with <code>OLLAMA_ORIGINS="*" ollama serve</code>.
                      </p>
                  </div>
                )}

                {/* Custom OpenAI-Compatible Settings */}
                {settings.provider === 'custom' && (
                  <div className="space-y-3 animate-pulse-fast-once">
                      <div>
                        <label className="block text-[10px] text-app-dim mb-1">Base URL</label>
                        <input 
                          type="text" 
                          value={settings.customBaseUrl || ''}
                          onChange={(e) => onUpdateSettings({ ...settings, customBaseUrl: e.target.value })}
                          className="w-full bg-app-input border border-app-border rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:border-app-text"
                          placeholder="e.g. https://api.openai.com"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-app-dim mb-1">API Key</label>
                        <input 
                          type="password" 
                          value={settings.customApiKey || ''}
                          onChange={(e) => onUpdateSettings({ ...settings, customApiKey: e.target.value })}
                          className="w-full bg-app-input border border-app-border rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:border-app-text"
                          placeholder="Enter your API Key"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-app-dim mb-1">Model Name</label>
                        <input 
                          type="text" 
                          value={settings.customModelName || ''}
                          onChange={(e) => onUpdateSettings({ ...settings, customModelName: e.target.value })}
                          className="w-full bg-app-input border border-app-border rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:border-app-text"
                          placeholder="e.g. gpt-4o"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-app-dim mb-1">API Path</label>
                        <input 
                          type="text" 
                          value={settings.customApiPath || ''}
                          onChange={(e) => onUpdateSettings({ ...settings, customApiPath: e.target.value })}
                          className="w-full bg-app-input border border-app-border rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:border-app-text"
                          placeholder="e.g. /v1/chat/completions"
                        />
                      </div>
                      <p className="text-[9px] text-app-dim italic">
                        Requests are routed securely through the local backend proxy to bypass CORS restrictions.
                      </p>
                  </div>
                )}
              </div>
          </div>
        )}

        {/* --- VISUAL SETTINGS TAB --- */}
        {activeTab === 'visual' && (
          <div className="space-y-6 animate-fade-in">
            {/* Theme Selection */}
            <div>
              <label className="block text-xs font-bold text-app-dim uppercase tracking-wider mb-3">Theme Mode</label>
              <div className="grid grid-cols-3 gap-3">
                <button 
                  onClick={() => onSetTheme('dark')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${currentTheme === 'dark' ? 'bg-app-panel border-app-text text-app-text shadow-lg scale-105' : 'border-app-border text-app-muted hover:bg-app-panel hover:text-app-text'}`}
                  title="Dark Mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  <span className="text-xs font-medium">Dark</span>
                </button>

                <button 
                  onClick={() => onSetTheme('light')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${currentTheme === 'light' ? 'bg-app-panel border-app-text text-app-text shadow-lg scale-105' : 'border-app-border text-app-muted hover:bg-app-panel hover:text-app-text'}`}
                  title="Light Mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span className="text-xs font-medium">Light</span>
                </button>

                <button 
                  onClick={() => onSetTheme('olive')}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${currentTheme === 'olive' ? 'bg-app-panel border-app-text text-app-text shadow-lg scale-105' : 'border-app-border text-app-muted hover:bg-app-panel hover:text-app-text'}`}
                  title="Olive Mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <span className="text-xs font-medium">Olive</span>
                </button>
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-6 pt-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-app-text uppercase tracking-wider">Customization</span>
                <button 
                  onClick={handleThemeReset}
                  className="text-[10px] bg-app-border/50 hover:bg-app-border text-app-dim hover:text-app-text px-2 py-1 rounded transition-colors"
                >
                  Reset Theme
                </button>
              </div>
              
              {/* Show Labels Toggle */}
              <div className="flex items-center justify-between">
                 <div>
                    <p className="text-xs font-bold text-app-dim uppercase tracking-wider">Button Labels</p>
                 </div>
                 <button 
                    onClick={() => onUpdateSettings({ ...settings, showLabels: !settings.showLabels })}
                    className={`w-10 h-5 rounded-full flex items-center transition-colors p-1 ${settings.showLabels ? 'bg-app-text' : 'bg-app-border'}`}
                  >
                    <div className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${settings.showLabels ? 'translate-x-5' : 'translate-x-0'}`} />
                 </button>
              </div>

              {/* Color Tint Slider */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-app-dim uppercase tracking-wider">Color Tint</label>
                  <span className="text-xs text-app-text font-mono">{settings.hue || 0}°</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="360" 
                  value={settings.hue || 0} 
                  onChange={handleHueChange}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
                  }}
                />
              </div>

              {/* Text Size Slider */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-app-dim uppercase tracking-wider">Text Size</label>
                  <span className="text-xs text-app-text font-mono">{settings.textSize || 100}%</span>
                </div>
                <input 
                  type="range" 
                  min="80" 
                  max="140" 
                  step="5"
                  value={settings.textSize || 100} 
                  onChange={handleSizeChange}
                  className="w-full h-2 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-text"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-app-dim uppercase tracking-wider">Background Dimmer</label>
                  <span className="text-xs text-app-text font-mono">{settings.bgBrightness}%</span>
                </div>
                <input 
                  type="range" 
                  min="20" 
                  max="100" 
                  value={settings.bgBrightness} 
                  onChange={handleBgChange}
                  className="w-full h-2 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-text"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-app-dim uppercase tracking-wider">Text Brightness</label>
                  <span className="text-xs text-app-text font-mono">{settings.textBrightness}%</span>
                </div>
                <input 
                  type="range" 
                  min="50" 
                  max="150" 
                  value={settings.textBrightness} 
                  onChange={handleTextChange}
                  className="w-full h-2 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-text"
                />
              </div>
            </div>
          </div>
        )}

        {/* --- CAST SETTINGS TAB --- */}
        {activeTab === 'cast' && (
            <div className="space-y-6 animate-fade-in pb-10">
                {!editingMember ? (
                    <>
                        <div className="flex justify-between items-center">
                            <h3 className="text-xs font-bold text-app-dim uppercase tracking-wider">Cast Library</h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={onResetLibrary}
                                    className="text-[10px] text-app-dim hover:text-red-400 px-2 py-1"
                                >
                                    Reset
                                </button>
                                <button
                                    onClick={() => {
                                        setEditingMember({
                                            id: '',
                                            name: '',
                                            voice: '',
                                            bio: '',
                                            category: 'user',
                                            defaultRole: 'guest',
                                            gender: 'Female'
                                        });
                                        setIsNewMember(true);
                                    }}
                                    className="text-xs bg-app-text text-app-bg px-3 py-1 rounded font-bold hover:opacity-90"
                                >
                                    + New Member
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {castLibrary.map(member => (
                                <div key={member.id} className="bg-app-panel border border-app-border rounded-xl p-3 hover:border-app-dim transition-colors">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h4 className="font-bold text-app-text">{member.name}</h4>
                                            <p className="text-[10px] text-app-dim uppercase tracking-wider">Voice: {member.voice}</p>
                                        </div>
                                        <div className="flex gap-1">
                                            <button 
                                                onClick={() => {
                                                    setEditingMember(member);
                                                    setIsNewMember(false);
                                                }}
                                                className="p-1 text-app-muted hover:text-app-text"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                                            </button>
                                            <button 
                                                onClick={() => onDeleteCastMember && onDeleteCastMember(member.id)}
                                                className="p-1 text-app-dim hover:text-red-400"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-app-muted line-clamp-2 mb-3">{member.bio}</p>
                                    
                                    <div className="flex gap-2 border-t border-app-border pt-2">
                                        <button 
                                            onClick={() => handleAssignRole('host', member)}
                                            className={`flex-1 py-1 text-[10px] rounded border ${voiceSettings?.hostLabel === member.name ? 'bg-app-text text-app-bg border-app-text font-bold' : 'border-app-border text-app-dim hover:border-app-text hover:text-app-text'}`}
                                        >
                                            Set Host
                                        </button>
                                        <button 
                                            onClick={() => handleAssignRole('expert', member)}
                                            className={`flex-1 py-1 text-[10px] rounded border ${voiceSettings?.expertLabel === member.name ? 'bg-app-text text-app-bg border-app-text font-bold' : 'border-app-border text-app-dim hover:border-app-text hover:text-app-text'}`}
                                        >
                                            Set Expert
                                        </button>
                                        <button 
                                            onClick={() => handleAssignRole('guest', member)}
                                            className={`flex-1 py-1 text-[10px] rounded border ${voiceSettings?.guestLabel === member.name ? 'bg-app-text text-app-bg border-app-text font-bold' : 'border-app-border text-app-dim hover:border-app-text hover:text-app-text'}`}
                                        >
                                            Set Guest
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-4">
                            <button 
                                onClick={() => setEditingMember(null)}
                                className="text-app-dim hover:text-app-text"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" /></svg>
                            </button>
                            <h3 className="font-bold text-app-text">{isNewMember ? 'New Cast Member' : 'Edit Member'}</h3>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-1">Character Name</label>
                            <input 
                                type="text"
                                value={editingMember.name}
                                onChange={e => setEditingMember({ ...editingMember, name: e.target.value })}
                                className="w-full bg-app-input border border-app-border rounded px-3 py-2 text-sm text-app-text focus:border-app-text outline-none"
                                placeholder="e.g. Sax"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-1">Voice Model</label>
                            <select 
                                value={editingMember.voice}
                                onChange={e => setEditingMember({ ...editingMember, voice: e.target.value })}
                                className="w-full bg-app-input border border-app-border rounded px-3 py-2 text-sm text-app-text focus:border-app-text outline-none"
                            >
                                {availableVoices.map(v => (
                                    <option key={v} value={v}>{v}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-1">Gender</label>
                            <div className="flex gap-4 p-2 bg-app-input border border-app-border rounded">
                              {(['Female', 'Male', 'Neutral'] as const).map((gender) => (
                                <label key={gender} className="flex items-center gap-2 cursor-pointer text-xs text-app-text font-medium select-none">
                                  <input
                                    type="radio"
                                    name="settingsGender"
                                    value={gender}
                                    checked={editingMember.gender === gender || (!editingMember.gender && gender === 'Female')}
                                    onChange={() => setEditingMember({ ...editingMember, gender })}
                                    className="text-purple-500 bg-app-bg border-app-border focus:ring-purple-500 cursor-pointer"
                                  />
                                  <span className="flex items-center gap-1">
                                    {gender === 'Female' && <span className="text-pink-400 font-bold">♀ Female</span>}
                                    {gender === 'Male' && <span className="text-sky-400 font-bold">♂ Male</span>}
                                    {gender === 'Neutral' && <span className="text-zinc-400 font-bold">⚪ Neutral</span>}
                                  </span>
                                </label>
                              ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-app-dim uppercase mb-1">Bio / Vibe</label>
                            <textarea 
                                value={editingMember.bio}
                                onChange={e => setEditingMember({ ...editingMember, bio: e.target.value })}
                                className="w-full bg-app-input border border-app-border rounded px-3 py-2 text-sm text-app-text focus:border-app-text outline-none h-32 resize-none"
                                placeholder="Describe their personality, expertise, and speaking style..."
                            />
                        </div>

                        <div className="pt-4">
                            <button 
                                onClick={handleSaveMember}
                                disabled={!editingMember.name || !editingMember.voice}
                                className="w-full bg-app-text text-app-bg font-bold py-2 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save Member
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* Architecture Specs Markdown Overlay */}
        {showArchDoc && (() => {
          const colorPresets = [
            { name: 'Rose', hex: '#f43f5e' },
            { name: 'Amber', hex: '#f59e0b' },
            { name: 'Yellow', hex: '#eab308' },
            { name: 'Emerald', hex: '#10b981' },
            { name: 'White', hex: '#ffffff' },
            { name: 'Blue', hex: '#3b82f6' },
            { name: 'Indigo', hex: '#6366f1' },
            { name: 'Purple', hex: '#a855f7' },
          ];

          return (
            <div className="absolute inset-0 bg-app-card z-50 flex flex-col animate-fade-in rounded-2xl overflow-hidden">
              {/* Overlay Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between p-4 border-b border-app-border bg-app-panel gap-3">
                <div className="flex items-center gap-2 transition-all duration-500 shrink-0">
                  <div 
                    className="flex items-center gap-2 transition-all duration-500 shrink-0"
                    style={{ color: accentColor }}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h3 className="font-bold text-sm tracking-wide uppercase">
                      {language === 'sv' ? 'Systemarkitektur' : 'Program Architecture Specs'}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 relative">
                  {/* Accent Color Selection Fly-out */}
                  <div className="relative">
                    <button
                      onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
                      className={`flex items-center gap-1.5 p-2 rounded-lg border transition-all hover:scale-105 active:scale-95 cursor-pointer ${
                        isColorPickerOpen 
                          ? 'bg-app-border border-app-muted' 
                          : 'bg-app-card hover:bg-app-border border-app-border'
                      }`}
                      title="Change Theme Accent Color"
                    >
                      <span 
                        className="inline-flex rounded-full h-3 w-3 shadow-sm border border-white/20 transition-all duration-300"
                        style={{ backgroundColor: accentColor }}
                      ></span>
                      <svg className={`w-3 h-3 text-app-muted transition-transform duration-300 ${isColorPickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Fly-out Popover panel */}
                    {isColorPickerOpen && (
                      <div className="absolute right-0 mt-2 w-52 bg-app-card border border-app-border rounded-xl p-3 shadow-2xl z-50 animate-fade-in space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-app-dim">Accent Color</span>
                        </div>
                        <div className="h-px bg-app-border/40"></div>
                        <div className="flex flex-wrap gap-2 justify-center py-1 items-center">
                          {colorPresets.map((colorObj) => {
                            const isSelected = accentColor.toLowerCase() === colorObj.hex.toLowerCase();
                            return (
                              <button
                                key={colorObj.hex}
                                onClick={() => {
                                  setAccentColor(colorObj.hex);
                                }}
                                className={`w-6 h-6 rounded-full transition-all cursor-pointer ring-offset-2 ring-offset-app-card ${
                                  isSelected 
                                    ? 'ring-2 ring-white scale-110 shadow-lg' 
                                    : 'opacity-60 hover:opacity-100 hover:scale-105'
                                }`}
                                style={{ backgroundColor: colorObj.hex }}
                                title={colorObj.name}
                              />
                            );
                          })}

                          {/* Custom Color Input Dial */}
                          <div className="relative">
                            <label 
                              className={`w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110 border border-app-border/60 relative ${
                                !colorPresets.some(p => p.hex.toLowerCase() === accentColor.toLowerCase())
                                  ? 'ring-2 ring-white ring-offset-2 ring-offset-app-card scale-110'
                                  : 'opacity-60 hover:opacity-100'
                              }`}
                              style={{ 
                                background: 'linear-gradient(135deg, #ff007f 0%, #7f00ff 50%, #00f0ff 100%)'
                              }}
                              title="Custom Accent Color"
                            >
                              <input
                                type="color"
                                value={accentColor}
                                onChange={(e) => setAccentColor(e.target.value)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <svg className="w-3 h-3 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </label>
                          </div>
                        </div>
                        <div className="text-[9px] text-app-dim text-center border-t border-app-border/30 pt-1.5 font-medium flex items-center justify-center gap-1 flex-wrap">
                          Active: <span className="font-semibold uppercase text-app-text">
                            {colorPresets.find(p => p.hex.toLowerCase() === accentColor.toLowerCase())?.name || 'Custom'}
                          </span>
                          <span className="font-mono text-[8px] opacity-60">({accentColor.toUpperCase()})</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleCopyArch}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-app-card hover:bg-app-border border border-app-border rounded-lg text-app-text text-[10px] font-bold tracking-wide uppercase transition-all hover:scale-105 active:scale-95"
                    title="Copy architecture specifications to clipboard"
                  >
                    <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    <span>Copy</span>
                  </button>
                  <button
                    onClick={handleExportArchTxt}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-app-card hover:bg-app-border border border-app-border rounded-lg text-app-text text-[10px] font-bold tracking-wide uppercase transition-all hover:scale-105 active:scale-95"
                    title="Save specifications as TXT"
                  >
                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>TXT</span>
                  </button>
                  <button
                    onClick={handleExportArchCsv}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-app-card hover:bg-app-border border border-app-border rounded-lg text-app-text text-[10px] font-bold tracking-wide uppercase transition-all hover:scale-105 active:scale-95"
                    title="Export sections as CSV"
                  >
                    <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>CSV</span>
                  </button>
                  <div className="w-px h-4 bg-app-border mx-1"></div>
                  <button 
                    onClick={() => setShowArchDoc(false)} 
                    className="text-app-muted hover:text-app-text p-1.5 bg-app-card rounded-full border border-app-border transition-all hover:scale-105 animate-pulse-fast-once"
                    title={t('settings.close')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-app-bg text-app-text">
                {isLoadingArch ? (
                  <div className="flex flex-col items-center justify-center h-64 space-y-3">
                    <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-xs text-app-muted font-medium animate-pulse">Loading ARCHITECTURE.md...</p>
                  </div>
                ) : (
                  <div className="markdown-body text-xs leading-relaxed font-sans space-y-4 prose prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        h1: ({node, ...props}) => <h1 style={{ color: accentColor }} className="text-base font-extrabold border-b border-app-border/40 pb-2 mt-6 mb-3 tracking-wide uppercase transition-colors duration-500" {...props} />,
                        h2: ({node, ...props}) => <h2 style={{ color: accentColor }} className="text-sm font-bold mt-5 mb-2.5 tracking-wide uppercase transition-colors duration-500" {...props} />,
                        h3: ({node, ...props}) => <h3 style={{ color: accentColor }} className="text-xs font-bold mt-4 mb-2 tracking-wide transition-colors duration-500" {...props} />,
                        strong: ({node, ...props}) => <strong style={{ color: accentColor }} className="font-bold transition-colors duration-500" {...props} />,
                        a: ({node, ...props}) => <a style={{ color: accentColor }} className="underline hover:opacity-85 transition-all duration-500" {...props} />,
                      }}
                    >
                      {archContent}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  </div>
);
};

export default SettingsPanel;
