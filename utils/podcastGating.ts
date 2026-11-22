/**
 * Pure podcast-gating logic shared by the creator (and unit-tested).
 *
 * Semantics:
 *  - No podcast is produced before the cast is configured or the user presses "Use Default".
 *  - Format is picked LAST, after the cast gate is satisfied.
 *  - If more than one speaker is configured and report (`podcast_1`) is pressed,
 *    only the speaker in position one (host) is used.
 *  - Duo (`podcast_2`) uses 2 speakers (`host` + `expert`) when configured.
 *  - Roundtable (`podcast_3`) uses 3 speakers (`host` + `expert` + `guest`) when configured.
 *
 * A format whose required speakers are NOT configured honestly falls back to a
 * host-only report (it cannot conjure unconfigured speakers).
 */
import type { CastMember, VoiceSettings } from '../types';

export type PodcastFormatId = 'podcast_1' | 'podcast_2' | 'podcast_3';
export type PodcastRole = 'host' | 'expert' | 'guest';

export const ALL_ROLES: PodcastRole[] = ['host', 'expert', 'guest'];

/** Speakers required by a format. Solo needs only the host. */
export function requiredRolesFor(format: PodcastFormatId): PodcastRole[] {
  if (format === 'podcast_2') return ['host', 'expert'];
  if (format === 'podcast_3') return ['host', 'expert', 'guest'];
  return ['host'];
}

export interface PodcastGateInput {
  touchedRoles: PodcastRole[];
  activeFormat: PodcastFormatId | null;
  contentReady: boolean;
  isLoading: boolean;
}

export interface PodcastGateResult {
  /** Host configured (or "Use Default" pressed). */
  hostConfigured: boolean;
  /** More than one speaker configured. */
  multipleConfigured: boolean;
  /** Configured roles (subset of ALL_ROLES). */
  configuredRoles: PodcastRole[];
  /** Required roles minus configured roles. */
  missingRoles: PodcastRole[];
  /** Only position one (host) will be used. */
  hostOnly: boolean;
  /** Speaker count for audio/script generation. */
  speakerCount: 1 | 2 | 3;
  /** Generate is allowed. */
  canGenerate: boolean;
  /** Why generate is disabled / what step is missing. */
  gateHint: 'configure' | 'pickFormat' | 'content' | '';
}

export function computePodcastGate({ touchedRoles, activeFormat, contentReady, isLoading }: PodcastGateInput): PodcastGateResult {
  const configuredRoles = ALL_ROLES.filter(r => touchedRoles.includes(r));
  const hostConfigured = touchedRoles.includes('host');
  const multipleConfigured = configuredRoles.length > 1;

  const requiredRoles = activeFormat ? requiredRolesFor(activeFormat) : ['host'] as PodcastRole[];
  const missingRoles = requiredRoles.filter(r => !configuredRoles.includes(r));
  const hostOnly = (activeFormat === 'podcast_1' && multipleConfigured) || missingRoles.length > 0;

  const canGenerate = hostConfigured && activeFormat !== null && contentReady && !isLoading;

  const gateHint = !hostConfigured
    ? 'configure'
    : !activeFormat
      ? 'pickFormat'
      : !contentReady
        ? 'content'
        : '';

  const baseCount = activeFormat === 'podcast_2' ? 2 : activeFormat === 'podcast_3' ? 3 : 1;

  return {
    hostConfigured,
    multipleConfigured,
    configuredRoles,
    missingRoles,
    hostOnly,
    speakerCount: hostOnly ? 1 : baseCount as 1 | 2 | 3,
    canGenerate,
    gateHint,
  };
}

interface DefaultCharacterPreset {
  id: string;
  name: string;
  voice: string;
  bio: string;
  avatar: string;
  gender: 'Female' | 'Male';
}

const ENGLISH_STAGGERED_DEFAULTS: Record<PodcastRole, DefaultCharacterPreset> = {
  host: {
    id: 'sys-host-1',
    name: 'Narrator Bot',
    voice: 'Kore',
    bio: 'A clear, authoritative, and friendly voice, perfect for hosting and guiding the listener through complex topics.',
    avatar: 'https://picsum.photos/seed/narrator/60/60',
    gender: 'Female',
  },
  expert: {
    id: 'sys-expert-1',
    name: 'Dr. Insight',
    voice: 'Puck',
    bio: 'A knowledgeable and articulate voice, ideal for explaining intricate details and offering expert opinions.',
    avatar: 'https://picsum.photos/seed/expert/60/60',
    gender: 'Male',
  },
  guest: {
    id: 'sys-guest-1',
    name: 'Curious Listener',
    voice: 'Zephyr',
    bio: 'An engaging and inquisitive voice, representing the audience and asking clarifying questions.',
    avatar: 'https://picsum.photos/seed/listener/60/60',
    gender: 'Female',
  },
};

const SWEDISH_STAGGERED_DEFAULTS: Record<PodcastRole, DefaultCharacterPreset> = {
  host: {
    id: 'sys-host-sv-1',
    name: 'Lars (Värd)',
    voice: 'Fenrir',
    bio: 'En karismatisk och erfaren programledare för podcasts på svenska. Tydlig och engagerande stämma.',
    avatar: 'https://picsum.photos/seed/lars/60/60',
    gender: 'Male',
  },
  expert: {
    id: 'sys-expert-sv-1',
    name: 'Elena (Expert)',
    voice: 'Zephyr',
    bio: 'En sakkunnig expert som förklarar komplexa ämnen på ett pedagogiskt sätt på svenska. Lugn och saklig.',
    avatar: 'https://picsum.photos/seed/elena/60/60',
    gender: 'Female',
  },
  guest: {
    id: 'sys-oskar-sv-1',
    name: 'Oskar (Affär)',
    voice: 'Puck',
    bio: 'En seriös men varm röst som passar för affärsanalys och djupgående intervjuer.',
    avatar: 'https://picsum.photos/seed/oskar/60/60',
    gender: 'Male',
  },
};

const pickFromLibrary = (
  preset: DefaultCharacterPreset,
  oppositeGender: 'Female' | 'Male',
  isSwedish: boolean,
  usedIds: Set<string>,
  castLibrary?: CastMember[],
): DefaultCharacterPreset => {
  if (!castLibrary?.length) return preset;
  const exact = castLibrary.find((m) => m.id === preset.id);
  if (exact && (exact.gender === preset.gender || !exact.gender)) {
    usedIds.add(exact.id);
    return {
      id: exact.id,
      name: exact.name,
      voice: exact.voice,
      bio: exact.bio,
      avatar: exact.avatar || preset.avatar,
      gender: (exact.gender === 'Male' || exact.gender === 'Female') ? exact.gender : preset.gender,
    };
  }
  const match = castLibrary.find((m) => {
    if (usedIds.has(m.id)) return false;
    const langMatch = isSwedish ? m.id.includes('-sv-') : !m.id.includes('-sv-');
    return langMatch && m.gender !== oppositeGender;
  });
  if (match) {
    usedIds.add(match.id);
    return {
      id: match.id,
      name: match.name,
      voice: match.voice,
      bio: match.bio,
      avatar: match.avatar || preset.avatar,
      gender: preset.gender,
    };
  }
  return preset;
};

/**
 * Builds VoiceSettings with the first 3 character slots (host, expert, guest)
 * populated and staggered between Male and Female:
 *  - English: Female (Kore / Narrator Bot) -> Male (Puck / Dr. Insight) -> Female (Zephyr / Curious Listener)
 *  - Swedish: Male (Fenrir / Lars) -> Female (Zephyr / Elena) -> Male (Puck / Oskar)
 */
export function buildStaggeredDefaultVoiceSettings(
  current: VoiceSettings,
  castLibrary?: CastMember[],
  options?: { shortSwedishLabels?: boolean },
): {
  voiceSettings: VoiceSettings;
  touchedRoles: PodcastRole[];
  selectedIds: Record<PodcastRole, string>;
} {
  const isSv = current.language === 'Swedish';
  const base = isSv ? SWEDISH_STAGGERED_DEFAULTS : ENGLISH_STAGGERED_DEFAULTS;
  const usedIds = new Set<string>();

  const host = pickFromLibrary(base.host, base.host.gender === 'Female' ? 'Male' : 'Female', isSv, usedIds, castLibrary);
  const expert = pickFromLibrary(base.expert, host.gender, isSv, usedIds, castLibrary);
  const guest = pickFromLibrary(base.guest, expert.gender, isSv, usedIds, castLibrary);

  const labelFor = (preset: DefaultCharacterPreset) =>
    isSv && options?.shortSwedishLabels ? preset.name.replace(/\s*\(.*?\)\s*$/, '').trim() : preset.name;

  return {
    voiceSettings: {
      ...current,
      host: host.voice,
      hostLabel: labelFor(host),
      hostAvatar: host.avatar,
      hostBio: host.bio,
      hostMemberId: host.id,
      expert: expert.voice,
      expertLabel: labelFor(expert),
      expertAvatar: expert.avatar,
      expertBio: expert.bio,
      expertMemberId: expert.id,
      guest: guest.voice,
      guestLabel: labelFor(guest),
      guestAvatar: guest.avatar,
      guestBio: guest.bio,
      guestMemberId: guest.id,
    },
    touchedRoles: ['host', 'expert', 'guest'],
    selectedIds: {
      host: host.id,
      expert: expert.id,
      guest: guest.id,
    },
  };
}

