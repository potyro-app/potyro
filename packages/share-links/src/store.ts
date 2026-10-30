// Where shares are kept. The service needs four things per share — its meta, its sealed package, its
// picture, and the hash of the token that takes it down — and nothing else; an interface so the
// handler is tested in memory and runs on disk (disk.ts).
//
// A share the operator takes down (docs/16, "Taking a link down") loses all four. What is kept in
// their place is a short record — when, and the operator's reason — so the link answers 410 "taken
// down" rather than 404, and so there is a record of what was done and why. It is never served.
import type { ImageType, ShareMeta } from "./wire.ts";

export interface StoredShare {
  meta: ShareMeta;
  createdAt: string;
  /** sha256 of the delete token, hex. The token itself is never kept. */
  deleteHash: string;
  imageType?: ImageType;
}

/** What is left of a share the operator took down. */
export interface TakenDown {
  /** ISO time of the takedown. */
  at: string;
  /** The operator's words: the notice it answered, or why. Kept on the server, never shown. */
  reason: string;
}

export interface ShareStore {
  put(id: string, share: StoredShare, payload: Uint8Array, image?: Uint8Array): Promise<void>;
  get(id: string): Promise<StoredShare | null>;
  payload(id: string): Promise<Uint8Array | null>;
  image(id: string): Promise<Uint8Array | null>;
  /** The sharer's own "stop sharing": everything goes, and the link is as if it never was (404). */
  remove(id: string): Promise<void>;
  /** The operator's takedown: the record first, then the share's meta, package and picture. */
  takeDown(id: string, record: TakenDown): Promise<void>;
  takenDown(id: string): Promise<TakenDown | null>;
}

export function memoryShareStore(): ShareStore & { size(): number } {
  const shares = new Map<string, { share: StoredShare; payload: Uint8Array; image?: Uint8Array }>();
  const gone = new Map<string, TakenDown>();
  return {
    put: async (id, share, payload, image) => void shares.set(id, { share, payload, image }),
    get: async (id) => shares.get(id)?.share ?? null,
    payload: async (id) => shares.get(id)?.payload ?? null,
    image: async (id) => shares.get(id)?.image ?? null,
    remove: async (id) => void shares.delete(id),
    takeDown: async (id, record) => {
      gone.set(id, record);
      shares.delete(id);
    },
    takenDown: async (id) => gone.get(id) ?? null,
    size: () => shares.size,
  };
}
