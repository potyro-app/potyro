// The switch beside a key field (#455): "Remember on this device", off by default, and "Forget" once a
// key is kept. Kept means the device's vault (remembered-keys.ts), never plain storage; a device with
// no vault says so instead of offering the switch.

import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { canRemember, useRemembered, type KeyKind } from "./remembered-keys.js";
import { forgetRememberedKey, setKeyRemembered } from "./engine-store.js";

export function RememberKey({ kind, hasKey }: { kind: KeyKind; hasKey: boolean }) {
  const { t } = useLingui();
  const on = useRemembered().has(kind);
  const [can, setCan] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void canRemember().then((yes) => live && setCan(yes));
    return () => {
      live = false;
    };
  }, []);

  if (can === false) {
    return (
      <p className="k-muted k-remember-note">
        <Trans>This device can't keep a key locked away, so it stays in this tab only.</Trans>
      </p>
    );
  }
  const toggle = async (): Promise<void> => {
    setProblem(null);
    const ok = await setKeyRemembered(kind, !on);
    if (!ok) setProblem(t`Couldn't keep it on this device. It stays in this tab.`);
  };
  return (
    <div className="k-remember">
      <button
        type="button"
        role="switch"
        className="k-switch-row k-remember-row"
        aria-checked={on}
        disabled={can === null || (!on && !hasKey)}
        onClick={() => void toggle()}
      >
        <span className="k-switch-text">
          <span className="k-switch-label">
            <Trans comment="A switch beside a model key: keep the key on this device after the tab closes">Remember on this device</Trans>
          </span>
          <span className="k-switch-help">
            {on ? <Trans>Kept locked on this device.</Trans> : <Trans>Off: the key is gone when this tab closes.</Trans>}
          </span>
        </span>
        <span className="k-switch" aria-hidden>
          <span className="k-switch-knob" />
        </span>
      </button>
      {on ? (
        <button type="button" className="k-add k-remember-forget" onClick={() => void forgetRememberedKey(kind)}>
          <Trans comment="Button: take a remembered model key off this device">Forget</Trans>
        </button>
      ) : null}
      {problem ? (
        <p className="k-form-error" role="status">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
