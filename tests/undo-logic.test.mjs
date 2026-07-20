import assert from "node:assert/strict";
import test from "node:test";

import {
  claimUndoTransaction,
  createUndoTransaction,
  discardQueuedTab,
  getRecoverableTabs,
  getRestorationOutcome,
  getUndoTransactionSummary,
  markTabClosed,
  markTabRestored,
  queueClosedTabs,
  reopenUndoTransaction,
  UNDO_TRANSACTION_STATE,
} from "../undo-logic.mjs";

test("queues recoverable tab snapshots once without exposing pending closures", () => {
  const transaction = createUndoTransaction({
    id: "cleanup-1",
    windowId: 5,
    createdAt: 100,
  });
  const queued = queueClosedTabs(transaction, [
    {
      id: 12,
      windowId: 5,
      index: 3,
      pendingUrl: "https://example.com/loading",
      url: "https://example.com/old",
      pinned: true,
    },
    {
      id: 12,
      windowId: 5,
      index: 3,
      url: "https://example.com/loading",
    },
    {
      id: 13,
      windowId: 5,
      index: 4,
      url: "",
    },
  ]);

  assert.equal(queued.tabs.length, 1);
  assert.deepEqual(queued.tabs[0], {
    originalTabId: 12,
    windowId: 5,
    index: 3,
    url: "https://example.com/loading",
    pinned: true,
    incognito: false,
    state: "pending",
  });
  assert.equal(getUndoTransactionSummary(queued), null);
});

test("tracks only confirmed extension closures in the undo summary", () => {
  const queued = queueClosedTabs(
    createUndoTransaction({ id: "cleanup-2", windowId: 5 }),
    [
      {
        id: 20,
        windowId: 5,
        index: 2,
        url: "https://example.com/one",
      },
      {
        id: 21,
        windowId: 5,
        index: 3,
        url: "https://example.com/two",
      },
    ],
  );
  const closed = markTabClosed(queued, 20);
  const failedRemoved = discardQueuedTab(closed, 21);

  assert.deepEqual(getUndoTransactionSummary(failedRemoved), {
    id: "cleanup-2",
    count: 1,
    createdAt: closed.createdAt,
  });
  assert.deepEqual(
    getRecoverableTabs(failedRemoved).map((tab) => tab.originalTabId),
    [20],
  );
});

test("claims all closed tabs in original order and prevents another claim", () => {
  let transaction = queueClosedTabs(
    createUndoTransaction({ id: "cleanup-3", windowId: 8 }),
    [
      {
        id: 32,
        windowId: 8,
        index: 6,
        url: "https://example.com/six",
      },
      {
        id: 30,
        windowId: 8,
        index: 1,
        url: "https://example.com/one",
      },
      {
        id: 31,
        windowId: 8,
        index: 4,
        url: "https://example.com/four",
      },
    ],
  );

  for (const tab of transaction.tabs) {
    transaction = markTabClosed(transaction, tab.originalTabId);
  }

  const claimed = claimUndoTransaction(transaction);

  assert.equal(claimed.state, UNDO_TRANSACTION_STATE.RESTORING);
  assert.deepEqual(
    claimed.tabs.map((tab) => tab.originalTabId),
    [30, 31, 32],
  );
  assert.equal(claimUndoTransaction(claimed), null);
});

test("a new cleanup transaction has no access to the previous cleanup", () => {
  let previous = queueClosedTabs(
    createUndoTransaction({ id: "older", windowId: 1 }),
    [
      {
        id: 40,
        windowId: 1,
        index: 0,
        url: "https://example.com/old",
      },
    ],
  );
  previous = markTabClosed(previous, 40);
  const newer = createUndoTransaction({ id: "newer", windowId: 1 });

  assert.equal(getUndoTransactionSummary(previous).count, 1);
  assert.equal(getUndoTransactionSummary(newer), null);
});

test("reports full, partial, and failed restoration outcomes", () => {
  let claimed = queueClosedTabs(
    createUndoTransaction({ id: "cleanup-4", windowId: 2 }),
    [
      {
        id: 50,
        windowId: 2,
        index: 0,
        url: "https://example.com/one",
      },
      {
        id: 51,
        windowId: 2,
        index: 1,
        url: "https://example.com/two",
      },
    ],
  );
  claimed = markTabClosed(claimed, 50);
  claimed = markTabClosed(claimed, 51);
  claimed = claimUndoTransaction(claimed);

  assert.deepEqual(getRestorationOutcome(claimed, ["blocked"]), {
    status: "failed",
    total: 2,
    restored: 0,
    failed: 2,
    error: "blocked",
  });
  assert.equal(
    reopenUndoTransaction(claimed).state,
    UNDO_TRANSACTION_STATE.OPEN,
  );

  claimed = markTabRestored(claimed, 50, 150);
  assert.deepEqual(getRestorationOutcome(claimed, ["blocked"]), {
    status: "partial",
    total: 2,
    restored: 1,
    failed: 1,
    error: "blocked",
  });
  assert.throws(
    () => reopenUndoTransaction(claimed),
    /partially restored transaction/,
  );

  claimed = markTabRestored(claimed, 51, 151);
  assert.deepEqual(getRestorationOutcome(claimed), {
    status: "restored",
    total: 2,
    restored: 2,
    failed: 0,
    error: null,
  });
});
