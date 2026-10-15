// Each chat's own address for "send this" (docs/24 §1). Opened only by the person's tap; nothing is
// sent to them before it.

/** Telegram cuts a message at 4096 characters: a longer link (an inline one) is not offered there. */
export const TELEGRAM_MAX = 3800;

export function networkLinks(link: string, text: string): { whatsapp: string; telegram?: string } {
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
    ...(link.length + text.length <= TELEGRAM_MAX ? { telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}` } : {}),
  };
}
