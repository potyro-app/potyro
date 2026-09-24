// The "Sources" part of the Ask dialog (#213): what outside data this app's Ask can read, and the
// keys for it.
//
// An app's own sources are listed first, each with a place for the person's key when it needs one.
// Below them, the person's own: add one with a name, an endpoint or a link to its docs, and a key.
// Where a key is kept is said in plain words next to the field that takes it: this device's secure
// store, or — where there is none — only until the page closes.

import { useEffect, useState } from "react";
import { myKeyId, removeMySource, saveMySource, type KeyPlace, type KeyStore, type PersonSource, type ResolvedSource, type SourceAuth } from "./ask-sources.js";

export interface SourcesState {
  usable: ResolvedSource[];
  needKey: ResolvedSource[];
  place: KeyPlace;
}

const KEEP: Record<KeyPlace, string> = {
  vault: "Keys stay on this device, in its secure store. Apps never see them.",
  session: "This browser has no secure store, so keys are kept only until you close this page.",
};

const hostOf = (s: ResolvedSource): string => {
  const url = s.endpoint ?? s.docs;
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
};

function KeyField({ source, keys, onSaved }: { source: ResolvedSource; keys: KeyStore; onSaved: () => void }) {
  const [key, setKey] = useState("");
  return (
    <form
      className="k-ask-key"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void keys.set(source.keyId, key.trim()).then(onSaved);
      }}
    >
      <input className="k-input" type="password" autoComplete="off" aria-label={`Key for ${source.ask.label}`} placeholder="Paste your key" value={key} onChange={(e) => setKey(e.target.value)} />
      <button type="submit" className="k-add" disabled={!key.trim()}>
        Save key
      </button>
    </form>
  );
}

type AuthChoice = "bearer" | "header" | "query";

function AddSource({ keys, onDone }: { keys: KeyStore; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [docs, setDocs] = useState("");
  const [key, setKey] = useState("");
  const [how, setHow] = useState<AuthChoice>("bearer");
  const [param, setParam] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const https = (v: string): URL | null => {
    try {
      const u = new URL(v.trim());
      return u.protocol === "https:" ? u : null;
    } catch {
      return null;
    }
  };

  const save = async (): Promise<void> => {
    const ep = endpoint.trim() ? https(endpoint) : null;
    const dc = docs.trim() ? https(docs) : null;
    if (!label.trim()) return setProblem("Give it a name.");
    if (endpoint.trim() && !ep) return setProblem("The endpoint must be an https:// address.");
    if (docs.trim() && !dc) return setProblem("The docs link must be an https:// address.");
    if (!ep && !dc) return setProblem("Add the API's address, or a link to its documentation.");
    if (key.trim() && (how === "header" || how === "query") && !param.trim()) return setProblem(how === "header" ? "Name the header the key goes in." : "Name the query parameter the key goes in.");
    const auth: SourceAuth | undefined = !key.trim()
      ? undefined
      : how === "bearer"
        ? { header: "Authorization", prefix: "Bearer " }
        : how === "header"
          ? { header: param.trim() }
          : { query: param.trim() };
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const source: PersonSource = {
      id,
      label: label.trim(),
      ...(ep ? { endpoint: ep.toString() } : {}),
      ...(dc ? { docs: dc.toString() } : {}),
      ...(auth ? { auth } : {}),
      // The endpoint the person typed is theirs to allow; any other origin is asked about when used.
      origins: ep ? [ep.origin] : [],
    };
    if (auth) await keys.set(myKeyId(id), key.trim());
    saveMySource(source);
    onDone();
  };

  return (
    <div className="k-ask-add-source" role="group" aria-label="Add a source">
      <label className="k-ask-field">
        <span className="k-field-label">Name</span>
        <input className="k-input" value={label} placeholder="e.g. Places search" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="k-ask-field">
        <span className="k-field-label">API address</span>
        <input className="k-input" value={endpoint} inputMode="url" placeholder="https://api.example.com/v1/" onChange={(e) => setEndpoint(e.target.value)} />
      </label>
      <label className="k-ask-field">
        <span className="k-field-label">Docs link</span>
        <input className="k-input" value={docs} inputMode="url" placeholder="https://docs.example.com" onChange={(e) => setDocs(e.target.value)} />
      </label>
      <label className="k-ask-field">
        <span className="k-field-label">Key</span>
        <input className="k-input" type="password" autoComplete="off" value={key} placeholder="If the API needs one" onChange={(e) => setKey(e.target.value)} />
      </label>
      {key.trim() ? (
        <div className="k-ask-field">
          <span className="k-field-label">The key goes in</span>
          <span className="k-ask-auth">
            <select className="k-input" aria-label="Where the key goes" value={how} onChange={(e) => setHow(e.target.value as AuthChoice)}>
              <option value="bearer">Authorization: Bearer</option>
              <option value="header">A header named…</option>
              <option value="query">A query parameter named…</option>
            </select>
            {how === "header" || how === "query" ? (
              <input className="k-input" aria-label={how === "header" ? "Header name" : "Parameter name"} value={param} placeholder={how === "header" ? "X-Api-Key" : "key"} onChange={(e) => setParam(e.target.value)} />
            ) : null}
          </span>
        </div>
      ) : null}
      {problem ? (
        <p className="k-ask-refused" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="k-ask-actions">
        <button type="button" className="k-add" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="k-add k-primary-action" onClick={() => void save()}>
          Add source
        </button>
      </div>
    </div>
  );
}

export function SourcesSection({ state, keys, onChange }: { state: SourcesState; keys: KeyStore; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  // Opens itself when a source is waiting for a key, then stays as the person leaves it: saving the
  // last key must not fold the section away from under them.
  const [open, setOpen] = useState(false);
  const waitingCount = state.needKey.length;
  useEffect(() => {
    if (waitingCount) setOpen(true);
  }, [waitingCount]);
  const all = [...state.usable, ...state.needKey].sort((a, b) => (a.pin === b.pin ? 0 : a.pin === "endpoint" ? -1 : 1));
  const count = state.usable.length;

  const forget = async (s: ResolvedSource): Promise<void> => {
    await keys.remove(s.keyId);
    if (s.pin === "origins") removeMySource(s.ask.id.slice("mine:".length));
    onChange();
  };

  return (
    <details className="k-ask-sources" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Sources <span className="k-ask-group-count">{count ? `${count} ready` : "none yet"}</span>
      </summary>
      {all.length ? (
        <ul className="k-ask-source-list">
          {all.map((s) => {
            const waiting = state.needKey.includes(s);
            return (
              <li key={s.ask.id} className="k-ask-source" data-waiting={waiting || undefined}>
                <div className="k-ask-source-head">
                  <span className="k-ask-source-name">{s.ask.label}</span>
                  <span className="k-ask-source-host">{hostOf(s)}</span>
                  <span className="k-ask-source-from">{s.pin === "endpoint" ? "from this app" : "yours"}</span>
                </div>
                {s.ask.description ? <p className="k-ask-source-desc">{s.ask.description}</p> : null}
                {waiting ? (
                  <KeyField source={s} keys={keys} onSaved={onChange} />
                ) : s.auth || s.pin === "origins" ? (
                  <button type="button" className="k-ask-off" onClick={() => void forget(s)}>
                    {s.pin === "origins" ? "Remove this source" : "Forget the key"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {adding ? (
        <AddSource keys={keys} onDone={() => (setAdding(false), onChange())} />
      ) : (
        <button type="button" className="k-add k-ask-add-btn" onClick={() => setAdding(true)}>
          ＋ Add a source
        </button>
      )}
      <p className="k-ask-privacy">{KEEP[state.place]}</p>
    </details>
  );
}
