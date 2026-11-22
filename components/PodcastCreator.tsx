import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CastMember, Session, ThemeSettings, VoiceSettings } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { computePodcastGate, requiredRolesFor, buildStaggeredDefaultVoiceSettings } from '../utils/podcastGating';
import { AutoPodcastDraftResult, loadAutoPodcastDraftFromStore } from '../utils/podcastSources';

type FormatId = 'podcast_1' | 'podcast_2' | 'podcast_3';
type Role = 'host' | 'expert' | 'guest';
type GenderFilter = 'All' | 'Female' | 'Male';

interface PodcastCreatorProps {
  voiceSettings: VoiceSettings;
  onUpdateVoiceSettings: (settings: VoiceSettings) => void;
  onRunTool: (toolId: string, payload?: any) => void;
  isLoading: boolean;
  hasActiveSession: boolean;
  session?: Session | null;
  draftRevision?: number;
  castLibrary: CastMember[];
  setIsCastLibraryOpen: (isOpen: boolean) => void;
  activeFormat: FormatId | null;
  onSelectFormat: (format: FormatId) => void;
  onOpenHistory: () => void;
  onOpenPrompts: () => void;
  /** Roles the user explicitly configured (host/expert/guest) — owned by the parent so the player header honors the same rule. */
  touchedRoles: Role[];
  setTouchedRoles: React.Dispatch<React.SetStateAction<Role[]>>;
  /** Optional controlled topic/content input (lifted so PromptLibraryModal & quick-regenerate share it). */
  customInput?: string;
  onChangeCustomInput?: (value: string) => void;
  includeSessionData?: boolean;
  onChangeIncludeSessionData?: (value: boolean) => void;
  audioProvider?: ThemeSettings['provider'];
  onChangeAudioProvider?: (provider: 'maggi' | 'gemini') => void;
}

const STANDARD_NAMES = ['Sax', 'Chameleon', 'The Pinpoint', 'Lars', 'Elena', 'Astrid', 'Oskar', 'Freja', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Aoede', 'Narrator Bot', 'Dr. Insight', 'Curious Listener'];

const castMemberMatchesLanguage = (m: CastMember, role: Role, language: string | undefined): boolean => {
  if (language === 'Swedish') {
    if (role === 'host') return m.name.includes('Lars') || m.id.includes('-sv-');
    if (role === 'expert') return m.name.includes('Elena') || m.id.includes('-sv-');
    return m.id.includes('-sv-');
  }
  return !m.id.includes('-sv-');
};

/** Picks the system default cast for the current language, falling back to English. */
const defaultCastMemberFor = (role: Role, castLibrary: CastMember[], language: string | undefined): CastMember | null => {
  const sv = language === 'Swedish';
  const candidates = role === 'host'
    ? (sv ? ['sys-host-sv-1', 'sys-host-1'] : ['sys-host-1', 'sys-host-sv-1'])
    : role === 'expert'
      ? (sv ? ['sys-expert-sv-1', 'sys-expert-1'] : ['sys-expert-1', 'sys-expert-sv-1'])
      : (sv ? ['sys-oskar-sv-1', 'sys-guest-1'] : ['sys-guest-1', 'sys-oskar-sv-1']);
  for (const id of candidates) {
    const member = castLibrary.find(m => m.id === id);
    if (member) return member;
  }
  return null;
};

const roleLabelKey = (role: Role) => (`${role}Label`) as 'hostLabel' | 'expertLabel' | 'guestLabel';
const roleBioKey = (role: Role) => (`${role}Bio`) as 'hostBio' | 'expertBio' | 'guestBio';
const roleAvatarKey = (role: Role) => (`${role}Avatar`) as 'hostAvatar' | 'expertAvatar' | 'guestAvatar';
const roleMemberIdKey = (role: Role) => (`${role}MemberId`) as 'hostMemberId' | 'expertMemberId' | 'guestMemberId';

const PodcastCreator: React.FC<PodcastCreatorProps> = ({
  voiceSettings,
  onUpdateVoiceSettings,
  onRunTool,
  isLoading,
  hasActiveSession,
  session,
  draftRevision,
  castLibrary,
  setIsCastLibraryOpen,
  activeFormat,
  onSelectFormat,
  onOpenHistory,
  onOpenPrompts,
  touchedRoles,
  setTouchedRoles,
  customInput,
  onChangeCustomInput,
  includeSessionData,
  onChangeIncludeSessionData,
  audioProvider,
  onChangeAudioProvider,
}) => {
  const { t } = useLanguage();

  const [localCustomInput, setLocalCustomInput] = useState('');
  const [localIncludeSessionData, setLocalIncludeSessionData] = useState(hasActiveSession);

  const podcastCustomInput = customInput !== undefined ? customInput : localCustomInput;
  const setPodcastCustomInput = onChangeCustomInput || setLocalCustomInput;
  const podcastIncludeSessionData = includeSessionData !== undefined ? includeSessionData : localIncludeSessionData;
  const setPodcastIncludeSessionData = onChangeIncludeSessionData || setLocalIncludeSessionData;

  const [sourceSummary, setSourceSummary] = useState<AutoPodcastDraftResult | null>(null);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const userEditedInputRef = useRef(false);
  const lastAutoInsertedRef = useRef('');
  const lastDraftRevisionRef = useRef<number | undefined>(draftRevision);

  const [selectedHostCastMemberId, setSelectedHostCastMemberId] = useState<string | null>(null);
  const [selectedExpertCastMemberId, setSelectedExpertCastMemberId] = useState<string | null>(null);
  const [selectedGuestCastMemberId, setSelectedGuestCastMemberId] = useState<string | null>(null);
  const [hostGenderFilter, setHostGenderFilter] = useState<GenderFilter>('All');
  const [expertGenderFilter, setExpertGenderFilter] = useState<GenderFilter>('All');
  const [guestGenderFilter, setGuestGenderFilter] = useState<GenderFilter>('All');
  const [showBios, setShowBios] = useState(false);

  const FORMAT_OPTIONS: Array<{ id: FormatId; title: string; subtitle: string; accent: string }> = [
    { id: 'podcast_1', title: t('studio.solo'), subtitle: t('studio.soloSubtitle'), accent: 'emerald' },
    { id: 'podcast_2', title: t('studio.duo'), subtitle: t('studio.duoSubtitle'), accent: 'blue' },
    { id: 'podcast_3', title: t('studio.roundtable'), subtitle: t('studio.roundtableSubtitle'), accent: 'purple' },
  ];

  const touchRole = (role: Role) => setTouchedRoles(prev => (prev.includes(role) ? prev : [...prev, role]));
  const untouchRole = (role: Role) => setTouchedRoles(prev => prev.filter(r => r !== role));

  useEffect(() => {
    setPodcastIncludeSessionData(hasActiveSession);
  }, [hasActiveSession]);

  const syncSourcesIntoInput = useCallback(async (forceReplace = false) => {
    setIsLoadingSources(true);
    try {
      const result = await loadAutoPodcastDraftFromStore(session);
      setSourceSummary(result);
      if (result.draft) {
        const shouldInsert =
          forceReplace ||
          (!userEditedInputRef.current &&
            (!podcastCustomInput.trim() || podcastCustomInput === lastAutoInsertedRef.current));
        if (shouldInsert) {
          userEditedInputRef.current = false;
          lastAutoInsertedRef.current = result.draft;
          setPodcastCustomInput(result.draft);
        }
      }
    } catch (err) {
      console.warn('Failed to auto-load session & MAGGI contents:', err);
    } finally {
      setIsLoadingSources(false);
    }
  }, [session, podcastCustomInput, setPodcastCustomInput]);

  useEffect(() => {
    if (draftRevision && draftRevision !== lastDraftRevisionRef.current) {
      lastDraftRevisionRef.current = draftRevision;
      userEditedInputRef.current = false;
      lastAutoInsertedRef.current = podcastCustomInput;
    }
  }, [draftRevision, podcastCustomInput]);

  useEffect(() => {
    void syncSourcesIntoInput(false);
  }, [session?.id, session?.mediaItems.length, session?.selectedMediaIds.length, draftRevision]);

  // Sync selection state with voice settings. Only roles the user actually
  // configured are re-synced; unconfigured roles keep their empty selection.
  useEffect(() => {
    const isSwedish = voiceSettings.language === 'Swedish';
    const roleVoice: Record<Role, string | undefined> = {
      host: voiceSettings.host,
      expert: voiceSettings.expert,
      guest: voiceSettings.guest,
    };
    (['host', 'expert', 'guest'] as Role[]).forEach(role => {
      const setter = role === 'host' ? setSelectedHostCastMemberId : role === 'expert' ? setSelectedExpertCastMemberId : setSelectedGuestCastMemberId;
      if (!touchedRoles.includes(role)) {
        setter(null);
        return;
      }
      const explicitMemberId = voiceSettings[roleMemberIdKey(role)];
      if (explicitMemberId) {
        const explicitMember = castLibrary.find(m => m.id === explicitMemberId);
        if (explicitMember && castMemberMatchesLanguage(explicitMember, role, voiceSettings.language)) {
          setter(explicitMember.id);
          return;
        }
      }
      const voice = roleVoice[role];
      if (!voice) return;
      const currentId = role === 'host' ? selectedHostCastMemberId : role === 'expert' ? selectedExpertCastMemberId : selectedGuestCastMemberId;
      const currentCM = currentId ? castLibrary.find(m => m.id === currentId) : null;
      if (currentId && currentCM?.voice === voice && castMemberMatchesLanguage(currentCM, role, voiceSettings.language)) return;
      const match = castLibrary.find(m => {
        if (role === 'host') {
          return isSwedish ? (m.voice === voice && (m.id.includes('-sv-') || m.name.includes('Lars') || m.name.includes('Elena'))) : (m.voice === voice && !m.id.includes('-sv-'));
        }
        if (role === 'expert') {
          return isSwedish ? (m.voice === voice && (m.id.includes('-sv-') || m.name.includes('Elena') || m.name.includes('Astrid'))) : (m.voice === voice && !m.id.includes('-sv-'));
        }
        return isSwedish ? (m.voice === voice && (m.id.includes('-sv-') || m.name.includes('Astrid') || m.name.includes('Oskar') || m.name.includes('Freja'))) : (m.voice === voice && !m.id.includes('-sv-'));
      });
      setter(match ? match.id : null);
    });
  }, [voiceSettings, castLibrary, touchedRoles, selectedHostCastMemberId, selectedExpertCastMemberId, selectedGuestCastMemberId]);

  const handleLanguageChange = (lang: 'English' | 'Swedish') => {
    const nextSettings: VoiceSettings = { ...voiceSettings, language: lang };
    // If host (or other configured role) was using a system default cast member,
    // remap it smoothly to the new language's system default cast.
    (['host', 'expert', 'guest'] as Role[]).forEach(role => {
      if (!touchedRoles.includes(role)) return;
      const currentMemberId = voiceSettings[roleMemberIdKey(role)];
      const currentMember = currentMemberId ? castLibrary.find(m => m.id === currentMemberId) : null;
      if (currentMember && !castMemberMatchesLanguage(currentMember, role, lang) && currentMember.id.startsWith('sys-')) {
        const mapped = defaultCastMemberFor(role, castLibrary, lang);
        if (mapped) {
          nextSettings[role] = mapped.voice;
          nextSettings[roleLabelKey(role)] = mapped.name;
          nextSettings[roleAvatarKey(role)] = mapped.avatar;
          nextSettings[roleBioKey(role)] = mapped.bio;
          nextSettings[roleMemberIdKey(role)] = mapped.id;
        }
      }
    });
    onUpdateVoiceSettings(nextSettings);
  };

  const handleAvatarUpload = (role: Role, file: File) => {
    touchRole(role);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      onUpdateVoiceSettings({ ...voiceSettings, [roleAvatarKey(role)]: result });
    };
    reader.readAsDataURL(file);
  };

  const handleClearRole = (role: Role) => {
    untouchRole(role);
    const setSelected = role === 'host' ? setSelectedHostCastMemberId : role === 'expert' ? setSelectedExpertCastMemberId : setSelectedGuestCastMemberId;
    setSelected(null);
    onUpdateVoiceSettings({
      ...voiceSettings,
      [roleMemberIdKey(role)]: undefined,
    });
  };

  const handleCastMemberSelect = (role: Role, selectedId: string) => {
    if (!selectedId) {
      handleClearRole(role);
      return;
    }
    touchRole(role);
    const setSelected = role === 'host' ? setSelectedHostCastMemberId : role === 'expert' ? setSelectedExpertCastMemberId : setSelectedGuestCastMemberId;
    setSelected(selectedId);
    const selectedMember = castLibrary.find(m => m.id === selectedId);
    if (!selectedMember) return;
    const isCurrentlyConfigured = touchedRoles.includes(role);
    const currentLabel = isCurrentlyConfigured ? (voiceSettings[roleLabelKey(role)] || '') : '';
    const isCustom = currentLabel && !STANDARD_NAMES.includes(currentLabel);
    const updates: any = {
      [role]: selectedMember.voice,
      [roleAvatarKey(role)]: selectedMember.avatar,
      [roleBioKey(role)]: selectedMember.bio,
      [roleMemberIdKey(role)]: selectedMember.id,
    };
    if (!isCustom) updates[roleLabelKey(role)] = selectedMember.name;
    onUpdateVoiceSettings({ ...voiceSettings, ...updates });
  };

  const handleUseDefault = () => {
    // "Use default" inserts default characters for the first 3 slots
    // (host, expert, guest), staggered between Male and Female voices.
    const { voiceSettings: nextVoiceSettings, touchedRoles: nextTouched, selectedIds } =
      buildStaggeredDefaultVoiceSettings(voiceSettings, castLibrary);

    onUpdateVoiceSettings(nextVoiceSettings);
    setSelectedHostCastMemberId(selectedIds.host);
    setSelectedExpertCastMemberId(selectedIds.expert);
    setSelectedGuestCastMemberId(selectedIds.guest);
    setTouchedRoles(nextTouched);
  };

  // --- Gate: no podcast is produced until the cast is configured or the user presses "Use Default" ---
  const contentReady = podcastCustomInput.trim().length > 0 || (hasActiveSession && podcastIncludeSessionData);
  const gate = computePodcastGate({ touchedRoles, activeFormat, contentReady, isLoading });
  const { configuredRoles, hostConfigured, multipleConfigured, missingRoles, hostOnly, canGenerate, gateHint } = gate;

  const gateHintText = gateHint === 'configure'
    ? t('studio.configureSpeakersHint')
    : gateHint === 'pickFormat'
      ? t('studio.pickFormatHint')
      : gateHint === 'content'
        ? t('studio.contentHint')
        : '';

  const handleGenerate = () => {
    if (!canGenerate || !activeFormat) return;
    onRunTool(activeFormat, {
      isIndependent: true,
      includeSessionData: hasActiveSession && podcastIncludeSessionData,
      customInput: podcastCustomInput,
      hostOnly,
      speakerCount: gate.speakerCount,
    });
  };

  const renderGenderFilter = (filter: GenderFilter, setter: (g: GenderFilter) => void) => (
    <div className="flex gap-1 bg-zinc-950 px-1 py-0.5 rounded border border-zinc-800">
      {(['All', 'Female', 'Male'] as const).map(g => (
        <button
          key={g}
          type="button"
          onClick={() => setter(g)}
          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${filter === g ? 'bg-purple-500 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {g === 'Female' && '♀ '}
          {g === 'Male' && '♂ '}
          {g}
        </button>
      ))}
    </div>
  );

  const castCard = (role: Role, title: string, accent: 'host' | 'expert' | 'guest', iconLetter: string) => {
    const labelKey = roleLabelKey(role);
    const bioKey = roleBioKey(role);
    const avatarKey = roleAvatarKey(role);
    const isConfigured = touchedRoles.includes(role);
    const selectedId = role === 'host' ? selectedHostCastMemberId : role === 'expert' ? selectedExpertCastMemberId : selectedGuestCastMemberId;
    const genderFilter = role === 'host' ? hostGenderFilter : role === 'expert' ? expertGenderFilter : guestGenderFilter;
    const setGenderFilter = role === 'host' ? setHostGenderFilter : role === 'expert' ? setExpertGenderFilter : setGuestGenderFilter;
    const options = castLibrary.filter(m => {
      if (!castMemberMatchesLanguage(m, role, voiceSettings.language)) return false;
      if (genderFilter !== 'All') return (m.gender || 'Female') === genderFilter;
      return true;
    });
    // Only display configured cast values when the role is actually configured;
    // unconfigured cards stay blank so "Not configured" is honest and accurate.
    const displayName = isConfigured ? (voiceSettings[labelKey] || '') : '';
    const bio = isConfigured ? (voiceSettings[bioKey] || '') : '';
    const avatar = isConfigured ? voiceSettings[avatarKey] : undefined;
    const bgClass = accent === 'host' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : accent === 'expert' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    const borderFocus = accent === 'host' ? 'focus:border-purple-500' : accent === 'expert' ? 'focus:border-cyan-500' : 'focus:border-amber-500';
    const avatarAlt = role === 'host' ? 'Host' : role === 'expert' ? 'Expert' : 'Guest';

    return (
      <div key={role} className="flex items-start gap-3 p-3 rounded-lg bg-app-card border border-app-border">
        <div className="relative group cursor-pointer shrink-0">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden border ${bgClass}`}>
            {avatar ? (
              <img src={avatar} alt={avatarAlt} className="w-full h-full object-cover" />
            ) : (
              iconLetter
            )}
          </div>
          <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          </div>
          <input
            type="file"
            accept="image/*"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => e.target.files?.[0] && handleAvatarUpload(role, e.target.files[0])}
          />
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <div className="text-[10px] font-bold text-app-dim uppercase flex items-center gap-2 flex-wrap">
                    {title}
                    {(role === 'expert' || role === 'guest') && (
                      <span className="ml-1 text-[8px] text-zinc-500 font-normal uppercase">{t('studio.optional')}</span>
                    )}
                    <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${isConfigured ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
                      {isConfigured ? t('studio.configured') : t('studio.notConfigured')}
                    </span>
                    {isConfigured && (
                      <button
                        type="button"
                        onClick={() => handleClearRole(role)}
                        className="text-[9px] text-zinc-500 hover:text-red-400 transition-colors font-semibold uppercase"
                        title={t('studio.clear')}
                      >
                        × {t('studio.clear')}
                      </button>
                    )}
                  </div>
                  {renderGenderFilter(genderFilter, setGenderFilter)}
                </div>
                <select
                  value={isConfigured ? (selectedId || '') : ''}
                  onChange={(e) => handleCastMemberSelect(role, e.target.value)}
                  className="bg-app-bg border border-app-border text-sm text-app-text rounded px-2 py-1 focus:outline-none w-full"
                >
                  <option value="">{t('studio.selectCastMember')}</option>
                  {options.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.gender === 'Male' ? '♂' : '♀'} {member.name} ({member.voice} - {member.gender || 'Female'})
                    </option>
                  ))}
                </select>
                <div className="mt-2">
                  <div className="text-[10px] font-bold text-app-dim uppercase">{t('studio.displayName')}</div>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!isConfigured && val.trim()) {
                        const fallbackMember = defaultCastMemberFor(role, castLibrary, voiceSettings.language);
                        touchRole(role);
                        onUpdateVoiceSettings({
                          ...voiceSettings,
                          [role]: voiceSettings[role] || fallbackMember?.voice || 'Kore',
                          [labelKey]: val,
                        });
                      } else {
                        touchRole(role);
                        onUpdateVoiceSettings({ ...voiceSettings, [labelKey]: val });
                      }
                    }}
                    placeholder="Rename Character..."
                    className={`bg-app-bg border border-app-border text-xs text-app-text rounded px-3 py-1.5 focus:outline-none w-full ${borderFocus} transition-colors`}
                  />
                </div>
              </div>
            </div>
          </div>
          {showBios && (
            <div className="animate-fade-in">
              <div className="text-[10px] font-bold text-app-dim uppercase mb-1">{t('studio.bioVibe')}</div>
              <textarea
                value={bio}
                onChange={(e) => {
                  touchRole(role);
                  onUpdateVoiceSettings({ ...voiceSettings, [bioKey]: e.target.value });
                }}
                className={`w-full bg-black/40 border border-app-border rounded-lg p-3 text-xs text-app-text focus:outline-none ${borderFocus} resize-none h-20 placeholder-white/20 shadow-inner`}
                placeholder="Describe personality..."
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-app-text flex items-center gap-3">
            <span className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </span>
            {t('studio.podcastCreator')}
          </h2>
          <button
            onClick={onOpenHistory}
            className="px-3 py-1.5 bg-app-card hover:bg-emerald-500/10 border border-app-border hover:border-emerald-500/50 rounded-lg text-xs font-bold text-emerald-500/70 hover:text-emerald-400 transition-colors flex items-center gap-2 mr-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('studio.history')}
          </button>
          <button
            onClick={onOpenPrompts}
            className="px-3 py-1.5 bg-app-card hover:bg-blue-500/10 border border-app-border hover:border-blue-500/50 rounded-lg text-xs font-bold text-blue-500/70 hover:text-blue-400 transition-colors flex items-center gap-2 mr-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {t('studio.prompts')}
          </button>
          <button
            onClick={() => setIsCastLibraryOpen(true)}
            className="px-3 py-1.5 bg-app-card hover:bg-purple-500/10 border border-app-border hover:border-purple-500/50 rounded-lg text-xs font-bold text-purple-500/70 hover:text-purple-400 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.149-1.268.432-1.828M14 10a6 6 0 01-6 6H6a6 6 0 01-6-6V7a3 3 0 013-3h7a3 3 0 013 3v3zm-4 0a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
            {t('studio.cast')}
          </button>
        </div>
        <p className="text-app-dim mb-6">
          {t('studio.podcastCreatorDesc')}
        </p>

        <div className="space-y-6">
          {/* Step 1 — Cast Configuration */}
          <div className="space-y-4 pt-4 border-t border-app-border">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs font-bold text-app-dim uppercase tracking-wider">
                <span className="text-emerald-400">Step 1</span> — {t('studio.step1CastConfig')}
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleUseDefault}
                  className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  title="Insert staggered Male/Female default characters into Host, Expert, and Guest"
                >
                  {t('studio.useDefault')}
                </button>
                <button
                  onClick={() => setIsCastLibraryOpen(true)}
                  className="px-2 py-1 bg-purple-500/10 border border-purple-500/30 rounded text-[10px] font-bold text-purple-400 hover:bg-purple-500/20 flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  {t('studio.manageCast')}
                </button>
                <button
                  onClick={() => setShowBios(!showBios)}
                  className="px-2 py-1 bg-app-card border border-app-border rounded text-[10px] font-bold text-app-dim hover:text-app-text flex items-center gap-1 transition-colors"
                >
                  {showBios ? (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      {t('studio.hideBios')}
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      {t('studio.showBios')}
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {castCard('host', t('studio.hostRole'), 'host', 'H')}
              {castCard('expert', t('studio.expertRole'), 'expert', 'E')}
              {castCard('guest', t('studio.guestRole'), 'guest', 'G')}
            </div>
          </div>

          {/* Target Length */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-app-dim uppercase tracking-wider">{t('studio.targetLength')}</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'Short (1-2 min)', label: t('studio.short') },
                { value: 'Medium (3-5 min)', label: t('studio.medium') },
                { value: 'Long (Deep Dive)', label: t('studio.long') },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onUpdateVoiceSettings({ ...voiceSettings, length: value as any })}
                  className={`p-2 rounded-lg border text-xs font-bold transition-all ${voiceSettings.length === value ? 'bg-app-text text-app-bg border-app-text' : 'bg-app-card border-app-border text-app-dim hover:text-app-text'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Language Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-app-dim uppercase tracking-wider">{t('studio.podcastLanguage')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['English', 'Swedish'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => handleLanguageChange(lang)}
                  className={`p-2 rounded-lg border text-xs font-bold transition-all ${voiceSettings.language === lang || (!voiceSettings.language && lang === 'English') ? 'bg-app-text text-app-bg border-app-text' : 'bg-app-card border-app-border text-app-dim hover:text-app-text'}`}
                >
                  {lang === 'Swedish' ? 'Svenska' : 'English'}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — Format (picked last, after the cast is configured) */}
          <div className={`space-y-2 transition-opacity ${hostConfigured ? '' : 'opacity-60'}`}>
            <label className="text-xs font-bold text-app-dim uppercase tracking-wider">
              <span className="text-emerald-400">Step 2</span> — {t('studio.step2Format')}
            </label>
            {!hostConfigured && (
              <div className="flex items-center gap-2 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {t('studio.configureSpeakersHint')}
              </div>
            )}
            <div className={`grid grid-cols-3 gap-2 ${hostConfigured ? '' : 'pointer-events-none select-none'}`}>
              {FORMAT_OPTIONS.map((fmt) => {
                const active = activeFormat === fmt.id;
                const accentBorder = fmt.accent === 'emerald' ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500' : fmt.accent === 'blue' ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500' : 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500';
                const hoverClass = fmt.accent === 'emerald' ? 'hover:border-emerald-500 hover:bg-emerald-500/10' : fmt.accent === 'blue' ? 'hover:border-blue-500 hover:bg-blue-500/10' : 'hover:border-purple-500 hover:bg-purple-500/10';
                const titleClass = fmt.accent === 'emerald' ? 'text-emerald-400' : fmt.accent === 'blue' ? 'text-blue-400' : 'text-purple-400';
                const needs = requiredRolesFor(fmt.id);
                const hasAll = needs.every(r => configuredRoles.includes(r));
                return (
                  <button
                    key={fmt.id}
                    onClick={() => onSelectFormat(fmt.id)}
                    disabled={!hostConfigured}
                    className={`p-3 rounded-lg border transition-all text-left disabled:cursor-not-allowed ${active ? accentBorder : `border-app-border bg-app-card ${hoverClass}`}`}
                  >
                    <div className={`font-bold text-sm ${titleClass} mb-1`}>{fmt.title}</div>
                    <div className="text-[10px] text-app-dim">{fmt.subtitle}</div>
                    {!hasAll && (
                      <div className="text-[9px] text-amber-400/90 mt-1">{t('studio.needs')} {needs.filter(r => !configuredRoles.includes(r as Role)).map(r => r[0].toUpperCase() + r.slice(1)).join(' + ')}</div>
                    )}
                  </button>
                );
              })}
            </div>
            {activeFormat === 'podcast_1' && multipleConfigured && (
              <div className="text-[10px] text-teal-400 bg-teal-500/10 border border-teal-500/30 rounded-lg px-3 py-2">
                {t('studio.soloUsesHostOnly')}
              </div>
            )}
            {missingRoles.length > 0 && (
              <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                {t('studio.missingRolesTip').replace('{roles}', missingRoles.map(r => r[0].toUpperCase() + r.slice(1)).join(' + '))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview / Action Area */}
      <div className="flex flex-col gap-6">
        {/* Standalone Content Input Section */}
        <div className="bg-app-card rounded-xl border border-app-border p-5 text-left space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-app-text flex items-center gap-2 uppercase tracking-wider">
              <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {t('studio.contentTopicInput')}
            </h3>
            {hasActiveSession ? (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={podcastIncludeSessionData}
                  onChange={(e) => setPodcastIncludeSessionData(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-purple-500/50 h-4 w-4"
                />
                <span className="text-xs text-app-dim hover:text-app-text transition-colors">{t('studio.includeSessionData')}</span>
              </label>
            ) : (
              <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded border border-zinc-700">
                {t('studio.customInputOnly')}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap text-[10px]">
            <div className="flex items-center gap-1.5 flex-wrap">
              {sourceSummary?.hasSessionContent && (
                <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30 font-semibold">
                  Session ({sourceSummary.sessionCount})
                </span>
              )}
              {sourceSummary?.hasMaggiContent && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-semibold">
                  MAGGI ({[
                    sourceSummary.maggiDocCount > 0 ? `${sourceSummary.maggiDocCount} docs` : '',
                    sourceSummary.maggiQueryCount > 0 ? `${sourceSummary.maggiQueryCount} saved` : '',
                    sourceSummary.maggiChatCount > 0 ? `${sourceSummary.maggiChatCount} chat` : '',
                  ].filter(Boolean).join(' · ')})
                </span>
              )}
              {!isLoadingSources && !sourceSummary?.hasSessionContent && !sourceSummary?.hasMaggiContent && (
                <span className="text-app-dim">No session or MAGGI sources found yet</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void syncSourcesIntoInput(true)}
                disabled={isLoadingSources}
                className="px-2 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 font-semibold transition-colors disabled:opacity-50"
                title="Reload active Session and MAGGI contents into the input box"
              >
                {isLoadingSources ? 'Loading...' : '↻ Load Session & MAGGI'}
              </button>
              {podcastCustomInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    userEditedInputRef.current = true;
                    setPodcastCustomInput('');
                  }}
                  className="px-2 py-0.5 rounded bg-app-bg hover:bg-red-500/10 border border-app-border hover:border-red-500/30 text-app-dim hover:text-red-300 font-semibold transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <textarea
              value={podcastCustomInput}
              onChange={(e) => {
                userEditedInputRef.current = true;
                setPodcastCustomInput(e.target.value);
              }}
              placeholder="What should the hosts discuss? Session and MAGGI contents are auto-inserted here when available, or type your own topic..."
              className="w-full bg-zinc-950/60 border border-app-border rounded-lg p-3 text-xs text-app-text focus:outline-none focus:border-purple-500/80 resize-none h-44 placeholder-white/20 shadow-inner"
            />
            <div className="flex justify-between items-center text-[10px] text-app-dim">
              <span>{podcastCustomInput.length} {t('studio.characters')}</span>
              <span>{t('studio.sessionDataOptional')}</span>
            </div>
          </div>
        </div>

        <div className="bg-app-bg rounded-xl border border-app-border p-6 flex flex-col items-center justify-center text-center">
          <div className="mb-4 p-3 rounded-full bg-purple-500/10 text-purple-400">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-app-text mb-1">{t('studio.readyToGenerate')}</h3>
          <p className="text-app-dim text-xs mb-4 max-w-xs">
            {t('studio.readyToGenerateDesc')}
          </p>

          {audioProvider && onChangeAudioProvider && (
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-app-border bg-app-panel px-2.5 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-app-dim">Audio Engine:</span>
              <button
                type="button"
                onClick={() => onChangeAudioProvider('maggi')}
                className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                  audioProvider === 'maggi'
                    ? 'bg-emerald-500 text-black shadow-sm'
                    : 'text-app-dim hover:text-app-text'
                }`}
                title="Use FreeLLMAPI (MAGGI) audio resources"
              >
                FreeLLMAPI
              </button>
              <button
                type="button"
                onClick={() => onChangeAudioProvider('gemini')}
                className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                  audioProvider === 'gemini'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-app-dim hover:text-app-text'
                }`}
                title="Use Gemini audio resources"
              >
                Gemini
              </button>
              {audioProvider !== 'maggi' && audioProvider !== 'gemini' && (
                <span className="text-[9px] font-semibold text-amber-400 uppercase">
                  ({audioProvider})
                </span>
              )}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full max-w-xs py-3.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-xl shadow-lg shadow-purple-500/20 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 text-sm"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>{t('studio.generating')}</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{t('studio.generatePodcast')}</span>
              </>
            )}
          </button>
          {gateHintText && (
            <p className="mt-3 text-[11px] text-amber-400 max-w-xs leading-relaxed">{gateHintText}</p>
          )}
          <p className="mt-2 text-[9px] text-app-dim max-w-xs leading-relaxed">
            {t('studio.generationNote')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PodcastCreator;
