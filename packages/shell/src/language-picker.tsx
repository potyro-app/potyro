// You → Language (#298): which language Potyro speaks on this device.
//
// A device choice, like Look, so it is saved on this device and nowhere else. "Match this device"
// is a choice of its own, not the absence of one: it is the default, and choosing it back after
// picking a language is how someone undoes a choice without knowing what their device is set to.
//
// Each language is named in itself (a person looking for theirs reads it in theirs), with its name
// in the current language underneath. Every language but English says it is a draft: the owner
// ships model translations as drafts and fixes them from feedback (#297), and someone choosing one
// should know why a sentence reads oddly.
//
// Switching is live: the chunk loads (from the service worker's cache when offline) and every
// screen reading `useLingui` re-renders. Nothing reloads.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LOCALES,
  LOCALE_INFO,
  PSEUDO_LOCALE,
  currentDeviceLocale,
  fmt,
  isPseudoAvailable,
  savedLocale,
  setLocale,
  useLocale,
} from "@potyro/i18n";

interface Option {
  id: string;
  name: string;
  /** The language of `name`, for screen readers and hyphenation. */
  lang?: string;
  detail: string;
  draft: boolean;
}

export function LanguagePicker() {
  const { t } = useLingui();
  const active = useLocale();
  const [choice, setChoice] = useState(savedLocale);
  const [failed, setFailed] = useState(false);
  const device = currentDeviceLocale();
  const deviceInfo = LOCALE_INFO[device as keyof typeof LOCALE_INFO];

  const options: Option[] = [
    {
      id: "auto",
      name: t`Match this device`,
      detail: deviceInfo ? deviceInfo.autonym : fmt.language(device),
      draft: false,
    },
    ...LOCALES.map((tag) => ({ id: tag, name: LOCALE_INFO[tag].autonym, lang: tag, detail: fmt.language(tag), draft: LOCALE_INFO[tag].draft })),
    ...(isPseudoAvailable()
      ? [{ id: PSEUDO_LOCALE, name: "Ƥšéûðö", lang: "en", detail: t`Shows text that missed the catalogs (dev only)`, draft: false }] // i18n-ignore
      : []),
  ];

  const choose = async (id: string): Promise<void> => {
    const was = choice;
    setChoice(id);
    setFailed(false);
    try {
      await setLocale(id);
    } catch {
      // The chunk would not load — offline before the worker had cached it. Say so; keep the old one.
      setChoice(was);
      setFailed(true);
    }
  };

  return (
    <div className="k-lang">
      <div className="k-lang-options" role="radiogroup" aria-labelledby="k-lang-h">
        {options.map((o) => {
          const on = choice === o.id;
          const name = o.name;
          // Read aloud as one phrase — "Polski (draft), Polish" — rather than as the pieces of the card.
          const repeats = o.detail.toLocaleLowerCase() === o.name.toLocaleLowerCase();
          const said = o.draft ? t({ message: `${name} (draft)`, comment: "A language in the picker whose translation is an unreviewed model draft" }) : name;
          const spoken = repeats ? said : `${said}, ${o.detail}`;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={spoken}
              className="k-lang-option"
              data-on={on || undefined}
              data-auto={o.id === "auto" || undefined}
              data-dev={o.id === PSEUDO_LOCALE || undefined}
              onClick={() => void choose(o.id)}
            >
              <span className="k-lang-name">
                <span lang={o.lang} translate="no">
                  {o.name}
                </span>
                {o.draft ? (
                  <>
                    {" "}
                    <span className="k-lang-draft" aria-hidden>
                      <Trans comment="Tag beside a language in the picker: its translation is an unreviewed model draft">draft</Trans>
                    </span>
                  </>
                ) : null}
              </span>
              {/* Not when it only repeats the name: "English / English" in English says nothing twice.
                  For "Match this device" it is a language's own name, and a name is not translated. */}
              {!repeats ? (
                <span className="k-lang-detail" translate={o.id === "auto" && deviceInfo ? "no" : undefined}>
                  {o.detail}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {failed ? (
        <p className="k-muted k-lang-note" role="status">
          <Trans>That language could not be loaded. Connect once and try again.</Trans>
        </p>
      ) : active !== "en" && LOCALE_INFO[active as keyof typeof LOCALE_INFO]?.draft ? (
        <p className="k-muted k-lang-note">
          <Trans>A draft translation was written by a model and may read oddly in places. It is being improved.</Trans>
        </p>
      ) : null}
    </div>
  );
}
