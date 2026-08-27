import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createMessage,
  createPluralMessage,
  createTranslator,
  localizeDocument,
} from "../i18n.mjs";
import { createFakeI18n } from "./i18n-test-helper.mjs";

const catalog = JSON.parse(
  readFileSync(new URL("../_locales/en/messages.json", import.meta.url), "utf8"),
);

test("selects plural categories beyond one and other", () => {
  const translate = createTranslator(
    createFakeI18n("ar", {
      item_zero: { message: "zero" },
      item_few: { message: "few" },
      item_many: { message: "many" },
      item_other: { message: "other" },
    }),
  );

  assert.equal(translate(createPluralMessage("item", 0)), "zero");
  assert.equal(translate(createPluralMessage("item", 3)), "few");
  assert.equal(translate(createPluralMessage("item", 11)), "many");
  assert.equal(translate(createPluralMessage("item", 100)), "other");
});

test("falls back to the other plural form when a category is absent", () => {
  const translate = createTranslator(
    createFakeI18n("ar", {
      item_other: {
        message: "$COUNT$ items",
        placeholders: { count: { content: "$1" } },
      },
    }),
  );

  assert.equal(translate(createPluralMessage("item", 3)), "3 items");
});

test("uses the fallback catalog locale instead of the browser locale", () => {
  const translate = createTranslator(
    createFakeI18n("ru", {
      messageLocale: { message: "en" },
      item_one: { message: "one" },
      item_other: { message: "other" },
    }),
  );

  assert.equal(translate.locale, "en");
  assert.equal(translate(createPluralMessage("item", 21)), "other");
});

test("resolves nested messages and locale-aware lists as substitutions", () => {
  const translate = createTranslator(
    createFakeI18n("en", {
      item: { message: "Tab" },
      summary: {
        message: "$ITEMS$: $COUNT$",
        placeholders: {
          items: { content: "$1" },
          count: { content: "$2" },
        },
      },
    }),
  );

  assert.equal(
    translate(createMessage("summary", [
      [createMessage("item"), createMessage("item")],
      2,
    ])),
    "Tab and Tab: 2",
  );
});

test("localizes text, attributes, language, and text direction", () => {
  const textElement = {
    dataset: { i18n: "label" },
    textContent: "",
  };
  const attributeElement = {
    dataset: { i18nAttrs: "title:label;aria-label:description" },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const root = {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === "[data-i18n]" ? [textElement] : [attributeElement];
    },
  };
  const translate = createTranslator(
    createFakeI18n("ar", {
      label: { message: "Label" },
      description: { message: "Description" },
    }),
  );

  localizeDocument(root, translate, "ar");

  assert.equal(root.documentElement.lang, "ar");
  assert.equal(root.documentElement.dir, "rtl");
  assert.equal(textElement.textContent, "Label");
  assert.deepEqual(attributeElement.attributes, {
    title: "Label",
    "aria-label": "Description",
  });
});

test("defines every statically referenced popup and manifest message", () => {
  const html = readFileSync(
    new URL("../popup.html", import.meta.url),
    "utf8",
  );
  const manifest = readFileSync(
    new URL("../manifest.json", import.meta.url),
    "utf8",
  );
  const sourcePaths = [
    "../popup.js",
    "../popup-control-state.mjs",
    "../popup-format.mjs",
    "../popup-ui-logic.mjs",
    "../recent-logic.mjs",
  ];
  const sources = sourcePaths
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");
  const exactKeys = new Set();
  const pluralKeys = new Set();

  for (const match of html.matchAll(/\bdata-i18n="([^"]+)"/g)) {
    exactKeys.add(match[1]);
  }

  for (const match of html.matchAll(/\bdata-i18n-attrs="([^"]+)"/g)) {
    for (const mapping of match[1].split(";")) {
      exactKeys.add(mapping.split(":")[1]);
    }
  }

  for (const match of manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
    exactKeys.add(match[1]);
  }

  for (const pattern of [
    /createMessage\(\s*"([^"]+)"/g,
    /translate\(\s*"([^"]+)"/g,
    /setStatus\(\s*"([^"]+)"/g,
    /setBusy\(\s*true,\s*"([^"]+)"/g,
    /(?:title|description|actionDescription):\s*"([^"]+)"/g,
  ]) {
    for (const match of sources.matchAll(pattern)) {
      exactKeys.add(match[1]);
    }
  }

  for (const match of sources.matchAll(
    /showRecentState\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g,
  )) {
    exactKeys.add(match[1]);
    exactKeys.add(match[2]);
  }

  for (const match of sources.matchAll(
    /createPluralMessage\(\s*"([^"]+)"/g,
  )) {
    pluralKeys.add(match[1]);
  }

  for (const key of [
    "reviewBadgeActive",
    "reviewBadgePinned",
    "reviewBadgeActivePinned",
    "keepReviewTab",
    "keepReviewTabActive",
    "keepReviewTabPinned",
    "keepReviewTabActivePinned",
  ]) {
    exactKeys.add(key);
  }

  for (const key of exactKeys) {
    assert.ok(catalog[key], `Missing message: ${key}`);
  }

  for (const key of pluralKeys) {
    assert.ok(
      Object.keys(catalog).some((candidate) => candidate.startsWith(`${key}_`)),
      `Missing plural messages: ${key}`,
    );
  }
});

test("uses valid named placeholders throughout the English catalog", () => {
  for (const [key, entry] of Object.entries(catalog)) {
    assert.equal(typeof entry.message, "string", `${key} needs a message`);
    const referenced = new Set(
      [...entry.message.matchAll(/\$([A-Z0-9_]+)\$/g)]
        .map((match) => match[1].toLowerCase()),
    );
    const declared = new Set(Object.keys(entry.placeholders || {}));

    assert.deepEqual(referenced, declared, `${key} placeholder mismatch`);

    for (const placeholder of Object.values(entry.placeholders || {})) {
      assert.match(placeholder.content, /^\$\d+$/);
    }
  }
});
