import assert from "node:assert/strict";
import test from "node:test";

import {
  createDebouncedRefresh,
  formatCompactUrl,
  getDifferenceRange,
  getPopupActionShortcut,
} from "../popup-ui-logic.mjs";

function keyboardEvent(key, overrides = {}) {
  return {
    key,
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function createFakeTimers() {
  let nextId = 1;
  const callbacks = new Map();

  return {
    callbacks,
    setTimeoutFn(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      callbacks.delete(id);
    },
    runOnly() {
      assert.equal(callbacks.size, 1);
      const [[id, callback]] = callbacks;
      callbacks.delete(id);
      callback();
    },
  };
}

test("debounces popup refresh requests", () => {
  const timers = createFakeTimers();
  let refreshCount = 0;
  const refresh = createDebouncedRefresh({
    delay: 100,
    shouldRefresh: () => true,
    refresh: () => {
      refreshCount += 1;
    },
    ...timers,
  });

  refresh.schedule();
  refresh.schedule();
  refresh.schedule();

  assert.equal(timers.callbacks.size, 1);
  timers.runOnly();
  assert.equal(refreshCount, 1);
});

test("does not refresh when the popup state is unavailable", () => {
  const timers = createFakeTimers();
  let available = false;
  let refreshCount = 0;
  const refresh = createDebouncedRefresh({
    delay: 100,
    shouldRefresh: () => available,
    refresh: () => {
      refreshCount += 1;
    },
    ...timers,
  });

  refresh.schedule();
  assert.equal(timers.callbacks.size, 0);

  available = true;
  refresh.schedule();
  available = false;
  timers.runOnly();
  assert.equal(refreshCount, 0);
});

test("disposes a pending popup refresh", () => {
  const timers = createFakeTimers();
  let refreshCount = 0;
  const refresh = createDebouncedRefresh({
    delay: 100,
    shouldRefresh: () => true,
    refresh: () => {
      refreshCount += 1;
    },
    ...timers,
  });

  refresh.schedule();
  refresh.dispose();

  assert.equal(timers.callbacks.size, 0);
  assert.equal(refreshCount, 0);
});

test("maps unmodified letter keys to popup actions", () => {
  assert.equal(getPopupActionShortcut(keyboardEvent("d")), "close-duplicates");
  assert.equal(getPopupActionShortcut(keyboardEvent("S")), "sort-by-domain");
  assert.equal(getPopupActionShortcut(keyboardEvent("g")), "toggle-domain-groups");
  assert.equal(getPopupActionShortcut(keyboardEvent("a")), "gather-tabs-here");
  assert.equal(getPopupActionShortcut(keyboardEvent("r")), "open-recently-closed");
});

test("ignores modified, repeated, handled, and unrelated key presses", () => {
  assert.equal(getPopupActionShortcut(keyboardEvent("d", { metaKey: true })), null);
  assert.equal(getPopupActionShortcut(keyboardEvent("d", { repeat: true })), null);
  assert.equal(
    getPopupActionShortcut(keyboardEvent("d", { defaultPrevented: true })),
    null,
  );
  assert.equal(getPopupActionShortcut(keyboardEvent("x")), null);
});

test("finds the differing URL segment in a comparison group", () => {
  const values = [
    "github.com/features/copilot",
    "github.com/features/copilot/overview",
  ];

  assert.deepEqual(getDifferenceRange(values, 0), { start: 27, end: 27 });
  assert.deepEqual(getDifferenceRange(values, 1), { start: 27, end: 36 });
});

test("omits difference markup for identical values", () => {
  assert.equal(getDifferenceRange(["example.com", "example.com"], 0), null);
});

test("formats web addresses as compact domain and path labels", () => {
  assert.equal(
    formatCompactUrl("https://www.github.com/example/project/pull/42"),
    "github.com / pull/42",
  );
  assert.equal(
    formatCompactUrl(
      "https://microsoft.ghe.com/app/pull/1255/changes#diff-a-really-long-fragment",
    ),
    "microsoft.ghe.com / 1255/changes#diff-a-really-lo…",
  );
});

test("preserves non-web and invalid addresses", () => {
  assert.equal(formatCompactUrl("chrome://settings"), "chrome://settings");
  assert.equal(formatCompactUrl("not a URL"), "not a URL");
});
