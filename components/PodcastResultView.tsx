import React, { useEffect, useRef, useState } from 'react';
import { VoiceSettings } from '../types';
import ArtifactPreview from './ArtifactPreview';
import { useLanguage } from '../contexts/LanguageContext';
import { PodcastFormatId, PodcastRole, computePodcastGate } from '../utils/podcastGating';

interface PodcastResultViewProps {
  previewCode: string;
  onClosePreview: () => void;
  generatedAudio: string | null;
  onSaveAudio: (audioData: string, filename: string) => void;
  onRegenerate?: (newScript: string) => void;
  isLoading: boolean;
  activeTool: string | null;
  activeFormat: PodcastFormatId | null;
  touchedRoles: PodcastRole[];
  voiceSettings: VoiceSettings;
  onUpdateVoiceSettings: (settings: VoiceSettings) => void;
  onRunFormat: (format: PodcastFormatId, lengthOverride?: VoiceSettings['length']) => void;
  currentTheme?: string;
}

const PodcastResultView: React.FC<PodcastResultViewProps> = ({
  previewCode,
  onClosePreview,
  generatedAudio,
  onSaveAudio,
  onRegenerate,
  isLoading,
  activeTool,
  activeFormat,
  touchedRoles,
  voiceSettings,
  onUpdateVoiceSettings,
  onRunFormat,
  currentTheme,
}) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const prevVolumeRef = useRef(1);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFilename, setSaveFilename] = useState('');
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [scriptContent, setScriptContent] = useState('');

  const currentFormat = (activeFormat ?? 'podcast_1') as PodcastFormatId;
  const { hostOnly: hostOnlyActive, hostConfigured } = computePodcastGate({
    touchedRoles,
    activeFormat: currentFormat,
    contentReady: true,
    isLoading: false,
  });
  const audioMimeType = generatedAudio?.startsWith('UklGR') ? 'audio/wav' : 'audio/mpeg';

  useEffect(() => {
    if (generatedAudio && audioRef.current) {
      audioRef.current.src = `data:${audioMimeType};base64,${generatedAudio}`;
      audioRef.current.load();
      audioRef.current.volume = volume;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [generatedAudio, audioMimeType]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = Number(e.target.value);
    setVolume(vol);
    if (vol > 0) prevVolumeRef.current = vol;
    if (audioRef.current) {
      audioRef.current.volume = vol;
      audioRef.current.muted = vol === 0;
    }
  };

  const toggleMute = () => {
    const nextVol = volume > 0 ? 0 : (prevVolumeRef.current > 0 ? prevVolumeRef.current : 1);
    setVolume(nextVol);
    if (audioRef.current) {
      audioRef.current.volume = nextVol;
      audioRef.current.muted = nextVol === 0;
    }
  };

  const handleDownload = () => {
    setShowSaveModal(true);
    setSaveFilename(`podcast_${Date.now()}`);
  };

  const confirmDownload = () => {
    if (!generatedAudio) return;
    const link = document.createElement('a');
    link.href = `data:${audioMimeType};base64,${generatedAudio}`;
    link.download = `${saveFilename}.${audioMimeType === 'audio/wav' ? 'wav' : 'mp3'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowSaveModal(false);
  };

  const handleSaveAsSource = () => {
    if (!generatedAudio) return;
    onSaveAudio(generatedAudio, saveFilename);
    setShowSaveModal(false);
  };

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const handleInteractiveEdit = () => {
    if (!previewCode) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(previewCode, 'text/html');
    const divs = doc.querySelectorAll('body > div > div');
    let text = '';
    if (divs.length > 0) {
      divs.forEach(div => {
        text += div.textContent + '\n\n';
      });
    } else {
      text = doc.body.innerText || doc.body.textContent || '';
    }
    setScriptContent(text.trim());
    setIsEditingScript(true);
  };

  const handleSaveScript = () => {
    if (onRegenerate) {
      onRegenerate(scriptContent);
      setIsEditingScript(false);
    }
  };

  return (
    <div className="h-full w-full bg-app-bg relative z-50 flex flex-col">
      {/* Player Header / Controls */}
      <div className="bg-app-panel border-b border-app-border p-4 flex flex-col gap-4 shadow-lg z-10">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={onClosePreview} className="p-2 hover:bg-app-card rounded-lg text-app-dim hover:text-app-text transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
            </button>
            <h2 className="text-lg font-bold text-app-text flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${generatedAudio ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}></span>
              {generatedAudio ? t('studio.nowPlaying') : t('studio.toolResult')}
            </h2>
            {activeTool === 'podcast_creator' && hostOnlyActive && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/30"
                title={t('studio.soloUsesHostOnly')}
              >
                {t('studio.hostOnlyActive')}
              </span>
            )}
          </div>

          {/* Quick Regenerate Controls - Only for Podcasts */}
          {activeTool === 'podcast_creator' && (
            <div className="flex items-center gap-2 flex-wrap">
              {onRegenerate && (
                <button
                  onClick={handleInteractiveEdit}
                  className="px-3 py-1 text-xs font-bold rounded bg-app-card border border-app-border hover:bg-app-text hover:text-app-bg transition-colors flex items-center gap-1 mr-2"
                  title="Edit script and regenerate audio"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {t('studio.interactiveEdit')}
                </button>
              )}
              <div className="flex bg-app-bg rounded-lg p-1 border border-app-border">
                <button
                  onClick={() => onRunFormat('podcast_1')}
                  disabled={!hostConfigured || isLoading}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${activeFormat === 'podcast_1' ? 'bg-emerald-500 text-white' : 'text-emerald-400 hover:bg-emerald-500/10'}`}
                >
                  {t('studio.solo')}
                </button>
                <button
                  onClick={() => onRunFormat('podcast_2')}
                  disabled={!hostConfigured || isLoading}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${activeFormat === 'podcast_2' ? 'bg-blue-500 text-white' : 'text-blue-400 hover:bg-blue-500/10'}`}
                >
                  {t('studio.duo')}
                </button>
                <button
                  onClick={() => onRunFormat('podcast_3')}
                  disabled={!hostConfigured || isLoading}
                  className={`px-3 py-1 text-xs font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${activeFormat === 'podcast_3' ? 'bg-purple-500 text-white' : 'text-purple-400 hover:bg-purple-500/10'}`}
                >
                  {t('studio.round')}
                </button>
              </div>
              <div className="w-px h-6 bg-app-border mx-1"></div>
              <div className="flex bg-app-bg rounded-lg p-1 border border-app-border">
                {(['Short', 'Medium', 'Long'] as const).map((l) => {
                  const fullLabel = (l === 'Short' ? 'Short (1-2 min)' : l === 'Medium' ? 'Medium (3-5 min)' : 'Long (Deep Dive)') as VoiceSettings['length'];
                  const displayLabel = l === 'Short' ? t('studio.short') : l === 'Medium' ? t('studio.medium') : t('studio.long');
                  return (
                    <button
                      key={l}
                      disabled={!hostConfigured || isLoading}
                      onClick={() => {
                        onUpdateVoiceSettings({ ...voiceSettings, length: fullLabel });
                        onRunFormat(currentFormat, fullLabel);
                      }}
                      className={`px-3 py-1 text-xs font-bold rounded disabled:opacity-40 disabled:cursor-not-allowed ${voiceSettings.length?.startsWith(l) ? 'bg-app-text text-app-bg' : 'text-app-dim hover:text-app-text'}`}
                    >
                      {displayLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Audio Player UI - Only if audio exists */}
        {generatedAudio && (
          <div className="flex flex-col gap-2 bg-app-bg/50 p-3 rounded-xl border border-app-border animate-fade-in">
            <audio
              ref={audioRef}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />

            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-app-text text-app-bg flex items-center justify-center hover:scale-105 transition-transform shadow-lg shadow-app-text/20"
              >
                {isPlaying ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                ) : (
                  <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>

              <div className="flex-1 flex flex-col justify-center">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1.5 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-text"
                />
                <div className="flex justify-between text-[10px] text-app-dim mt-1 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-app-card/80 px-2.5 py-1.5 rounded-full border border-app-border">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-app-dim hover:text-app-text transition-colors shrink-0"
                  title={volume === 0 ? 'Unmute' : 'Mute'}
                  aria-label={volume === 0 ? 'Unmute' : 'Mute'}
                >
                  {volume === 0 ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  aria-label="Volume"
                  title="Adjust volume"
                  className="w-24 sm:w-32 h-1.5 bg-app-border rounded-lg appearance-none cursor-pointer accent-app-text"
                />
                <span className="text-[10px] text-app-dim font-mono w-8 text-right">{Math.round(volume * 100)}%</span>
              </div>

              <button
                onClick={handleDownload}
                className="p-2 text-app-dim hover:text-app-text transition-colors"
                title="Download Audio"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 bg-app-panel/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-app-text border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-app-text font-bold animate-pulse">{t('studio.generating')}</p>
          </div>
        )}
      </div>

      {/* Script Preview */}
      <div className="flex-1 overflow-hidden relative">
        <ArtifactPreview
          code={previewCode}
          onClose={onClosePreview}
          isFullWidth={true}
          theme={currentTheme}
        />
      </div>

      {/* Save/Download Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-app-panel border border-app-border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-scale-in">
            <h3 className="text-xl font-bold text-app-text mb-4">Save Audio</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-app-dim uppercase mb-1">Filename</label>
                <input
                  type="text"
                  value={saveFilename}
                  onChange={(e) => setSaveFilename(e.target.value)}
                  className="w-full bg-app-bg border border-app-border rounded-lg p-3 text-app-text focus:border-app-text focus:outline-none"
                  placeholder="Enter filename..."
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={confirmDownload}
                  className="flex-1 py-3 bg-app-text text-app-bg font-bold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t('studio.download')}
                </button>
                <button
                  onClick={handleSaveAsSource}
                  className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-500 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add to Sources
                </button>
              </div>
              <button
                onClick={() => setShowSaveModal(false)}
                className="w-full py-2 text-app-dim hover:text-app-text text-sm font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Edit Modal */}
      {isEditingScript && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-app-panel border border-app-border rounded-2xl p-6 w-full max-w-4xl h-[80vh] shadow-2xl animate-scale-in flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-app-text flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Interactive Script Editor
              </h3>
              <button onClick={() => setIsEditingScript(false)} className="text-app-dim hover:text-app-text">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 bg-app-bg rounded-lg border border-app-border p-4 mb-4 overflow-hidden flex flex-col">
              <p className="text-xs text-app-dim mb-2">Edit the script below. You can add new speakers (e.g., "Guest: Hello") or modify existing dialogue.</p>
              <textarea
                value={scriptContent}
                onChange={(e) => setScriptContent(e.target.value)}
                className="flex-1 w-full bg-transparent text-app-text font-mono text-sm resize-none focus:outline-none custom-scrollbar leading-relaxed"
                placeholder="Enter script here..."
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsEditingScript(false)}
                className="px-4 py-2 text-app-dim hover:text-app-text font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveScript}
                className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-lg shadow-lg shadow-purple-500/20 transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Regenerate Audio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PodcastResultView;
