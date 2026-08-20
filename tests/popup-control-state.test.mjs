import assert from "node:assert/strict";
import test from "node:test";

import {
  getActionControlState,
  getRecentControlState,
  getReviewControlState,
  getUndoControlState,
  shouldUngroupDomains,
} from "../popup-control-state.mjs";

function popupState(overrides = {}) {
  return {
    busy: false,
    reviewing: false,
    summary: { tabCount: 6, duplicateCount: 1, domainCount: 3 },
    groupableDomainCount: 2,
    ungroupableDomainCount: 0,
    gatherableTabCount: 4,
    partialGroupCount: 1,
    recentLoading: false,
    recentRestoringId: null,
    undoTransaction: null,
    ...overrides,
  };
}

test("enables every action when work is available", () => {
  const controls = getActionControlState(popupState());

  assert.equal(controls.closeDuplicatesDisabled, false);
  assert.equal(controls.sortByDomainDisabled, false);
  assert.equal(controls.domainGroupToggleDisabled, false);
  assert.equal(controls.gatherTabsHereDisabled, false);
  assert.equal(controls.openRecentlyClosedDisabled, false);
});

test("disables every action while busy or reviewing", () => {
  for (const overrides of [{ busy: true }, { reviewing: true }]) {
    const controls = getActionControlState(popupState(overrides));

    assert.equal(controls.closeDuplicatesDisabled, true);
    assert.equal(controls.sortByDomainDisabled, true);
    assert.equal(controls.domainGroupToggleDisabled, true);
    assert.equal(controls.gatherTabsHereDisabled, true);
    assert.equal(controls.openRecentlyClosedDisabled, true);
  }
});

test("keeps duplicate cleanup available when only similar matches exist", () => {
  const withPartial = getActionControlState(
    popupState({
      summary: { tabCount: 6, duplicateCount: 0, domainCount: 3 },
      partialGroupCount: 1,
    }),
  );
  const withNeither = getActionControlState(
    popupState({
      summary: { tabCount: 6, duplicateCount: 0, domainCount: 3 },
      partialGroupCount: 0,
    }),
  );

  assert.equal(withPartial.closeDuplicatesDisabled, false);
  assert.equal(withNeither.closeDuplicatesDisabled, true);
});

test("requires two tabs before sorting is offered", () => {
  const single = getActionControlState(
    popupState({ summary: { tabCount: 1, duplicateCount: 0, domainCount: 1 } }),
  );
  const pair = getActionControlState(
    popupState({ summary: { tabCount: 2, duplicateCount: 0, domainCount: 1 } }),
  );

  assert.equal(single.sortByDomainDisabled, true);
  assert.equal(pair.sortByDomainDisabled, false);
});

test("labels the domain toggle as grouping when nothing is grouped", () => {
  const controls = getActionControlState(
    popupState({ groupableDomainCount: 2, ungroupableDomainCount: 0 }),
  );

  assert.equal(controls.shouldUngroup, false);
  assert.equal(controls.domainGroupTitle, "Group tabs by domain");
  assert.equal(
    controls.domainGroupDescription,
    "Group sites with two or more tabs",
  );
  assert.equal(
    controls.domainGroupActionDescription,
    "Groups sites with two or more tabs by domain",
  );
  assert.equal(controls.domainGroupToggleDisabled, false);
});

test("labels the domain toggle as ungrouping once domain groups exist", () => {
  const controls = getActionControlState(
    popupState({ groupableDomainCount: 0, ungroupableDomainCount: 1 }),
  );

  assert.equal(controls.shouldUngroup, true);
  assert.equal(controls.domainGroupTitle, "Ungroup tabs");
  assert.equal(
    controls.domainGroupDescription,
    "Remove same-domain groups only",
  );
  assert.equal(
    controls.domainGroupActionDescription,
    "Removes groups that contain tabs from a single domain",
  );
  assert.equal(controls.domainGroupToggleDisabled, false);
});

test("disables the domain toggle when neither side has work", () => {
  const controls = getActionControlState(
    popupState({ groupableDomainCount: 0, ungroupableDomainCount: 0 }),
  );

  assert.equal(controls.domainGroupToggleDisabled, true);
});

test("disables gathering when no other window has loose tabs", () => {
  assert.equal(
    getActionControlState(popupState({ gatherableTabCount: 0 }))
      .gatherTabsHereDisabled,
    true,
  );
});

test("routes the domain toggle by the ungroupable domain count", () => {
  assert.equal(shouldUngroupDomains(popupState()), false);
  assert.equal(
    shouldUngroupDomains(popupState({ ungroupableDomainCount: 1 })),
    true,
  );
});

test("locks review controls only while busy", () => {
  assert.deepEqual(getReviewControlState(popupState()), {
    controlsDisabled: false,
  });
  assert.deepEqual(getReviewControlState(popupState({ busy: true })), {
    controlsDisabled: true,
  });
});

test("locks recent controls while loading or restoring", () => {
  assert.equal(getRecentControlState(popupState()).controlsDisabled, false);
  assert.equal(
    getRecentControlState(popupState({ recentLoading: true })).controlsDisabled,
    true,
  );
  assert.equal(
    getRecentControlState(popupState({ recentRestoringId: "abc" }))
      .controlsDisabled,
    true,
  );
});

test("hides the undo offer when nothing was closed", () => {
  assert.deepEqual(getUndoControlState(popupState()), {
    hidden: true,
    disabled: false,
    text: null,
    ariaLabel: null,
  });
  assert.deepEqual(
    getUndoControlState(popupState({ undoTransaction: { id: "t", count: 0 } })),
    { hidden: true, disabled: false, text: null, ariaLabel: null },
  );
});

test("describes the undo offer for the closed tab count", () => {
  assert.deepEqual(
    getUndoControlState(popupState({ undoTransaction: { id: "t", count: 1 } })),
    {
      hidden: false,
      disabled: false,
      text: "Closed 1 tab",
      ariaLabel:
        "Undo the latest duplicate cleanup and restore 1 tab",
    },
  );
  assert.deepEqual(
    getUndoControlState(
      popupState({ busy: true, undoTransaction: { id: "t", count: 3 } }),
    ),
    {
      hidden: false,
      disabled: true,
      text: "Closed 3 tabs",
      ariaLabel:
        "Undo the latest duplicate cleanup and restore 3 tabs",
    },
  );
});

test("describes the undo offer for each organizing operation", () => {
  assert.deepEqual(
    getUndoControlState(
      popupState({
        undoTransaction: {
          id: "sort",
          count: 42,
          operation: "sort-by-domain",
        },
      }),
    ),
    {
      hidden: false,
      disabled: false,
      text: "Sorted 42 tabs",
      ariaLabel: "Undo sorting and restore the previous order of 42 tabs",
    },
  );
  assert.equal(
    getUndoControlState(
      popupState({
        undoTransaction: {
          id: "group",
          count: 12,
          groupCount: 4,
          operation: "group-tabs",
        },
      }),
    ).text,
    "Grouped 12 tabs into 4 groups",
  );
  assert.equal(
    getUndoControlState(
      popupState({
        undoTransaction: {
          id: "gather",
          count: 9,
          windowCount: 2,
          operation: "gather-tabs-here",
        },
      }),
    ).text,
    "Gathered 9 tabs from 2 windows",
  );
});
