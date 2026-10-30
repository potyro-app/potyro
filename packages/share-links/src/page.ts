// The page a demo link answers with (docs/24 §4): the shell's own index.html, with what a chat needs
// to draw a preview written into its <head> — Open Graph for WhatsApp, Telegram, iMessage, Discord and
// Facebook, Twitter's card for X. Every value is the sharer's title and description, escaped here.
import type { ImageType, ShareMeta } from "./wire.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

export interface PageLinks {
  /** The link itself, without its fragment: `https://apps.example/s/<id>` */
  page: string;
  /** The preview picture, when there is one. */
  image?: string;
  imageType?: ImageType;
}

/** OG's locale is `pl_PL`; a bare `pl` stays `pl`. */
const ogLocale = (lang: string): string => lang.replace("-", "_");

export function previewTags(meta: ShareMeta, links: PageLinks): string {
  const tag = (attr: "property" | "name", key: string, value: string) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const lines = [
    `<title>${escapeHtml(meta.title)} · Potyro</title>`,
    tag("name", "description", meta.description),
    // A link is for whoever it was sent to, not for search engines.
    tag("name", "robots", "noindex, nofollow"),
    tag("property", "og:type", "website"),
    tag("property", "og:site_name", "Potyro"),
    tag("property", "og:title", meta.title),
    tag("property", "og:description", meta.description),
    tag("property", "og:url", links.page),
    tag("property", "og:locale", ogLocale(meta.lang)),
    tag("name", "twitter:card", links.image ? "summary_large_image" : "summary"),
    tag("name", "twitter:title", meta.title),
    tag("name", "twitter:description", meta.description),
  ];
  if (links.image) {
    lines.push(
      tag("property", "og:image", links.image),
      tag("property", "og:image:type", links.imageType ?? "image/jpeg"),
      tag("property", "og:image:width", "1200"),
      tag("property", "og:image:height", "630"),
      tag("property", "og:image:alt", meta.title),
      tag("name", "twitter:image", links.image),
    );
  }
  return lines.join("\n    ");
}

/**
 * The shell's index.html with the preview written in. Its own <title> is replaced; everything else —
 * the CSP, the scripts — is left exactly as built.
 */
export function sharePage(indexHtml: string, meta: ShareMeta, links: PageLinks): string {
  const tags = previewTags(meta, links);
  const withoutTitle = indexHtml.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
  // After the charset, which must stay first; else straight after <head>.
  if (/<meta\s+charset[^>]*>/i.test(withoutTitle)) return withoutTitle.replace(/<meta\s+charset[^>]*>/i, (charset) => `${charset}\n    ${tags}`);
  if (/<head[^>]*>/i.test(withoutTitle)) return withoutTitle.replace(/<head[^>]*>/i, (head) => `${head}\n    ${tags}`);
  return `<!doctype html><html><head>${tags}</head><body></body></html>`;
}

/** The words of the page a taken-down link answers with, in the languages Potyro speaks. */
const TAKEN_DOWN_WORDS = {
  en: { title: "This link was taken down.", line: "The app behind it was removed from Potyro.", contact: "If you think this was a mistake, write to {email}.", home: "Go to Potyro" },
  "pt-BR": { title: "Este link foi tirado do ar.", line: "O app por trás dele foi removido do Potyro.", contact: "Se você acha que foi um engano, escreva para {email}.", home: "Ir para o Potyro" },
  de: { title: "Dieser Link wurde gesperrt.", line: "Die App dahinter wurde von Potyro entfernt.", contact: "Wenn du glaubst, dass das ein Fehler war, schreib an {email}.", home: "Zu Potyro" },
  es: { title: "Este enlace fue retirado.", line: "La app que había detrás se quitó de Potyro.", contact: "Si crees que es un error, escribe a {email}.", home: "Ir a Potyro" },
  it: { title: "Questo link è stato rimosso.", line: "L’app dietro questo link è stata tolta da Potyro.", contact: "Se pensi che sia un errore, scrivi a {email}.", home: "Vai a Potyro" },
  pl: { title: "Ten link został zablokowany.", line: "Aplikacja, do której prowadził, została usunięta z Potyro.", contact: "Jeśli uważasz, że to pomyłka, napisz na {email}.", home: "Przejdź do Potyro" },
} as const;

type WordsLang = keyof typeof TAKEN_DOWN_WORDS;

/** The first language in an `Accept-Language` header that the page has words for; else English. */
export function pageLanguage(acceptLanguage: string | undefined): WordsLang {
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag: (tag ?? "").trim().toLowerCase(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((w) => w.tag && w.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    if (tag === "pt-br" || tag === "pt" || tag.startsWith("pt-")) return "pt-BR";
    const base = tag.split("-")[0]!;
    if (base === "en" || base === "de" || base === "es" || base === "it" || base === "pl") return base;
  }
  return "en";
}

/**
 * The whole page a link the operator took down answers with (410). It is not the shell: nothing of
 * the old link — its title, its picture, its package — and no script. Only what happened, who to
 * write to, and the way back to Potyro.
 */
export function takenDownPage(opts: { lang: WordsLang; contact?: string; home: string }): string {
  const w = TAKEN_DOWN_WORDS[opts.lang];
  const contact = opts.contact
    ? `<p>${escapeHtml(w.contact)
        .split("{email}")
        .join(`<a href="mailto:${escapeHtml(opts.contact)}">${escapeHtml(opts.contact)}</a>`)}</p>`
    : "";
  return `<!doctype html>
<html lang="${opts.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(w.title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body { font: 17px/1.5 system-ui, sans-serif; margin: 0; padding: 3rem 1rem; background: Canvas; color: CanvasText; }
      main { max-width: 32rem; margin: 0 auto; }
      h1 { font-size: 1.4rem; line-height: 1.25; margin: 0 0 0.75rem; }
      p { margin: 0 0 0.75rem; }
      a { color: LinkText; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(w.title)}</h1>
      <p>${escapeHtml(w.line)}</p>
      ${contact}
      <p><a href="${escapeHtml(opts.home)}">${escapeHtml(w.home)}</a></p>
    </main>
  </body>
</html>
`;
}
