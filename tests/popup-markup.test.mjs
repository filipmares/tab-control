import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const popupMarkup = readFileSync(new URL("../popup.html", import.meta.url), "utf8");

const actionShortcuts = [
  ["close-duplicates", "D"],
  ["sort-by-domain", "S"],
  ["toggle-domain-groups", "G"],
  ["gather-tabs-here", "A"],
  ["open-recently-closed", "R"],
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
      /<kbd class="action__shortcut" aria-hidden="true">([^<]+)<\/kbd>/g,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(
    shortcutHints,
    actionShortcuts.map(([, shortcut]) => shortcut),
  );
});
