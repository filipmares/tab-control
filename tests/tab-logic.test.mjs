import assert from "node:assert/strict";
import test from "node:test";

import {
  getDomainInfo,
  getDomainGroupingPlan,
  getDomainUngroupingPlan,
  getDuplicateTabIds,
  getGatherTabsPlan,
  getPartialDuplicateGroups,
  getSortedTabIds,
  getTabSummary,
} from "../tab-logic.mjs";

test("keeps the active tab when duplicate URLs are closed", () => {
  const tabs = [
    {
      id: 10,
      index: 0,
      active: false,
      pinned: true,
      url: "https://example.com/page",
    },
    {
      id: 11,
      index: 1,
      active: true,
      pinned: false,
      url: "https://example.com/page",
    },
    {
      id: 12,
      index: 2,
      active: false,
      pinned: false,
      url: "https://example.com/page",
    },
  ];

  assert.deepEqual(getDuplicateTabIds(tabs), [10, 12]);
});

test("uses pending URLs and keeps the leftmost copy by default", () => {
  const tabs = [
    {
      id: 20,
      index: 2,
      active: false,
      pinned: false,
      pendingUrl: "https://example.com/loading",
    },
    {
      id: 21,
      index: 1,
      active: false,
      pinned: false,
      url: "https://example.com/loading",
    },
    {
      id: 22,
      index: 3,
      active: false,
      pinned: false,
    },
  ];

  assert.deepEqual(getDuplicateTabIds(tabs), [20]);
});

test("sorts pinned and regular tabs separately by domain and title", () => {
  const tabs = [
    {
      id: 1,
      index: 0,
      pinned: true,
      title: "Zeta",
      url: "https://zeta.example/page",
    },
    {
      id: 2,
      index: 1,
      pinned: true,
      title: "Alpha",
      url: "https://alpha.example/page",
    },
    {
      id: 3,
      index: 2,
      pinned: false,
      title: "Beta",
      url: "https://beta.example/page",
    },
    {
      id: 4,
      index: 3,
      pinned: false,
      title: "Zeta page",
      url: "https://www.alpha.example/zeta",
    },
    {
      id: 5,
      index: 4,
      pinned: false,
      title: "Alpha page",
      url: "https://alpha.example/alpha",
    },
  ];

  assert.deepEqual(getSortedTabIds(tabs), [2, 1, 5, 4, 3]);
});

test("groups repeated unpinned domains that are not already grouped", () => {
  const tabs = [
    {
      id: 40,
      index: 0,
      pinned: true,
      groupId: -1,
      url: "https://alpha.example/pinned",
    },
    {
      id: 41,
      index: 1,
      pinned: false,
      groupId: -1,
      url: "https://www.alpha.example/one",
    },
    {
      id: 42,
      index: 2,
      pinned: false,
      groupId: -1,
      url: "https://alpha.example/two",
    },
    {
      id: 43,
      index: 3,
      pinned: false,
      groupId: 7,
      url: "https://gamma.example/one",
    },
    {
      id: 44,
      index: 4,
      pinned: false,
      groupId: 7,
      url: "https://gamma.example/two",
    },
    {
      id: 45,
      index: 5,
      pinned: false,
      groupId: 8,
      url: "https://delta.example/one",
    },
    {
      id: 46,
      index: 6,
      pinned: false,
      groupId: 8,
      url: "https://delta.example/two",
    },
    {
      id: 47,
      index: 7,
      pinned: false,
      groupId: 8,
      url: "https://other.example/one",
    },
  ];

  assert.deepEqual(getDomainGroupingPlan(tabs), [
    {
      key: "alpha.example",
      label: "alpha.example",
      tabIds: [41, 42],
    },
    {
      key: "delta.example",
      label: "delta.example",
      tabIds: [45, 46],
    },
  ]);
});

test("gathers only loose tabs from compatible normal windows", () => {
  const targetWindow = {
    id: 1,
    type: "normal",
    incognito: false,
  };
  const windows = [
    {
      ...targetWindow,
      tabs: [{ id: 70, index: 0, pinned: false, groupId: -1 }],
    },
    {
      id: 2,
      type: "normal",
      incognito: false,
      tabs: [
        { id: 71, index: 2, pinned: false, groupId: -1 },
        { id: 72, index: 0, pinned: true, groupId: -1 },
        { id: 73, index: 1, pinned: false, groupId: 8 },
        { id: 74, index: 3, pinned: false, groupId: -1 },
      ],
    },
    {
      id: 3,
      type: "normal",
      incognito: true,
      tabs: [{ id: 75, index: 0, pinned: false, groupId: -1 }],
    },
    {
      id: 4,
      type: "popup",
      incognito: false,
      tabs: [{ id: 76, index: 0, pinned: false, groupId: -1 }],
    },
    {
      id: 5,
      type: "normal",
      incognito: false,
      tabs: [{ id: 77, index: 0, pinned: false, groupId: -1 }],
    },
  ];

  assert.deepEqual(getGatherTabsPlan(windows, targetWindow), [
    {
      windowId: 2,
      tabIds: [71, 74],
    },
    {
      windowId: 5,
      tabIds: [77],
    },
  ]);
});

test("ungroups homogeneous domain groups but preserves mixed groups", () => {
  const tabs = [
    {
      id: 60,
      index: 0,
      groupId: 10,
      url: "https://www.alpha.example/one",
    },
    {
      id: 61,
      index: 1,
      groupId: 10,
      url: "https://alpha.example/two",
    },
    {
      id: 62,
      index: 2,
      groupId: 11,
      url: "https://beta.example/one",
    },
    {
      id: 63,
      index: 3,
      groupId: 11,
      url: "https://other.example/one",
    },
    {
      id: 64,
      index: 4,
      groupId: 12,
      url: "https://gamma.example/one",
    },
    {
      id: 65,
      index: 5,
      groupId: -1,
      url: "https://delta.example/one",
    },
  ];

  assert.deepEqual(getDomainUngroupingPlan(tabs), [
    {
      groupId: 10,
      key: "alpha.example",
      label: "alpha.example",
      tabIds: [60, 61],
    },
    {
      groupId: 12,
      key: "gamma.example",
      label: "gamma.example",
      tabIds: [64],
    },
  ]);
});

test("finds partial URL matches without using unsafe string prefixes", () => {
  const tabs = [
    {
      id: 50,
      index: 0,
      url: "https://microsoft.ghe.com/bic/app-studio/pull/1255",
    },
    {
      id: 51,
      index: 1,
      url: "https://microsoft.ghe.com/bic/app-studio/pull/1255/changes#diff-abc",
    },
    {
      id: 52,
      index: 2,
      url: "https://example.com/report?view=week",
    },
    {
      id: 53,
      index: 3,
      url: "https://example.com/report?view=month",
    },
    {
      id: 54,
      index: 4,
      url: "https://microsoft.ghe.com/bic/app-studio/pull/12",
    },
    {
      id: 55,
      index: 5,
      url: "https://other.example.com/bic/app-studio/pull/1255",
    },
    {
      id: 56,
      index: 6,
      url: "https://example.com/exact",
    },
    {
      id: 57,
      index: 7,
      url: "https://example.com/exact",
    },
  ];

  assert.deepEqual(
    getPartialDuplicateGroups(tabs).map((group) =>
      group.map((tab) => tab.id),
    ),
    [
      [50, 51],
      [52, 53],
    ],
  );
});

test("normalizes common domain labels and reports summary counts", () => {
  const tabs = [
    {
      id: 30,
      index: 0,
      url: "https://www.example.com/one",
    },
    {
      id: 31,
      index: 1,
      url: "https://www.example.com/one",
    },
    {
      id: 32,
      index: 2,
      url: "file:///Users/example/notes.txt",
    },
  ];

  assert.deepEqual(getDomainInfo(tabs[0]), {
    key: "example.com",
    label: "example.com",
  });
  assert.deepEqual(getTabSummary(tabs), {
    tabCount: 3,
    duplicateCount: 1,
    domainCount: 2,
  });
});
