// What an app's declared permissions are called where a person reads them: the Add an app card's
// "Asks for", and the trust dialog's list. The keys are the code's (`permissions: { camera: true }`).

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { i18n } from "@potyro/i18n";

const CAP_WORDS: Record<string, MessageDescriptor> = {
  camera: msg({ message: "camera", comment: "What an app asks this device for, lower case" }),
  notifications: msg({ message: "notifications", comment: "What an app asks this device for, lower case" }),
  geo: msg({ message: "location", comment: "What an app asks this device for, lower case" }),
  geolocation: msg({ message: "location", comment: "What an app asks this device for, lower case" }),
  filesystem: msg({ message: "files outside the app", comment: "What an app asks this device for, lower case" }),
  network: msg({ message: "the internet", comment: "What an app asks this device for, lower case" }),
  haptics: msg({ message: "vibration", comment: "What an app asks this device for, lower case" }),
  sync: msg({ message: "sharing", comment: "What an app asks this device for, lower case" }),
};

/** A permission key in words; a key Potyro does not know is shown as it is written. */
export function capabilityWords(key: string): string {
  const d = CAP_WORDS[key];
  return d ? i18n._(d) : key;
}
