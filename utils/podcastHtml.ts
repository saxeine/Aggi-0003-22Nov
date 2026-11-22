/**
 * Pure podcast-script → HTML renderers (extracted from App.tsx).
 */
import type { VoiceSettings } from '../types';

export interface PodcastHtmlOptions {
  script: string;
  voiceSettings: VoiceSettings;
  audioBase64: string | null;
  audioNoticeHtml?: string; // pre-built sticky notice block (e.g. ⚠️ banner)
  audioPlayerHtml?: string; // pre-built sticky audio player block
}

/** Builds per-line color-coded HTML for a podcast script. */
export function buildScriptLinesHtml(script: string, voiceSettings: VoiceSettings): string {
  const lines = script.split('\n');
  let htmlOutput = '<div data-podcast-script style="max-width: 800px; margin: 0 auto;">';

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let style = 'padding: 16px; margin-bottom: 16px; border-radius: 12px; color: #e2e8f0; line-height: 1.6; font-size: 16px;';

    if (trimmed.includes(`**${voiceSettings.hostLabel}:**`) || trimmed.startsWith('**Host:**') || trimmed.startsWith(`${voiceSettings.hostLabel}:`) || trimmed.startsWith('Host:')) {
      style += ' background-color: rgba(168, 85, 247, 0.1); border-left: 4px solid #a855f7; box-shadow: 0 2px 10px rgba(168, 85, 247, 0.05);';
    } else if (trimmed.includes(`**${voiceSettings.expertLabel}:**`) || trimmed.startsWith('**Expert:**') || trimmed.startsWith(`${voiceSettings.expertLabel}:`) || trimmed.startsWith('Expert:')) {
      style += ' background-color: rgba(6, 182, 212, 0.1); border-left: 4px solid #06b6d4; box-shadow: 0 2px 10px rgba(6, 182, 212, 0.05);';
    } else if (trimmed.includes(`**${voiceSettings.guestLabel}:**`) || trimmed.startsWith('**Guest:**') || trimmed.startsWith(`${voiceSettings.guestLabel}:`) || trimmed.startsWith('Guest:')) {
      style += ' background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; box-shadow: 0 2px 10px rgba(245, 158, 11, 0.05);';
    } else {
      style += ' background-color: rgba(30, 41, 59, 0.5); border-left: 4px solid #475569;';
    }

    const content = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #fff; font-weight: 700;">$1</strong>');
    htmlOutput += `<div style="${style}">${content}</div>`;
  });

  htmlOutput += '</div>';
  return htmlOutput;
}

export function buildAudioPlayerHtml(audioBase64: string | null, mimeType: string = 'audio/wav'): string {
  if (!audioBase64) return '';
  const safeMime = mimeType || 'audio/wav';
  return `
                <div class="podcast-player-card" style="background: #1a1a1a; padding: 16px 20px; border-radius: 12px; margin-bottom: 24px; border: 1px solid #333; position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,0.35);">
                    <style>
                      .podcast-player-card .pp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
                      .podcast-player-card .pp-btn { background: #262626; color: #f8fafc !important; border: 1px solid #3f3f46; border-radius: 9999px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; flex-shrink: 0; }
                      .podcast-player-card .pp-btn:hover { background: #3f3f46; }
                      .podcast-player-card .pp-seek-wrap { flex: 1 1 200px; display: flex; align-items: center; gap: 10px; min-width: 160px; }
                      .podcast-player-card .pp-range { -webkit-appearance: auto; appearance: auto; accent-color: #a855f7; cursor: pointer; height: 6px; }
                      .podcast-player-card .pp-time { font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1 !important; white-space: nowrap; }
                      .podcast-player-card .pp-vol-wrap { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 9999px; border: 1px solid #333; }
                      .podcast-player-card .pp-mute { background: transparent; border: none; color: #cbd5e1 !important; cursor: pointer; font-size: 14px; padding: 2px; line-height: 1; }
                      .podcast-player-card .pp-vol-label { font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1 !important; min-width: 34px; text-align: right; }
                    </style>
                    <h3 style="color: #fff; margin-top: 0; margin-bottom: 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Audio Overview</h3>
                    <audio id="podcast-audio-el" preload="metadata" src="data:${safeMime};base64,${audioBase64}" style="display: none;"></audio>
                    <div class="pp-bar">
                      <button type="button" id="pp-play-btn" class="pp-btn" aria-label="Play or Pause" title="Play / Pause">&#9654;</button>
                      <div class="pp-seek-wrap">
                        <input type="range" id="pp-seek" class="pp-range" min="0" max="100" step="0.1" value="0" style="width: 100%;" aria-label="Seek audio" />
                        <span id="pp-time" class="pp-time">0:00 / 0:00</span>
                      </div>
                      <div class="pp-vol-wrap" title="Volume">
                        <button type="button" id="pp-mute-btn" class="pp-mute" aria-label="Mute or Unmute" title="Mute / Unmute">&#128266;</button>
                        <input type="range" id="pp-volume" class="pp-range" min="0" max="1" step="0.01" value="1" style="width: 96px;" aria-label="Volume" title="Adjust volume" />
                        <span id="pp-vol-pct" class="pp-vol-label">100%</span>
                      </div>
                    </div>
                    <script>
                      (function() {
                        var audio = document.getElementById('podcast-audio-el');
                        var playBtn = document.getElementById('pp-play-btn');
                        var seek = document.getElementById('pp-seek');
                        var timeEl = document.getElementById('pp-time');
                        var muteBtn = document.getElementById('pp-mute-btn');
                        var vol = document.getElementById('pp-volume');
                        var volPct = document.getElementById('pp-vol-pct');
                        if (!audio || !playBtn || !seek || !timeEl || !muteBtn || !vol || !volPct) return;
                        var lastVol = 1;
                        function fmt(s) {
                          if (!isFinite(s) || s < 0) return '0:00';
                          var m = Math.floor(s / 60);
                          var r = Math.floor(s % 60);
                          return m + ':' + (r < 10 ? '0' : '') + r;
                        }
                        function syncTime() {
                          var d = isFinite(audio.duration) ? audio.duration : 0;
                          if (d > 0) seek.max = String(d);
                          seek.value = String(audio.currentTime || 0);
                          timeEl.textContent = fmt(audio.currentTime || 0) + ' / ' + fmt(d);
                        }
                        function syncVol(v) {
                          var clamped = Math.max(0, Math.min(1, Number(v)));
                          audio.volume = clamped;
                          audio.muted = clamped === 0;
                          vol.value = String(clamped);
                          volPct.textContent = Math.round(clamped * 100) + '%';
                          muteBtn.innerHTML = clamped === 0 ? '&#128263;' : clamped < 0.5 ? '&#128265;' : '&#128266;';
                          if (clamped > 0) lastVol = clamped;
                        }
                        playBtn.addEventListener('click', function() {
                          if (audio.paused) {
                            audio.play().catch(function(){});
                          } else {
                            audio.pause();
                          }
                        });
                        audio.addEventListener('play', function() { playBtn.innerHTML = '&#10074;&#10074;'; });
                        audio.addEventListener('pause', function() { playBtn.innerHTML = '&#9654;'; });
                        audio.addEventListener('ended', function() { playBtn.innerHTML = '&#9654;'; });
                        audio.addEventListener('loadedmetadata', syncTime);
                        audio.addEventListener('timeupdate', syncTime);
                        seek.addEventListener('input', function() {
                          audio.currentTime = Number(seek.value);
                          syncTime();
                        });
                        vol.addEventListener('input', function() {
                          syncVol(vol.value);
                        });
                        muteBtn.addEventListener('click', function() {
                          syncVol(audio.volume > 0 && !audio.muted ? 0 : (lastVol || 1));
                        });
                        syncVol(1);
                      })();
                    </script>
                </div>`;
}

export function buildAudioNoticeHtml(audioNote: string | null): string {
  if (!audioNote) return '';
  return `
                <div style="background: #1f2937; border: 1px solid #f59e0b; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: #fbbf24; font-size: 18px;">⚠️</span>
                        <p style="color: #fbbf24; margin: 0; font-size: 13px; line-height: 1.5;">${audioNote}</p>
                    </div>
                </div>`;
}

export function buildPodcastDocumentHtml({
  script,
  voiceSettings,
  audioBase64,
  audioNoticeHtml,
  audioPlayerHtml,
}: PodcastHtmlOptions): string {
  const linesHtml = buildScriptLinesHtml(script, voiceSettings);
  const player = audioPlayerHtml !== undefined ? audioPlayerHtml : buildAudioPlayerHtml(audioBase64);
  const notice = audioNoticeHtml !== undefined ? audioNoticeHtml : buildAudioNoticeHtml(null);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Podcast Script</title><style>body { font-family: 'Inter', system-ui, -apple-system, sans-serif; padding: 40px 20px; background-color: #0f172a; color: #e2e8f0; } ::selection { background: rgba(168, 85, 247, 0.3); }</style></head><body>${notice}${player}${linesHtml}</body></html>`;
}

/** Short HTML preview for generation failures (quota vs error). */
export function buildErrorHtml(msg: string): string {
  const isQuota = /quota|429|resource_exhausted/i.test(msg);
  const safeMsg = msg
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Generation Notice</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0b0f17; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { max-width: 560px; width: 100%; background: #141a26; border: 1px solid ${isQuota ? '#f59e0b55' : '#ef444455'}; border-radius: 14px; padding: 22px; }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 3px 8px; border-radius: 6px; background: ${isQuota ? '#f59e0b22' : '#ef444422'}; color: ${isQuota ? '#fbbf24' : '#f87171'}; margin-bottom: 10px; }
    h2 { margin: 0 0 8px; font-size: 17px; color: #f8fafc; }
    p { margin: 0 0 12px; font-size: 13px; line-height: 1.55; color: #cbd5e1; }
    ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.65; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${isQuota ? 'API Quota Limit' : 'Generation Error'}</div>
    <h2>${isQuota ? 'Gemini API Quota Exceeded (429)' : 'Could Not Generate Tool Output'}</h2>
    <p>${safeMsg}</p>
    <ul>
      <li>Open <b>Settings → AI Engine</b> and switch to <b>MAGGI</b> (FreeLLMAPI key pool), <b>Ollama</b>, or <b>Custom AI</b>.</li>
      <li>Or wait a minute and retry, or select a billing-enabled API key in <b>Settings → Secrets</b>.</li>
    </ul>
  </div>
</body>
</html>`;
}
