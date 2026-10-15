// Where shares are kept. The service needs four things per share — its meta, its sealed package, its
// picture, and the hash of the token that takes it down — and nothing else; an interface so the
// handler is tested in memory and runs on disk (disk.ts).
import type { ImageType, ShareMeta } from "./wire.ts";

export interface StoredShare {
  meta: ShareMeta;
  createdAt: string;
  /** sha256 of the delete token, hex. The token itself is never kept. */
  deleteHash: string;
  imageType?: ImageType;
}

export interface ShareStore {
  put(id: string, share: StoredShare, payload: Uint8Array, image?: Uint8Array): Promise<void>;
  get(id: string): Promise<StoredShare | null>;
  payload(id: string): Promise<Uint8Array | null>;
  image(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<void>;
}

export function memoryShareStore(): ShareStore & { size(): number } {
  const shares = new Map<string, { share: StoredShare; payload: Uint8Array; image?: Uint8Array }>();
  return {
    put: async (id, share, payload, image) => void shares.set(id, { share, payload, image }),
    get: async (id) => shares.get(id)?.share ?? null,
    payload: async (id) => shares.get(id)?.payload ?? null,
    image: async (id) => shares.get(id)?.image ?? null,
    remove: async (id) => void shares.delete(id),
    size: () => shares.size,
  };
}
