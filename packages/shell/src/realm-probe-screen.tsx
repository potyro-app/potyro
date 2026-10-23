// The realm probe's screen (#267, docs/22 §5): the verdict and the numbers, big enough to read on a
// phone held at arm's length, and one button to copy them. Opened only when asked for — `#probe=realm`
// or seven taps on "You" — in dev and release builds alike.

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runRealmProbe, type ProbeResult } from "./realm-probe.js";

export function RealmProbeScreen({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [ticks, setTicks] = useState(0);
  const text = useRef<HTMLTextAreaElement | null>(null);

  // A ticker that stops when the page's thread is blocked: the freeze, seen.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setTicks((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const run = async (): Promise<void> => {
    setState("running");
    setLines([]);
    setCopied(false);
    try {
      const r = await runRealmProbe({ say: (l) => setLines((ls) => [...ls, l]) });
      setResult(r);
      setState("done");
    } catch (e) {
      setLines((ls) => [...ls, e instanceof Error ? e.message : String(e)]);
      setState("failed");
    }
  };

  const json = result ? JSON.stringify(result, null, 2) : lines.join("\n");
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      // No clipboard here (an old WebView): the text is selected for a long-press copy instead.
      text.current?.select();
    }
  };

  return createPortal(
    <div className="k-modal-scrim">
      <div className="k-modal k-probe" role="dialog" aria-modal="true" aria-labelledby="k-probe-title">
        <header className="k-probe-head">
          <h2 id="k-probe-title">
            <Trans comment="The device check for sealed screens (a diagnostic the owner runs on a phone)">Sealed screens on this device</Trans>
          </h2>
          <span className="k-probe-tick" aria-hidden>
            {ticks}
          </span>
        </header>
        <p className="k-muted">
          <Trans>This makes a sealed screen busy for 3 seconds, three ways, and measures whether Potyro froze meanwhile. The counter stops while it is frozen.</Trans>
        </p>
        {result ? (
          <p className="k-probe-verdict" data-freezes={result.viewFreezesShell ? "yes" : "no"}>
            {result.viewFreezesShell ? (
              <Trans>A busy screen freezes Potyro on this device: screens share its thread.</Trans>
            ) : (
              <Trans>A busy screen does not freeze Potyro on this device: screens run apart.</Trans>
            )}
          </p>
        ) : null}
        {result ? (
          <dl className="k-probe-numbers">
            <dt>
              <Trans>Potyro itself busy (calibration)</Trans>
            </dt>
            <dd>{t({ message: `${result.shellSpinMaxGapMs} ms`, comment: "milliseconds" })}</dd>
            <dt>
              <Trans>Sealed logic busy</Trans>
            </dt>
            <dd>{t({ message: `${result.workerSpinMaxGapMs} ms`, comment: "milliseconds" })}</dd>
            <dt>
              <Trans>Sealed screen busy</Trans>
            </dt>
            <dd>{t({ message: `${result.frameSpinMaxGapMs} ms`, comment: "milliseconds" })}</dd>
          </dl>
        ) : null}
        {lines.length || result ? <textarea ref={text} className="k-probe-json" readOnly value={json} aria-label={t`Results`} rows={8} /> : null}
        <div className="k-form-actions">
          <button type="button" className="k-add" onClick={onClose}>
            <Trans>Close</Trans>
          </button>
          {result ? (
            <button type="button" className="k-add" onClick={() => void copy()}>
              {copied ? <Trans>Copied</Trans> : <Trans>Copy results</Trans>}
            </button>
          ) : null}
          <button type="button" className="k-add k-primary-action" disabled={state === "running"} onClick={() => void run()}>
            {state === "running" ? <Trans>Measuring</Trans> : result ? <Trans>Run again</Trans> : <Trans>Run the check</Trans>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
