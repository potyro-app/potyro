// You → Language (#298): which language Potyro speaks on this device.
//
// A device choice, like Look, so it is saved on this device and nowhere else. "Match this device"
// is a choice of its own, not the absence of one: it is the default, and choosing it back after
// picking a language is how someone undoes a choice without knowing what their device is set to —
// so it says which language that is today: "Match this device (Polski)".
//
// A native <select> (the owner's call): one line in the panel however many languages there are,
// and on a phone the platform's own picker, which everyone already knows how to use. Each language
// is named in itself first (a person looking for theirs reads it in theirs), then in the current
// language. Every language but English says it is a draft: the owner ships model translations as
// drafts and fixes them from feedback (#297), and someone choosing one should know why a sentence
// reads oddly.
//
// Under it, "Something reads wrong? Suggest a better wording" (#300, suggest-wording.tsx): how the
// drafts get better.
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
import { SuggestWording } from "./suggest-wording.js";

/** The select's id, for the visible "Language" label in the You panel. */
export const LANGUAGE_SELECT_ID = "k-lang-select";

interface Option {
  id: string;
  label: string;
  /** The language's own name inside `label`: a name, not Potyro's words, so not translated. */
  autonym?: string;
}

export function LanguagePicker() {
  const { t } = useLingui();
  const active = useLocale();
  const [choice, setChoice] = useState(savedLocale);
  const [failed, setFailed] = useState(false);
  const device = currentDeviceLocale();
  const deviceInfo = LOCALE_INFO[device as keyof typeof LOCALE_INFO];
  const deviceName = deviceInfo ? deviceInfo.autonym : fmt.language(device);

  const languageLabel = (tag: (typeof LOCALES)[number]): string => {
    const { autonym, draft } = LOCALE_INFO[tag];
    const language = fmt.language(tag);
    // Not when it only repeats the name: "English — English" in English says nothing twice.
    if (language.toLocaleLowerCase() === autonym.toLocaleLowerCase()) {
      return draft
        ? t({ message: `${autonym} (draft)`, comment: "A language in the picker, named in itself, whose translation is an unreviewed model draft" })
        : autonym;
    }
    return draft
      ? t({
          message: `${autonym} — ${language} (draft)`,
          comment: "A language in the picker: its own name, its name in the current language, and that its translation is an unreviewed model draft",
        })
      : t({ message: `${autonym} — ${language}`, comment: "A language in the picker: its own name, then its name in the current language" });
  };

  const options: Option[] = [
    {
      id: "auto",
      label: t({
        message: `Match this device (${deviceName})`,
        comment: "First choice in the language picker: follow the device; the language it is set to, in its own name",
      }),
      autonym: deviceInfo?.autonym,
    },
    ...LOCALES.map((tag) => ({ id: tag, label: languageLabel(tag), autonym: LOCALE_INFO[tag].autonym })),
    ...(isPseudoAvailable()
      ? [{ id: PSEUDO_LOCALE, label: `Ƥšéûðö — ${t`Shows text that missed the catalogs (dev only)`}` }] // i18n-ignore
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
      <div className="k-lang-field">
        <select id={LANGUAGE_SELECT_ID} className="k-lang-select" value={choice} onChange={(e) => void choose(e.target.value)}>
          {options.map((o) => (
            // `data-autonym` tells the pseudo-language guard (e2e) which part of the text is a name.
            <option key={o.id} value={o.id} data-autonym={o.autonym}>
              {o.label}
            </option>
          ))}
        </select>
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
      <SuggestWording />
    </div>
  );
}
