export function createMessage(key, substitutions = []) {
  return { key, substitutions };
}

export function createPluralMessage(key, counts, substitutions) {
  const pluralCounts = Array.isArray(counts) ? counts : [counts];

  return {
    key,
    pluralCounts,
    substitutions: substitutions ?? pluralCounts,
  };
}

export function createTranslator(i18n) {
  const locale = i18n.getMessage("messageLocale") || i18n.getUILanguage();
  const pluralRules = new Intl.PluralRules(locale);
  const listFormat = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  });

  function translate(message, substitutions = []) {
    if (typeof message === "string") {
      return getRequiredMessage(i18n, message, substitutions);
    }

    const values = (message.substitutions || []).map((value) => {
      if (Array.isArray(value)) {
        return listFormat.format(value.map((item) =>
          item && typeof item === "object" && "key" in item
            ? translate(item)
            : String(item)
        ));
      }

      const resolved = value && typeof value === "object" && "key" in value
        ? translate(value)
        : value;
      return String(resolved);
    });

    if (!message.pluralCounts) {
      return getRequiredMessage(i18n, message.key, values);
    }

    const categories = message.pluralCounts.map((count) =>
      pluralRules.select(count)
    );
    const exactKey = `${message.key}_${categories.join("_")}`;
    const exactMessage = i18n.getMessage(exactKey, values);

    if (exactMessage) {
      return exactMessage;
    }

    const fallbackKey = `${message.key}_${categories.map(() => "other").join("_")}`;
    return getRequiredMessage(i18n, fallbackKey, values);
  }

  translate.locale = locale;
  return translate;
}

export function localizeDocument(root, translate, locale) {
  const documentElement = root.documentElement;
  documentElement.lang = locale;
  documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";

  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = translate(element.dataset.i18n);
  }

  for (const element of root.querySelectorAll("[data-i18n-attrs]")) {
    for (const mapping of element.dataset.i18nAttrs.split(";")) {
      const [attribute, key] = mapping.split(":");

      if (attribute && key) {
        element.setAttribute(attribute, translate(key));
      }
    }
  }
}

function getRequiredMessage(i18n, key, substitutions) {
  const value = i18n.getMessage(key, substitutions);

  if (!value) {
    throw new Error(`Missing i18n message: ${key}`);
  }

  return value;
}

function isRtlLocale(locale) {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return new Set(["ar", "dv", "fa", "he", "ku", "ps", "ur", "yi"]).has(
    language,
  );
}
