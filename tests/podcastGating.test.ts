import { describe, it, expect } from 'vitest';
import {
  computePodcastGate,
  requiredRolesFor,
  buildStaggeredDefaultVoiceSettings,
  type PodcastRole,
} from '../utils/podcastGating';
import type { VoiceSettings } from '../types';

const baseVoice: VoiceSettings = {
  host: '',
  hostLabel: '',
  expert: '',
  expertLabel: '',
  guest: '',
  guestLabel: '',
  language: 'English',
};

describe('requiredRolesFor', () => {
  it('Solo needs only the host', () => {
    expect(requiredRolesFor('podcast_1')).toEqual(['host']);
  });
  it('Duo needs host and expert', () => {
    expect(requiredRolesFor('podcast_2')).toEqual(['host', 'expert']);
  });
  it('Roundtable needs host, expert and guest', () => {
    expect(requiredRolesFor('podcast_3')).toEqual(['host', 'expert', 'guest']);
  });
});

describe('computePodcastGate', () => {
  it('blocks generation until the host is configured', () => {
    const gate = computePodcastGate({
      touchedRoles: [],
      activeFormat: 'podcast_1',
      contentReady: true,
      isLoading: false,
    });
    expect(gate.hostConfigured).toBe(false);
    expect(gate.canGenerate).toBe(false);
    expect(gate.gateHint).toBe('configure');
  });

  it('blocks generation until a format is picked', () => {
    const gate = computePodcastGate({
      touchedRoles: ['host'],
      activeFormat: null,
      contentReady: true,
      isLoading: false,
    });
    expect(gate.canGenerate).toBe(false);
    expect(gate.gateHint).toBe('pickFormat');
  });

  it('blocks generation until content is ready', () => {
    const gate = computePodcastGate({
      touchedRoles: ['host'],
      activeFormat: 'podcast_1',
      contentReady: false,
      isLoading: false,
    });
    expect(gate.canGenerate).toBe(false);
    expect(gate.gateHint).toBe('content');
  });

  it('blocks generation while loading', () => {
    const gate = computePodcastGate({
      touchedRoles: ['host'],
      activeFormat: 'podcast_1',
      contentReady: true,
      isLoading: true,
    });
    expect(gate.canGenerate).toBe(false);
    expect(gate.gateHint).toBe('');
  });

  it('allows generation when gated correctly', () => {
    const gate = computePodcastGate({
      touchedRoles: ['host'],
      activeFormat: 'podcast_1',
      contentReady: true,
      isLoading: false,
    });
    expect(gate.canGenerate).toBe(true);
    expect(gate.hostOnly).toBe(false);
    expect(gate.speakerCount).toBe(1);
    expect(gate.gateHint).toBe('');
  });

  it('uses ONLY the host (position one) for Solo/Report when multiple speakers are configured', () => {
    const gate = computePodcastGate({
      touchedRoles: ['host', 'expert', 'guest'],
      activeFormat: 'podcast_1',
      contentReady: true,
      isLoading: false,
    });
    expect(gate.multipleConfigured).toBe(true);
    expect(gate.hostOnly).toBe(true);
    expect(gate.speakerCount).toBe(1);
    expect(gate.canGenerate).toBe(true);
  });

  it('allows 2 speakers for Duo and 3 speakers for Roundtable when required roles are configured', () => {
    const duo = computePodcastGate({
      touchedRoles: ['host', 'expert', 'guest'],
      activeFormat: 'podcast_2',
      contentReady: true,
      isLoading: false,
    });
    expect(duo.hostOnly).toBe(false);
    expect(duo.speakerCount).toBe(2);
    expect(duo.canGenerate).toBe(true);

    const roundtable = computePodcastGate({
      touchedRoles: ['host', 'expert', 'guest'],
      activeFormat: 'podcast_3',
      contentReady: true,
      isLoading: false,
    });
    expect(roundtable.hostOnly).toBe(false);
    expect(roundtable.speakerCount).toBe(3);
    expect(roundtable.canGenerate).toBe(true);
  });

  it('is host-only when a format needs a speaker that is not configured', () => {
    const gate = computePodcastGate({
      touchedRoles: ['host'] as PodcastRole[],
      activeFormat: 'podcast_2',
      contentReady: true,
      isLoading: false,
    });
    expect(gate.missingRoles).toEqual(['expert']);
    expect(gate.hostOnly).toBe(true);
    expect(gate.speakerCount).toBe(1);
    expect(gate.canGenerate).toBe(true);
  });

  it('handles no roles configured', () => {
    const gate = computePodcastGate({
      touchedRoles: [],
      activeFormat: null,
      contentReady: false,
      isLoading: false,
    });
    expect(gate.hostConfigured).toBe(false);
    expect(gate.canGenerate).toBe(false);
    expect(gate.configuredRoles).toEqual([]);
  });
});

describe('buildStaggeredDefaultVoiceSettings', () => {
  it('inserts 3 staggered Female -> Male -> Female defaults for English', () => {
    const res = buildStaggeredDefaultVoiceSettings({ ...baseVoice, language: 'English' });
    expect(res.touchedRoles).toEqual(['host', 'expert', 'guest']);
    // Kore (Female), Puck (Male), Zephyr (Female)
    expect(res.voiceSettings.host).toBe('Kore');
    expect(res.voiceSettings.expert).toBe('Puck');
    expect(res.voiceSettings.guest).toBe('Zephyr');
    expect(res.voiceSettings.hostMemberId).toBe('sys-host-1');
    expect(res.voiceSettings.expertMemberId).toBe('sys-expert-1');
    expect(res.voiceSettings.guestMemberId).toBe('sys-guest-1');
  });

  it('inserts 3 staggered Male -> Female -> Male defaults for Swedish', () => {
    const res = buildStaggeredDefaultVoiceSettings({ ...baseVoice, language: 'Swedish' });
    expect(res.touchedRoles).toEqual(['host', 'expert', 'guest']);
    // Fenrir (Male), Zephyr (Female), Puck (Male)
    expect(res.voiceSettings.host).toBe('Fenrir');
    expect(res.voiceSettings.expert).toBe('Zephyr');
    expect(res.voiceSettings.guest).toBe('Puck');
    expect(res.voiceSettings.hostMemberId).toBe('sys-host-sv-1');
    expect(res.voiceSettings.expertMemberId).toBe('sys-expert-sv-1');
    expect(res.voiceSettings.guestMemberId).toBe('sys-oskar-sv-1');
  });
});

