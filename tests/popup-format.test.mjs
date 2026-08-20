import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDuplicateCleanupOutcome,
  formatGatherOutcome,
  formatGroupOutcome,
  formatGroupTitle,
  formatRestorationOutcome,
  formatReviewOutcome,
  formatReviewStopped,
  formatSortOutcome,
  formatSummary,
  formatUnclosedTabs,
  formatUngroupOutcome,
  getErrorMessage,
  getGroupColor,
  getTabUrlValue,
  pluralize,
} from "../popup-format.mjs";

test("pluralizes only when the count is not one", () => {
  assert.equal(pluralize("tab", 1), "tab");
  assert.equal(pluralize("tab", 0), "tabs");
  assert.equal(pluralize("tab", 2), "tabs");
  assert.equal(pluralize("match", 1), "match");
  assert.equal(pluralize("match", 3), "matches");
  assert.equal(pluralize("bus", 2), "buses");
  assert.equal(pluralize("box", 2), "boxes");
  assert.equal(pluralize("waltz", 2), "waltzes");
  assert.equal(pluralize("brush", 2), "brushes");
  assert.equal(pluralize("site", 2), "sites");
  assert.equal(pluralize("duplicate", 2), "duplicates");
  assert.equal(pluralize("group", 2), "groups");
  assert.equal(pluralize("window", 2), "windows");
});

test("formats the status summary line", () => {
  assert.equal(
    formatSummary({ tabCount: 1, duplicateCount: 0, domainCount: 1 }, 0),
    "1 tab · 0 exact · 0 possible · 1 site",
  );
  assert.equal(
    formatSummary({ tabCount: 12, duplicateCount: 3, domainCount: 5 }, 2),
    "12 tabs · 3 exact · 2 possible · 5 sites",
  );
});

test("truncates long group titles at 24 characters", () => {
  assert.equal(formatGroupTitle("example.com"), "example.com");
  assert.equal(formatGroupTitle("a".repeat(24)), "a".repeat(24));
  assert.equal(formatGroupTitle("a".repeat(25)), `${"a".repeat(23)}…`);
  assert.equal(formatGroupTitle(""), "");
});

test("maps a domain key to a stable group color", () => {
  const colors = [
    "blue",
    "red",
    "yellow",
    "green",
    "purple",
    "cyan",
    "orange",
    "pink",
    "grey",
  ];

  assert.equal(getGroupColor("example.com"), "purple");
  assert.equal(getGroupColor("news.ycombinator.com"), "blue");
  assert.equal(getGroupColor("a"), "pink");
  assert.equal(getGroupColor(""), "blue");

  for (const key of ["", "a", "example.com", "☃", "very.long.domain.name"]) {
    assert.ok(colors.includes(getGroupColor(key)));
  }
});

test("prefers a tab's pending address over its current address", () => {
  assert.equal(
    getTabUrlValue({ pendingUrl: "https://pending.test/", url: "https://a/" }),
    "https://pending.test/",
  );
  assert.equal(getTabUrlValue({ url: "https://a/" }), "https://a/");
  assert.equal(getTabUrlValue({}), "Unknown URL");
  assert.equal(getTabUrlValue({ url: "" }), "Unknown URL");
});

test("reads a message from errors and non-errors", () => {
  assert.equal(getErrorMessage(new Error("boom")), "boom");
  assert.equal(getErrorMessage("boom"), "boom");
  assert.equal(getErrorMessage(undefined), "undefined");
});

test("describes a fully restored cleanup", () => {
  assert.deepEqual(
    formatRestorationOutcome({ status: "restored", restored: 2, recreated: 0 }),
    {
      message: "Restored 2 tabs. Browsing history was restored.",
      tone: "success",
    },
  );
  assert.deepEqual(
    formatRestorationOutcome({ status: "restored", restored: 1, recreated: 1 }),
    {
      message:
        "Restored 1 tab. 1 tab reopened from saved address because Chrome no longer had browsing history.",
      tone: "success",
    },
  );
  assert.equal(
    formatRestorationOutcome({ status: "restored", restored: 3, recreated: 2 })
      .message,
    "Restored 3 tabs. 2 tabs reopened from saved addresses because Chrome no longer had browsing history.",
  );
});

test("describes a partially restored cleanup", () => {
  assert.deepEqual(
    formatRestorationOutcome({
      status: "partial",
      restored: 1,
      total: 3,
      failed: 2,
      recreated: 0,
    }),
    {
      message: "Restored 1 of 3 tabs. 2 could not be restored.",
      tone: "error",
    },
  );
  assert.equal(
    formatRestorationOutcome({
      status: "partial",
      restored: 2,
      total: 3,
      failed: 1,
      recreated: 1,
    }).message,
    "Restored 2 of 3 tabs. 1 could not be restored. 1 restored tab reopened from saved address without browsing history.",
  );
});

test("describes a failed cleanup restoration", () => {
  assert.deepEqual(
    formatRestorationOutcome({ status: "failed", total: 1 }),
    { message: "Could not restore 1 closed tab.", tone: "error" },
  );
  assert.equal(
    formatRestorationOutcome({ status: "failed", total: 2, error: "Nope." })
      .message,
    "Could not restore 2 closed tabs. Nope.",
  );
});

test("falls back when the outcome status is unknown", () => {
  assert.deepEqual(formatRestorationOutcome({ status: "expired" }), {
    message: "Undo is no longer available.",
    tone: "error",
  });
});

test("reports the duplicate cleanup outcome", () => {
  assert.deepEqual(
    formatDuplicateCleanupOutcome({
      duplicateCount: 0,
      closedNow: 0,
      failed: 0,
    }),
    {
      message: "No duplicate or similar tab addresses found.",
      tone: "neutral",
    },
  );
  assert.deepEqual(
    formatDuplicateCleanupOutcome({
      duplicateCount: 2,
      closedNow: 0,
      failed: 2,
    }),
    { message: "Could not close the exact duplicate tabs.", tone: "error" },
  );
  assert.deepEqual(
    formatDuplicateCleanupOutcome({
      duplicateCount: 3,
      closedNow: 2,
      failed: 1,
    }),
    { message: "1 exact duplicate could not be closed.", tone: "error" },
  );
  assert.equal(
    formatDuplicateCleanupOutcome({
      duplicateCount: 4,
      closedNow: 2,
      failed: 2,
    }).message,
    "2 exact duplicates could not be closed.",
  );
  assert.deepEqual(
    formatDuplicateCleanupOutcome({
      duplicateCount: 2,
      closedNow: 2,
      failed: 0,
    }),
    { message: "Duplicate cleanup complete.", tone: "success" },
  );
});

test("reports the similar-tab review outcome", () => {
  assert.deepEqual(
    formatReviewOutcome({ closedCount: 1, reviewedCount: 2 }),
    { message: "Duplicate cleanup complete.", tone: "success" },
  );
  assert.deepEqual(
    formatReviewOutcome({ closedCount: 0, reviewedCount: 1 }),
    { message: "Kept all tabs from 1 possible match.", tone: "neutral" },
  );
  assert.equal(
    formatReviewOutcome({ closedCount: 0, reviewedCount: 3 }).message,
    "Kept all tabs from 3 possible matches.",
  );
});

test("reports how many matches a stopped review left alone", () => {
  assert.equal(
    formatReviewStopped(1),
    "Review stopped. 1 possible match left unchanged.",
  );
  assert.equal(
    formatReviewStopped(2),
    "Review stopped. 2 possible matches left unchanged.",
  );
});

test("reports tabs that could not be closed", () => {
  assert.equal(formatUnclosedTabs(1), "1 tab could not be closed.");
  assert.equal(formatUnclosedTabs(3), "3 tabs could not be closed.");
});

test("reports the sort, group, ungroup, and gather outcomes", () => {
  assert.equal(
    formatSortOutcome({ tabCount: 1, domainCount: 1 }),
    "Sorted 1 tab across 1 site.",
  );
  assert.equal(
    formatSortOutcome({ tabCount: 9, domainCount: 4 }),
    "Sorted 9 tabs across 4 sites.",
  );
  assert.equal(
    formatGroupOutcome(2, 1),
    "Grouped 2 tabs into 1 domain group.",
  );
  assert.equal(
    formatGroupOutcome(1, 2),
    "Grouped 1 tab into 2 domain groups.",
  );
  assert.equal(
    formatUngroupOutcome(4, 2),
    "Ungrouped 4 tabs from 2 domain groups.",
  );
  assert.equal(
    formatUngroupOutcome(1, 1),
    "Ungrouped 1 tab from 1 domain group.",
  );
  assert.equal(
    formatGatherOutcome(3, 1),
    "Gathered 3 tabs from 1 other window.",
  );
  assert.equal(
    formatGatherOutcome(1, 2),
    "Gathered 1 tab from 2 other windows.",
  );
});
