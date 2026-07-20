import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecentlyClosedViewModel,
  formatRecentDomain,
  RECENT_SESSION_LIMIT,
} from "../recent-logic.mjs";

test("orders browser sessions newest first and limits the result", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    lastModified: index,
    tab: {
      sessionId: `tab-${index}`,
      title: `Tab ${index}`,
      url: `https://example${index}.com`,
    },
  }));

  const items = createRecentlyClosedViewModel(sessions);

  assert.equal(items.length, RECENT_SESSION_LIMIT);
  assert.equal(items[0].sessionId, "tab-11");
  assert.equal(items.at(-1).sessionId, "tab-2");
});

test("formats a recently closed tab with title and domain context", () => {
  const [item] = createRecentlyClosedViewModel([
    {
      lastModified: 20,
      tab: {
        sessionId: "tab-1",
        title: "  Pull request 42  ",
        url: "https://www.github.com/example/project/pull/42",
      },
    },
  ]);

  assert.deepEqual(item, {
    sessionId: "tab-1",
    kind: "tab",
    title: "Pull request 42",
    context: "github.com",
    tabCount: 1,
    representativeTitles: ["Pull request 42"],
    lastModified: 20,
    ariaLabel: "Restore tab: Pull request 42, github.com",
  });
});

test("formats a window with its count and representative tab titles", () => {
  const [item] = createRecentlyClosedViewModel([
    {
      lastModified: 30,
      window: {
        sessionId: "window-1",
        tabs: [
          { title: "Inbox", url: "https://mail.example.com" },
          { title: "Inbox", url: "https://mail.example.com/second" },
          { title: "Project board", url: "https://work.example.com" },
          { title: "", url: "https://calendar.example.com" },
          { title: "Ignored fourth label", url: "https://four.example.com" },
        ],
      },
    },
  ]);

  assert.equal(item.kind, "window");
  assert.equal(item.title, "Inbox");
  assert.equal(item.context, "5 tabs");
  assert.deepEqual(item.representativeTitles, [
    "Inbox",
    "Project board",
    "calendar.example.com",
  ]);
  assert.equal(
    item.ariaLabel,
    "Restore window with 5 tabs: Inbox, Project board, calendar.example.com",
  );
});

test("ignores entries Chrome cannot restore", () => {
  const items = createRecentlyClosedViewModel([
    { lastModified: 3, tab: { title: "Missing session ID" } },
    { lastModified: 2, window: { tabs: [] } },
    null,
    {
      lastModified: 1,
      tab: {
        sessionId: "available",
        title: "Available",
        url: "chrome://settings",
      },
    },
  ]);

  assert.deepEqual(items.map((item) => item.sessionId), ["available"]);
});

test("formats web, local, internal, and unavailable addresses", () => {
  assert.equal(formatRecentDomain("https://www.example.com/path"), "example.com");
  assert.equal(formatRecentDomain("file:///Users/example/notes.txt"), "Local file");
  assert.equal(formatRecentDomain("chrome://settings"), "chrome://settings");
  assert.equal(formatRecentDomain("not a URL"), "not a URL");
  assert.equal(formatRecentDomain(""), "Address unavailable");
});
