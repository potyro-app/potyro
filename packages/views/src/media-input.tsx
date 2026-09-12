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

import { useEffect, useRef, useState } from "react";
import type { KartaRuntime } from "@karta/runtime";
import type { MediaField, MediaRef } from "karta";
import { ActionMenu, type MenuEntry } from "./menu.js";
import { usePhone } from "./media.js";

export interface MediaInputProps {
  runtime: KartaRuntime;
  field: MediaField;
  value: MediaRef | MediaRef[] | null;
  onChange: (v: unknown) => void;
  label?: string;
}

type Kind = "image" | "video" | "audio" | "any";

const WORD: Record<Kind, string> = { image: "photo", video: "video", audio: "audio", any: "file" };
const ACCEPT: Record<Kind, string> = { image: "image/*", video: "video/*", audio: "audio/*", any: "" };
const GLYPH: Record<Kind, string> = { image: "📷", video: "🎬", audio: "🎙", any: "📎" };

export const mediaKind = (field: Pick<MediaField, "accept">): Kind => field.accept ?? "image";

/** The refs a media value holds, single or many, always as a list. */
export const mediaList = (value: MediaRef | MediaRef[] | null | undefined): MediaRef[] =>
  Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];

export function MediaInput({ runtime, field, value, onChange, label }: MediaInputProps) {
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
      const ref = await runtime.ctx.media.put(blob);
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
    { key: "camera", label: `Take a ${WORD[kind]}`, icon: "📷", onSelect: () => capture("camera") },
    { key: "library", label: "Choose from library", icon: "🖼", onSelect: () => capture("library") },
  ];

  const addLabel = refs.length && many ? "Add" : `Add ${WORD[kind]}`;
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
        label={label ? `${label}: ${addLabel.toLowerCase()}` : addLabel}
        entries={sources}
        title={label ?? addLabel}
        buttonClassName="k-media-add"
        trigger={glyphAndWord}
      />
    ) : (
      <button type="button" className="k-media-add" aria-label={label ? `${label}: ${addLabel.toLowerCase()}` : undefined} onClick={openFiles}>
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
          removeLabel={label ? `Remove ${label.toLowerCase()}` : `Remove ${WORD[kind]}`}
        />
      ))}
      {adding ? (
        <div className="k-media-tile k-media-adding" role="status">
          <span className="k-media-adding-text">Adding…</span>
          <span className="k-media-bar" aria-hidden />
        </div>
      ) : null}
      {many || refs.length === 0 ? addTile : null}
      {over ? <p className="k-media-drop">Drop to add it</p> : null}
      {failed ? (
        <p className="k-media-failed" role="alert">
          Couldn’t add it: {failed}{" "}
          <button type="button" className="k-media-retry" onClick={openFiles}>
            Try again
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
  runtime: KartaRuntime;
  mediaRef: MediaRef;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const url = useMediaUrl(runtime, mediaRef);
  const mime = mediaRef.mime ?? "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  return (
    <div className="k-media-tile" data-kind={isImage ? "image" : isVideo ? "video" : "other"}>
      {url && isImage ? <img src={url} alt="" /> : null}
      {url && isVideo ? <video src={url} muted playsInline /> : null}
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
        <button type="button" className="k-media-x" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          ✕
        </button>
      ) : null}
    </div>
  );
}

/**
 * The URL for a ref, resolved out of render.
 *
 * `ctx.media.url` mints a fresh object URL per call, so the one this hook asked for is this
 * component's to release — a gallery that scrolls would otherwise hold every blob it ever showed.
 */
export function useMediaUrl(runtime: KartaRuntime, ref: MediaRef | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = ref?.key;
  useEffect(() => {
    if (!ref) {
      setUrl(null);
      return;
    }
    let alive = true;
    let mine: string | null = null;
    void runtime.ctx.media
      .url(ref)
      .then((u) => {
        mine = u;
        if (alive) setUrl(u || null);
        else releaseMediaUrl(u);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
      if (mine) releaseMediaUrl(mine);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key]);
  return url;
}

/** Free an object URL minted by `ctx.media.url`. A data: URL holds nothing, so it is left alone. */
export function releaseMediaUrl(url: string): void {
  if (!url.startsWith("blob:")) return;
  const g = globalThis as { URL?: { revokeObjectURL?: (u: string) => void } };
  g.URL?.revokeObjectURL?.(url);
}
