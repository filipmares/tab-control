import assert from "node:assert/strict";
import test from "node:test";

import {
  createTabEditRetry,
  isTemporaryTabEditLock,
  TAB_EDIT_LOCK_MESSAGE,
  TAB_EDIT_RETRY_BACKOFF,
  TAB_EDIT_RETRY_LIMIT,
} from "../tab-edit-retry.mjs";

function lockError() {
  return new Error(`${TAB_EDIT_LOCK_MESSAGE}, user may be dragging a tab.`);
}

function createRecordingWait() {
  const delays = [];
  return {
    delays,
    wait(milliseconds) {
      delays.push(milliseconds);
      return Promise.resolve();
    },
  };
}

test("returns the operation result without retrying on success", async () => {
  const waiter = createRecordingWait();
  const run = createTabEditRetry({ wait: waiter.wait });
  let attempts = 0;

  const result = await run(() => {
    attempts += 1;
    return Promise.resolve("group-1");
  });

  assert.equal(result, "group-1");
  assert.equal(attempts, 1);
  assert.deepEqual(waiter.delays, []);
});

test("retries a temporary tab edit lock with increasing backoff", async () => {
  const waiter = createRecordingWait();
  const run = createTabEditRetry({ wait: waiter.wait });
  let attempts = 0;

  const result = await run(() => {
    attempts += 1;
    return attempts < 3 ? Promise.reject(lockError()) : Promise.resolve("done");
  });

  assert.equal(result, "done");
  assert.equal(attempts, 3);
  assert.deepEqual(waiter.delays, [
    TAB_EDIT_RETRY_BACKOFF,
    TAB_EDIT_RETRY_BACKOFF * 2,
  ]);
});

test("gives up after the retry limit and rethrows the lock error", async () => {
  const waiter = createRecordingWait();
  const run = createTabEditRetry({ wait: waiter.wait });
  let attempts = 0;

  await assert.rejects(
    run(() => {
      attempts += 1;
      return Promise.reject(lockError());
    }),
    new RegExp(TAB_EDIT_LOCK_MESSAGE),
  );

  assert.equal(attempts, TAB_EDIT_RETRY_LIMIT + 1);
  assert.deepEqual(waiter.delays, [
    TAB_EDIT_RETRY_BACKOFF,
    TAB_EDIT_RETRY_BACKOFF * 2,
    TAB_EDIT_RETRY_BACKOFF * 3,
  ]);
});

test("rethrows any other failure immediately", async () => {
  const waiter = createRecordingWait();
  const run = createTabEditRetry({ wait: waiter.wait });
  let attempts = 0;

  await assert.rejects(
    run(() => {
      attempts += 1;
      return Promise.reject(new Error("No tab with id: 7."));
    }),
    /No tab with id: 7\./,
  );

  assert.equal(attempts, 1);
  assert.deepEqual(waiter.delays, []);
});

test("honors an overridden retry limit and backoff", async () => {
  const waiter = createRecordingWait();
  const run = createTabEditRetry({
    retryLimit: 1,
    backoff: 5,
    wait: waiter.wait,
  });
  let attempts = 0;

  await assert.rejects(
    run(() => {
      attempts += 1;
      return Promise.reject(lockError());
    }),
    new RegExp(TAB_EDIT_LOCK_MESSAGE),
  );

  assert.equal(attempts, 2);
  assert.deepEqual(waiter.delays, [5]);
});

test("recognizes the temporary lock in errors and strings", () => {
  assert.equal(isTemporaryTabEditLock(lockError()), true);
  assert.equal(isTemporaryTabEditLock(TAB_EDIT_LOCK_MESSAGE), true);
  assert.equal(isTemporaryTabEditLock(new Error("No tab with id: 7.")), false);
  assert.equal(isTemporaryTabEditLock(undefined), false);
});
