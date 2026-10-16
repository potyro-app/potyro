// The microphone in the Studio's box (docs/29 §4).
//
// Hold it to talk and let go when done, or tap it to start and tap again to stop. While it listens,
// the box says so — a strip with moving bars, where the words are made, and how to stop — and the
// words appear in the box as they are said, where they can be changed before sending. Where the
// browser writes nothing until the end (Firefox: a recording, written down by an AI service), the
// strip says it is writing it down. Typing, sending or leaving the Studio stops it.

import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { SpeechWhere } from "@potyro/capabilities";
import type { SpeechSession } from "potyro";
import { speechWhereWords } from "./app-speech.js";
import { studioListen, studioVoiceWhere, voiceProblem } from "./studio-voice.js";

export type VoicePhase = "idle" | "starting" | "listening" | "working";

/** Held this long, the button is push-to-talk: letting go stops. Shorter is a tap that toggles. */
const HOLD_MS = 400;

export interface Voice {
  /** Null while unknown or when this device cannot listen: no button then. */
  where: SpeechWhere | null;
  phase: VoicePhase;
  /** The button is being held (push-to-talk). */
  holding: boolean;
  problem: string | null;
  start(): void;
  stop(): void;
  setHolding(h: boolean): void;
  clearProblem(): void;
}

/** The Studio's dictation. `onHeard` gets everything heard so far in this listening. */
export function useVoice(onHeard: (text: string, final: boolean) => void, onStart: () => void): Voice {
  const [where, setWhere] = useState<SpeechWhere | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [holding, setHolding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const session = useRef<SpeechSession | null>(null);
  const stopWanted = useRef(false);
  const heard = useRef(onHeard);
  heard.current = onHeard;
  const started = useRef(onStart);
  started.current = onStart;

  useEffect(() => {
    let live = true;
    void studioVoiceWhere().then((w) => live && setWhere(w));
    return () => {
      live = false;
      session.current?.stop();
    };
  }, []);

  const start = useCallback((): void => {
    if (session.current || phase !== "idle") return;
    setProblem(null);
    setPhase("starting");
    stopWanted.current = false;
    started.current();
    void studioListen(() => setPhase("working")).then(
      (s) => {
        session.current = s;
        setPhase("listening");
        s.onText((text, final) => heard.current(text, final));
        // Let go before the microphone was on: stop as soon as it is.
        if (stopWanted.current) s.stop();
        s.result.then(
          (text) => {
            if (text) heard.current(text, true);
          },
          (e: unknown) => setProblem(voiceProblem(e)),
        ).finally(() => {
          session.current = null;
          setPhase("idle");
          setHolding(false);
        });
      },
      (e: unknown) => {
        setPhase("idle");
        setHolding(false);
        // "Not now" is an answer, not a problem.
        if ((e as { code?: unknown } | null)?.code === "denied" && /Permission denied/.test(String((e as Error).message))) return;
        setProblem(voiceProblem(e));
      },
    );
  }, [phase]);

  const stop = useCallback((): void => {
    stopWanted.current = true;
    session.current?.stop();
  }, []);

  return { where, phase, holding, problem, start, stop, setHolding, clearProblem: () => setProblem(null) };
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}

/** The button: hold to talk, or tap to start and tap to stop. */
export function VoiceButton({ voice, disabled }: { voice: Voice; disabled?: boolean }) {
  const { t } = useLingui();
  const downAt = useRef(0);
  const wasOn = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  if (!voice.where) return null;
  const release = (): void => {
    clearTimeout(holdTimer.current);
    downAt.current = 0;
    voice.setHolding(false);
  };
  const on = voice.phase === "starting" || voice.phase === "listening";
  const label = on ? t({ message: "Stop listening", comment: "Studio microphone button while it listens" }) : t({ message: "Speak", comment: "Studio microphone button: describe the app by voice" });
  return (
    <button
      type="button"
      className="k-voice-btn"
      data-phase={voice.phase}
      aria-label={label}
      aria-pressed={on}
      title={on ? label : t({ message: "Hold to talk, or tap to start and stop", comment: "Studio microphone button tooltip" })}
      disabled={disabled || voice.phase === "working"}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // keep the box's focus and caret where they are
        e.currentTarget.setPointerCapture?.(e.pointerId);
        downAt.current = Date.now();
        wasOn.current = on;
        if (!on) {
          voice.start();
          // Still down after a moment: push-to-talk, and the strip says to let go.
          holdTimer.current = setTimeout(() => downAt.current && voice.setHolding(true), HOLD_MS);
        }
      }}
      onPointerUp={() => {
        const held = downAt.current ? Date.now() - downAt.current : 0;
        // Push-to-talk only once it was listening: a hold that ended on the question (Allow?) is a tap.
        if (wasOn.current || (held >= HOLD_MS && voice.phase === "listening")) voice.stop();
        release();
      }}
      onPointerCancel={() => {
        if (downAt.current && Date.now() - downAt.current >= HOLD_MS) voice.stop();
        release();
      }}
      onClick={(e) => {
        // A keyboard press (no pointer): Enter or Space toggles.
        if (e.detail !== 0) return;
        if (on) voice.stop();
        else voice.start();
      }}
    >
      <span className="k-voice-ring" aria-hidden />
      {on ? <StopGlyph /> : <MicGlyph />}
    </button>
  );
}

/** Above the box's words while it listens: that it does, where the words are made, how to stop. */
export function VoiceStrip({ voice }: { voice: Voice }) {
  const { t } = useLingui();
  if (voice.problem) {
    return (
      <div className="k-voice-strip" data-kind="problem" role="alert">
        <span className="k-voice-strip-text">{voice.problem}</span>
        <button type="button" className="k-voice-strip-x" aria-label={t`Dismiss`} onClick={voice.clearProblem}>
          ✕
        </button>
      </div>
    );
  }
  if (voice.phase === "idle" || !voice.where) return null;
  const whereWords = speechWhereWords(voice.where);
  return (
    <div className="k-voice-strip" data-kind={voice.phase} role="status" aria-live="polite">
      {voice.phase === "working" ? (
        <span className="k-voice-spinner" aria-hidden />
      ) : (
        <span className="k-voice-bars" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
      <span className="k-voice-strip-text">
        {voice.phase === "working" ? (
          <Trans comment="Studio microphone: the recording is being turned into words (Firefox)">Writing down what you said…</Trans>
        ) : voice.phase === "starting" ? (
          <Trans comment="Studio microphone: turning the microphone on">Starting the microphone…</Trans>
        ) : voice.holding ? (
          <Trans comment="Studio microphone while held down (push to talk)">Listening — let go when you’re done</Trans>
        ) : (
          <Trans comment="Studio microphone after a tap: it keeps listening until tapped again">Listening — tap ■ to stop</Trans>
        )}
      </span>
      <span className="k-voice-where" data-leaves={voice.where.engine !== "device" || undefined} title={whereWords}>
        {whereWords}
      </span>
    </div>
  );
}
