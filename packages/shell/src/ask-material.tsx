// Bringing in what another AI made (#213): paste it, or add the file it produced. Ask turns what it
// contains into records in the app's own shape, and checks them against it — the paste is the source
// (packages/generator/src/agent/ask.ts, `material`).
//
// Text only for now: .md, .txt, .csv, .tsv, .json. A file is read on this device into the same box a
// paste goes in, so the person sees — and can trim — exactly what will be sent.

import { fmt } from "@potyro/i18n";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { MATERIAL_MAX } from "@potyro/generator/agent";

export interface Material {
  /** What the review calls it: "what you pasted", or the file's name. */
  label: string;
  text: string;
}

/** The material's label for the model (English, #297) and the marker for "not a file"; the person reads "Pasted". */
const PASTED = "what you pasted";
const ACCEPT = ".md,.markdown,.txt,.csv,.tsv,.json,text/plain,text/markdown,text/csv,application/json";
/** A bigger file is not something a person reviews line by line; say so instead of sending it. */
const FILE_MAX = 1_000_000;

export function MaterialField({ material, onChange }: { material: Material | null; onChange: (m: Material | null) => void }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(material !== null);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const read = async (f: File): Promise<void> => {
    setProblem(null);
    const name = f.name;
    const size = fmt.number(Math.round(f.size / 1000));
    const max = fmt.number(FILE_MAX / 1000);
    if (f.size > FILE_MAX) return setProblem(t`${name} is ${size} KB; files up to ${max} KB can be brought in.`);
    const text = await f.text();
    if (!text.trim()) return setProblem(t`${name} has no text in it.`);
    setOpen(true);
    onChange({ label: f.name, text });
  };

  if (!open) {
    return (
      <div className="k-ask-bring">
        <button type="button" className="k-ask-bring-btn" onClick={() => setOpen(true)}>
          <Trans>Paste what another AI made</Trans>
        </button>
        <button type="button" className="k-ask-bring-btn" onClick={() => file.current?.click()}>
          <Trans>Add a file</Trans>
        </button>
        <input ref={file} type="file" accept={ACCEPT} hidden aria-label={t`File to bring in`} onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
        {problem ? <p className="k-ask-refused">{problem}</p> : null}
      </div>
    );
  }

  const text = material?.text ?? "";
  const maxChars = fmt.number(MATERIAL_MAX);
  const hereChars = fmt.number(text.length);
  return (
    <div className="k-ask-material">
      <div className="k-ask-material-head">
        <span className="k-field-label">{material && material.label !== PASTED ? `📄 ${material.label}` : t({ message: "Pasted", comment: "Ask: the text the person pasted in" })}</span>
        <button type="button" className="k-ask-bring-btn" onClick={() => file.current?.click()}>
          <Trans>Add a file instead</Trans>
        </button>
        <button
          type="button"
          className="k-ask-chip-x"
          aria-label={t`Remove what you brought`}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          ✕
        </button>
        <input ref={file} type="file" accept={ACCEPT} hidden aria-label={t`File to bring in`} onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      </div>
      <textarea
        className="k-input k-ask-material-text"
        aria-label={t`What another AI made`}
        rows={6}
        placeholder={t`Paste a list, a plan, a table`}
        value={text}
        onChange={(e) => onChange({ label: material?.label ?? PASTED, text: e.target.value })}
      />
      {text.length > MATERIAL_MAX ? (
        <p className="k-ask-note">
          {t`Only the first ${maxChars} characters will be used (${hereChars} here).`}
        </p>
      ) : null}
      {problem ? <p className="k-ask-refused">{problem}</p> : null}
    </div>
  );
}
