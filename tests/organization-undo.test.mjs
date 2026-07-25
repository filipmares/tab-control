import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganizationRestorationPlan,
  claimOrganizationUndoTransaction,
  commitOrganizationUndoTransaction,
  createOrganizationUndoTransaction,
  getOrganizationUndoSummary,
  ORGANIZATION_ACTION,
  reopenOrganizationUndoTransaction,
} from "../organization-undo.mjs";

function createWindow(id, tabs, overrides = {}) {
  return {
    id,
    type: "normal",
    incognito: false,
    focused: id === 1,
    state: "normal",
    left: id * 100,
    top: 50,
    width: 900,
    height: 700,
    tabs: tabs.map((tab, index) => ({
      windowId: id,
      index,
      pinned: false,
      active: index === 0,
      groupId: -1,
      ...tab,
    })),
    ...overrides,
  };
}

function createClaimedTransaction(action, windows, groups = [], count = 2) {
  const pending = createOrganizationUndoTransaction({
    id: `${action}-undo`,
    action,
    label: `${action} action`,
    count,
    windows,
    groups,
    createdAt: 100,
  });
  return claimOrganizationUndoTransaction(
    commitOrganizationUndoTransaction(pending),
  );
}

test("sort reversal preserves original order, groups, and active tab", () => {
  const window = createWindow(1, [
    { id: 11, title: "Z", active: false },
    { id: 12, title: "A", active: true, groupId: 8 },
    { id: 13, title: "B", active: false, groupId: 8 },
  ]);
  const transaction = createClaimedTransaction(
    ORGANIZATION_ACTION.SORT,
    [window],
    [{ id: 8, title: "Work", color: "blue", collapsed: true }],
    3,
  );
  const plan = buildOrganizationRestorationPlan(
    transaction,
    [{ id: 11 }, { id: 12 }, { id: 13 }],
    [1],
  );

  assert.deepEqual(plan.windows[0].tabs.map((tab) => tab.id), [11, 12, 13]);
  assert.equal(plan.windows[0].activeTabId, 12);
  assert.deepEqual(plan.groups[0], {
    id: 8,
    title: "Work",
    color: "blue",
    collapsed: true,
    tabIds: [12, 13],
  });
});

test("group reversal records originally ungrouped tabs", () => {
  const transaction = createClaimedTransaction(
    ORGANIZATION_ACTION.GROUP,
    [createWindow(1, [{ id: 21 }, { id: 22 }])],
  );
  const plan = buildOrganizationRestorationPlan(
    transaction,
    [{ id: 21 }, { id: 22 }],
    [1],
  );

  assert.deepEqual(plan.groups, []);
  assert.deepEqual(
    plan.windows[0].tabs.map((tab) => tab.groupId),
    [-1, -1],
  );
});

test("group reversal rejects a snapshot without existing group metadata", () => {
  assert.throws(
    () =>
      createOrganizationUndoTransaction({
        id: "group-invalid",
        action: ORGANIZATION_ACTION.GROUP,
        label: "Grouped 2 tabs",
        count: 2,
        windows: [
          createWindow(1, [
            { id: 25, groupId: 7 },
            { id: 26, groupId: 7 },
          ]),
        ],
      }),
    /metadata for every tab group/,
  );
});

test("ungroup reversal recreates group metadata and membership", () => {
  const transaction = createClaimedTransaction(
    ORGANIZATION_ACTION.UNGROUP,
    [
      createWindow(1, [
        { id: 31, groupId: 9 },
        { id: 32, groupId: 9 },
      ]),
    ],
    [{ id: 9, title: "example.com", color: "cyan", collapsed: false }],
  );
  const plan = buildOrganizationRestorationPlan(
    transaction,
    [{ id: 31 }, { id: 32 }],
    [1],
  );

  assert.deepEqual(plan.groups[0].tabIds, [31, 32]);
  assert.equal(plan.groups[0].title, "example.com");
});

test("ungroup reversal remains hidden until the mutation is committed", () => {
  const pending = createOrganizationUndoTransaction({
    id: "ungroup-pending",
    action: ORGANIZATION_ACTION.UNGROUP,
    label: "Ungrouped 2 tabs",
    count: 2,
    windows: [
      createWindow(1, [
        { id: 35, groupId: 10 },
        { id: 36, groupId: 10 },
      ]),
    ],
    groups: [{ id: 10, title: "Work", color: "blue" }],
  });

  assert.equal(getOrganizationUndoSummary(pending), null);
});

test("gather reversal recreates a closed source window with its first saved tab", () => {
  const transaction = createClaimedTransaction(
    ORGANIZATION_ACTION.GATHER,
    [
      createWindow(1, [{ id: 41 }]),
      createWindow(2, [{ id: 42 }, { id: 43 }], { focused: false }),
    ],
    [],
    2,
  );
  const plan = buildOrganizationRestorationPlan(
    transaction,
    [{ id: 41 }, { id: 42 }, { id: 43 }],
    [1],
  );

  assert.equal(plan.windows[1].exists, false);
  assert.equal(plan.windows[1].createWithTabId, 42);
  assert.deepEqual(plan.windows[1].tabs.map((tab) => tab.id), [42, 43]);
});

test("gather reversal refuses to move tabs after a gathered tab was closed", () => {
  const transaction = createClaimedTransaction(
    ORGANIZATION_ACTION.GATHER,
    [
      createWindow(1, [{ id: 45 }]),
      createWindow(2, [{ id: 46 }, { id: 47 }], { focused: false }),
    ],
    [],
    2,
  );

  assert.throws(
    () =>
      buildOrganizationRestorationPlan(
        transaction,
        [{ id: 45 }, { id: 46 }],
        [1],
      ),
    /saved arrangement is no longer open/,
  );
});

test("reversal refuses to mutate when any saved tab is missing", () => {
  const transaction = createClaimedTransaction(
    ORGANIZATION_ACTION.SORT,
    [createWindow(1, [{ id: 51 }, { id: 52 }])],
  );

  assert.throws(
    () => buildOrganizationRestorationPlan(transaction, [{ id: 51 }], [1]),
    /saved arrangement is no longer open/,
  );
  assert.equal(
    getOrganizationUndoSummary(reopenOrganizationUndoTransaction(transaction))
      .id,
    "sort-undo",
  );
});

test("pending sort actions are not advertised as reversible", () => {
  const pending = createOrganizationUndoTransaction({
    id: "pending",
    action: ORGANIZATION_ACTION.SORT,
    label: "Sorted 2 tabs",
    count: 2,
    windows: [createWindow(1, [{ id: 61 }, { id: 62 }])],
  });

  assert.equal(getOrganizationUndoSummary(pending), null);
});
