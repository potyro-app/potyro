// The one switch that decides whether a new device can bring your apps back.
//
// Sync is per app and always has been, so someone who never turned it on has nothing anywhere but
// this device: the recovery words restore a name and an empty launcher. This is the answer to "if my
// laptop dies I just lost all my apps and data!" — one decision, for everything, including what you
// make tomorrow.
//
// Off until asked for. Nothing here sends data anywhere on its own (docs/01), and turning this on is
// a decision with a size attached: the apps move one at a time and a photo library is not quick, so
// it says which app it is on rather than pretending to be instant.

import { useState } from "react";
import { enrolEveryApp, localOnlyApps, type EnrolProgress } from "./backup-all.js";
import { backupEnabled, setBackupEnabled } from "./backup-setting.js";
import { shellDialogs } from "./dialog.js";

export function BackupSwitch() {
  const [on, setOn] = useState(backupEnabled());
  const [progress, setProgress] = useState<EnrolProgress | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const waiting = localOnlyApps().length;

  const turnOn = async (): Promise<void> => {
    const ok = await shellDialogs.confirm(
      waiting === 0
        ? "Keep your apps on the relay, so a new device signed in with your words can bring them back?"
        : `Keep your apps on the relay, so a new device signed in with your words can bring them back?\n\n` +
            `${waiting} app${waiting === 1 ? "" : "s"} still live only on this device and will be copied there now. ` +
            `Anything you make later goes too. The relay only ever sees encrypted data.`,
    );
    if (!ok) return;

    setOutcome(null);
    try {
      const result = await enrolEveryApp(setProgress);
      // The flag says "everything is on the relay". It may only be set when that is true: a device
      // that claims it while an app is still local-only is lying in the one place a lie costs
      // someone their data.
      if (result.failed.length === 0) {
        setBackupEnabled(true);
        setOn(true);
        setOutcome(
          result.moved === 0
            ? "Your apps are on the relay. Anything you make later goes too."
            : `Moved ${result.moved} app${result.moved === 1 ? "" : "s"} (${result.records} record${result.records === 1 ? "" : "s"}).`,
        );
      } else {
        setOutcome(
          `${result.failed.length} app${result.failed.length === 1 ? "" : "s"} could not be moved: ` +
            `${result.failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}. ` +
            `The rest are on the relay; nothing was lost. Try again, or turn sync on for them one at a time.`,
        );
      }
      if (result.warnings.length) setOutcome((was) => `${was ?? ""} ${result.warnings.join(" ")}`.trim());
    } finally {
      setProgress(null);
    }
  };

  const turnOff = async (): Promise<void> => {
    const ok = await shellDialogs.confirm(
      "Stop putting new apps on the relay?\n\n" +
        "The apps already there stay there — this is not a delete. Turn sync off for an app " +
        "individually to take it back off the relay.",
    );
    if (!ok) return;
    setBackupEnabled(false);
    setOn(false);
    setOutcome(null);
  };

  return (
    <div className="k-backup">
      <div className="k-backup-head">
        <strong>Your apps on this account</strong>
        <span className="k-muted">
          {on
            ? "A new device signed in with your words can bring them all back."
            : waiting > 0
              ? `${waiting} app${waiting === 1 ? "" : "s"} live only on this device. If it is lost, so are they.`
              : "Nothing is kept anywhere but this device."}
        </span>
      </div>
      <button type="button" className="k-add" disabled={progress !== null} onClick={() => void (on ? turnOff() : turnOn())}>
        {progress ? "Moving…" : on ? "Stop backing up" : "Back up my apps"}
      </button>
      {progress ? (
        <p className="k-muted k-backup-progress" role="status" aria-live="polite">
          Moving {progress.name} — {progress.done} of {progress.total}
        </p>
      ) : null}
      {outcome ? (
        <p className="k-muted k-backup-outcome" role="status">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
