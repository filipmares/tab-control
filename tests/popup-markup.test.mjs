import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const popupMarkup = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const messages = JSON.parse(
  readFileSync(
    new URL("../_locales/en/messages.json", import.meta.url),
    "utf8",
  ),
);

const actionShortcuts = [
  ["close-duplicates", "D", "shortcutDuplicates"],
  ["sort-by-domain", "S", "shortcutSort"],
  ["toggle-domain-groups", "G", "shortcutGroup"],
  ["gather-tabs-here", "A", "shortcutGather"],
  ["open-recently-closed", "R", "shortcutRecent"],
];

test("exposes every popup action shortcut to assistive technology", () => {
  for (const [actionId, shortcut] of actionShortcuts) {
    const buttonPattern = new RegExp(
      `<button\\b(?=[^>]*\\bid="${actionId}")(?=[^>]*\\baria-keyshortcuts="${shortcut}")[^>]*>`,
    );

    assert.match(popupMarkup, buttonPattern);
  }
});

test("keeps visual shortcut hints out of the accessibility tree", () => {
  const shortcutHints = [
    ...popupMarkup.matchAll(
      /<kbd class="action__shortcut" aria-hidden="true" data-i18n="([^"]+)"><\/kbd>/g,
    ),
  ].map((match) => [match[1], messages[match[1]]?.message]);

  assert.deepEqual(
    shortcutHints,
    actionShortcuts.map(([, shortcut, messageKey]) => [messageKey, shortcut]),
  );
});
