import React, { useEffect, useRef, useState } from 'react';
import { testSubmission, type SubmissionConfig } from '../services/testSubmission';

/** A real, billable chat request, separate from model discovery. */
export default function TestSubmission({ config }: { config: SubmissionConfig }) {
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef<AbortController | null>(null);
  const fingerprint = JSON.stringify(config);
  useEffect(() => {
    setResult(null);
    setLoading(false);
    return () => { current.current?.abort(); current.current = null; };
  }, [fingerprint]);

  const run = async () => {
    const controller = new AbortController();
    current.current = controller;
    setResult(null);
    setLoading(true);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    try {
      const response = await testSubmission(config, controller.signal);
      if (current.current !== controller) return;
      setResult({ ok: true, detail: `Submission succeeded. Model (requested or reported): ${response.model || 'not reported'}${response.route ? `; route: ${response.route}` : ''}. Reply: ${response.text.slice(0, 200)}` });
    } catch (error) {
      if (current.current !== controller) return;
      // Upstream error bodies can echo credentials; never display them.
      const message = error instanceof Error ? error.message : 'Request failed';
      const secrets = config.provider === 'custom' ? [config.apiKey] : config.provider === 'maggi' ? [config.settings.freeLlmApiKey, config.settings.openAiApiKey, ...config.settings.freeLlmKeys.map(k => k.key)] : [];
      const safe = secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[redacted]'), message);
      setResult({ ok: false, detail: timedOut ? 'Test timed out after 60 seconds. Check the endpoint and try again.' : safe.slice(0, 500) });
    } finally {
      clearTimeout(timer);
      if (current.current === controller) { current.current = null; setLoading(false); }
    }
  };

  return <div className="space-y-2">
    <button type="button" onClick={run} disabled={loading} className="rounded bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 text-[11px] font-bold disabled:opacity-50">
      {loading ? 'Testing submission…' : 'Test model submission'}
    </button>
    <p className="text-[10px] text-app-dim">Sends a short chat request using the current settings. Provider charges may apply; routing or fallback may select another model.</p>
    {result && <p role="status" className={`text-[11px] break-words ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>{result.ok ? '✓ ' : '⚠ '}{result.detail}</p>}
  </div>;
}
