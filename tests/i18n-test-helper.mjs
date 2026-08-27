import { readFileSync } from "node:fs";

import { createTranslator } from "../i18n.mjs";

const messages = JSON.parse(
  readFileSync(new URL("../_locales/en/messages.json", import.meta.url), "utf8"),
);

export function createEnglishTranslator() {
  return createTranslator(createFakeI18n("en", messages));
}

export function createFakeI18n(locale, catalog) {
  return {
    getUILanguage() {
      return locale;
    },
    getMessage(key, substitutions = []) {
      const entry = catalog[key];

      if (!entry) {
        return "";
      }

      const values = Array.isArray(substitutions)
        ? substitutions
        : [substitutions];
      let result = entry.message;

      for (const [name, placeholder] of Object.entries(
        entry.placeholders || {},
      )) {
        const index = Number(placeholder.content.slice(1)) - 1;
        result = result.replaceAll(
          new RegExp(`\\$${name}\\$`, "gi"),
          String(values[index] ?? ""),
        );
      }

      return result;
    },
  };
}
