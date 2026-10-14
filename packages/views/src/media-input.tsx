// The photo field (#102). Until now this was the browser's "Choose File | No file chosen" sitting
// in the middle of a designed form, with no sign of what you had chosen and no way to take it off
// again.
//
// It is a tile: empty it says what it wants ("Add photo"), filled it shows the thing. On a phone,
// where an app most often wants a photo of what is in front of you, it offers Camera or Library
// through the camera capability; on a desktop it opens the file dialog and takes a dropped file. A
// `multiple` field is a strip of tiles with the add tile last.
//
// Adding is never silent: a tile that is being added says so, and one that failed says that too and
// offers to try again, rather than leaving an empty field and no reason.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { PotyroRuntime } from "@potyro/runtime";
import type { MediaField, MediaRef } from "potyro";
import { ActionMenu, type MenuEntry } from "./menu.js";
import { usePhone } from "./media.js";
import { shrinkImage } from "./image-scale.js";

export interface MediaInputProps {
  runtime: PotyroRuntime;
  field: MediaField;
  value: MediaRef | MediaRef[] | null;
  onChange: (v: unknown) => void;
  label?: string;
}

type Kind = "image" | "video" | "audio" | "any";

// Each kind's words whole, never "Add " + a word: the word's form changes with the verb in many languages.
const ADD: Record<Kind, MessageDescriptor> = { image: msg`Add photo`, video: msg`Add video`, audio: msg`Add audio`, any: msg`Add file` };
/** After a field's name and a colon: "Photo: add photo". */
const ADD_AFTER: Record<Kind, MessageDescriptor> = {
  image: msg({ message: "add photo", comment: "After a field's name and a colon, lower case" }),
  video: msg({ message: "add video", comment: "After a field's name and a colon, lower case" }),
  audio: msg({ message: "add audio", comment: "After a field's name and a colon, lower case" }),
  any: msg({ message: "add file", comment: "After a field's name and a colon, lower case" }),
};
const TAKE: Record<Kind, MessageDescriptor> = { image: msg`Take a photo`, video: msg`Take a video`, audio: msg`Record audio`, any: msg`Take a file` };
const REMOVE: Record<Kind, MessageDescriptor> = { image: msg`Remove photo`, video: msg`Remove video`, audio: msg`Remove audio`, any: msg`Remove file` };
const ACCEPT: Record<Kind, string> = { image: "image/*", video: "video/*", audio: "audio/*", any: "" };
const GLYPH: Record<Kind, string> = { image: "📷", video: "🎬", audio: "🎙", any: "📎" };

export const mediaKind = (field: Pick<MediaField, "accept">): Kind => field.accept ?? "image";

/** The refs a media value holds, single or many, always as a list. */
export const mediaList = (value: MediaRef | MediaRef[] | null | undefined): MediaRef[] =>
  Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];

export function MediaInput({ runtime, field, value, onChange, label }: MediaInputProps) {
  const { t } = useLingui();
  const kind = mediaKind(field);
  const many = field.multiple === true;
  const refs = mediaList(value);
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const phone = usePhone();
  const camera = runtime.ctx.caps.camera;

  const write = (next: MediaRef[]): void => onChange(many ? next : (next[0] ?? null));

  const add = async (blob: Blob | null | undefined): Promise<void> => {
    if (!blob) return;
    setFailed(null);
    setAdding(true);
    try {
      // A camera photo is re-encoded to something a personal app can keep, unless the field says it
      // needs the original (`full`). Everything else — video, audio, a PDF — passes through.
      const stored = field.full === true ? blob : await shrinkImage(blob);
      const ref = await runtime.ctx.media.put(stored);
      write(many ? [...refs, ref] : [ref]);
    } catch (err) {
      // Never swallowed: the person chose a file and must be told it did not land.
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const openFiles = (): void => fileRef.current?.click();
  const capture = (source: "camera" | "library"): void => {
    if (!camera) return openFiles();
    void camera
      .capture({ source })
      .then((blob) => add(blob))
      .catch(() => {
        /* the person backed out of the camera — nothing to report */
      });
  };

  // On a phone the two sources are different acts, so they are two entries. On a desktop "camera"
  // means the same file dialog, so there is nothing to choose between.
  const sources: MenuEntry[] = [
    { key: "camera", label: t(TAKE[kind]), icon: "📷", onSelect: () => capture("camera") },
    { key: "library", label: t`Choose from library`, icon: "🖼", onSelect: () => capture("library") },
  ];

  const addLabel = refs.length && many ? t({ message: "Add", comment: "Add one more photo or file to a field that holds several" }) : t(ADD[kind]);
  const addAfter = refs.length && many ? t({ message: "add", comment: "After a field's name and a colon, lower case: add one more" }) : t(ADD_AFTER[kind]);
  const fieldAdd = label ? t({ message: `${label}: ${addAfter}`, comment: "A media field's add button: the field's name, then what it does" }) : undefined;
  const glyphAndWord = (
    <>
      <span className="k-media-add-glyph" aria-hidden>
        {GLYPH[kind]}
      </span>
      {addLabel}
    </>
  );
  const addTile =
    phone && camera ? (
      <ActionMenu
        label={fieldAdd ?? addLabel}
        entries={sources}
        title={label ?? addLabel}
        buttonClassName="k-media-add"
        trigger={glyphAndWord}
      />
    ) : (
      <button type="button" className="k-media-add" aria-label={fieldAdd} onClick={openFiles}>
        {glyphAndWord}
      </button>
    );

  const [over, setOver] = useState(false);
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (phone) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      void add(e.dataTransfer.files?.[0]);
    },
  };

  return (
    <div className="k-media" data-over={over || undefined} {...drop}>
      {refs.map((ref, i) => (
        <MediaTile
          key={`${ref.key}-${i}`}
          runtime={runtime}
          mediaRef={ref}
          onRemove={() => write(refs.filter((_, n) => n !== i))}
          removeLabel={label ? t({ message: `Remove: ${label}`, comment: "Remove the media in a field; label is the field's name" }) : t(REMOVE[kind])}
        />
      ))}
      {adding ? (
        <div className="k-media-tile k-media-adding" role="status">
          <span className="k-media-adding-text">
            <Trans>Adding…</Trans>
          </span>
          <span className="k-media-bar" aria-hidden />
        </div>
      ) : null}
      {many || refs.length === 0 ? addTile : null}
      {over ? (
        <p className="k-media-drop">
          <Trans>Drop to add it</Trans>
        </p>
      ) : null}
      {failed ? (
        <p className="k-media-failed" role="alert">
          <Trans>Couldn’t add it: {failed}</Trans>{" "}
          <button type="button" className="k-media-retry" onClick={openFiles}>
            <Trans>Try again</Trans>
          </button>
        </p>
      ) : null}
      <input
        ref={fileRef}
        className="k-media-file"
        type="file"
        tabIndex={-1}
        aria-hidden
        accept={ACCEPT[kind] || undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void add(file);
        }}
      />
    </div>
  );
}

/** One piece of media, wherever it shows: the form, the record page, a row. */
export function MediaTile({
  runtime,
  mediaRef,
  onRemove,
  removeLabel,
}: {
  runtime: PotyroRuntime;
  mediaRef: MediaRef;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const { t } = useLingui();
  const { url, state } = useMedia(runtime, mediaRef);
  const retry = useMediaRetry(runtime, mediaRef);
  const mime = mediaRef.mime ?? "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  // Bytes still on their way, or not fetched (KA-20). An empty square told nobody anything: it read
  // as a photo that had been lost, when the truth is it lives on someone else's device for a moment
  // longer.
  const pending = !url && (isImage || isVideo) ? state : null;
  return (
    <div className="k-media-tile" data-kind={isImage ? "image" : isVideo ? "video" : "other"}>
      {url && isImage ? <img src={url} alt="" /> : null}
      {url && isVideo ? <video src={url} muted playsInline /> : null}
      {pending === "waiting" ? (
        <span className="k-media-pending" data-state="waiting" role="status">
          <span aria-hidden>🖼</span>
          <span>{isVideo ? t`Getting the video…` : t`Getting the photo…`}</span>
        </span>
      ) : null}
      {pending === "absent" ? (
        <button type="button" className="k-media-pending" data-state="absent" onClick={retry}>
          <span aria-hidden>⇣</span>
          <span>
            <Trans>Not downloaded — tap to get it</Trans>
          </span>
        </button>
      ) : null}
      {!isImage && !isVideo ? (
        <span className="k-media-glyph" aria-hidden>
          {mime.startsWith("audio/") ? "🎙" : "📎"}
        </span>
      ) : null}
      {isVideo ? (
        <span className="k-media-play" aria-hidden>
          ▶
        </span>
      ) : null}
      {onRemove ? (
        <button type="button" className="k-media-x" aria-label={removeLabel ?? t`Remove`} onClick={onRemove}>
          ✕
        </button>
      ) : null}
    </div>
  );
}

/**
 * The URL for a ref, resolved out of render — and whether its bytes are here yet (KA-20, #61).
 *
 * `ctx.media.url` mints a fresh object URL per call, so the one this hook asked for is this
 * component's to release — a gallery that scrolls would otherwise hold every blob it ever showed.
 *
 * In a shared app a photo is its own encrypted CoValue, fetched only when someone looks at it. So a
 * ref whose bytes have not arrived is normal, not an error: asking IS the fetch, and asking again a
 * moment later is how the photo appears without a reload. The retries slow down and then stop, at
 * which point the tile says so and offers a tap — a photo the other device has not uploaded yet
 * would otherwise retry forever in everyone's list.
 */
const RETRY_MS = [400, 900, 1800, 3000, 5000];

export type MediaState = "ready" | "waiting" | "absent";

export function useMedia(runtime: PotyroRuntime, ref: MediaRef | null | undefined): { url: string | null; state: MediaState } {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<MediaState>("waiting");
  const [attempt, setAttempt] = useState(0);
  const key = ref?.key;

  useEffect(() => {
    if (!ref) {
      setUrl(null);
      setState("ready");
      return;
    }
    let alive = true;
    let mine: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;

    void runtime.ctx.media
      .url(ref)
      .then((u) => {
        mine = u;
        if (!alive) {
          releaseMediaUrl(u);
          return;
        }
        setUrl(u || null);
        if (u) {
          setState("ready");
          return;
        }
        // Not here yet. Ask again on a backing-off schedule; a synced store also tells us the moment
        // the bytes land, which beats any schedule.
        const wait = RETRY_MS[attempt];
        setState(wait === undefined ? "absent" : "waiting");
        if (wait !== undefined) timer = setTimeout(() => alive && setAttempt((n) => n + 1), wait);
        stop = runtime.watchMedia(ref, () => alive && setAttempt((n) => n + 1));
      })
      .catch(() => {
        if (alive) {
          setUrl(null);
          setState("absent");
        }
      });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      stop?.();
      if (mine) releaseMediaUrl(mine);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key, attempt]);

  return { url, state };
}

/** Retry now — what the "tap to get it" placeholder does once the automatic tries have stopped. */
export function useMediaRetry(runtime: PotyroRuntime, ref: MediaRef | null | undefined): () => void {
  const [, force] = useState(0);
  return () => {
    void runtime.ctx.media.url(ref as MediaRef).then((u) => {
      if (u) releaseMediaUrl(u);
      force((n) => n + 1);
    });
  };
}

/** The URL only, for callers that do not care whether it is still arriving. */
export function useMediaUrl(runtime: PotyroRuntime, ref: MediaRef | null | undefined): string | null {
  return useMedia(runtime, ref).url;
}

/** Free an object URL minted by `ctx.media.url`. A data: URL holds nothing, so it is left alone. */
export function releaseMediaUrl(url: string): void {
  if (!url.startsWith("blob:")) return;
  const g = globalThis as { URL?: { revokeObjectURL?: (u: string) => void } };
  g.URL?.revokeObjectURL?.(url);
}
