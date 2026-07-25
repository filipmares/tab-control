export const ORGANIZATION_ACTION = Object.freeze({
  SORT: "sort",
  GROUP: "group",
  UNGROUP: "ungroup",
  GATHER: "gather",
});

export const ORGANIZATION_UNDO_STATE = Object.freeze({
  PENDING: "pending",
  OPEN: "open",
  RESTORING: "restoring",
});

const ACTIONS = new Set(Object.values(ORGANIZATION_ACTION));

export function createOrganizationUndoTransaction({
  id,
  action,
  label,
  count,
  windows,
  groups = [],
  createdAt = Date.now(),
}) {
  if (!id || !ACTIONS.has(action) || !label || !Number.isInteger(count) || count < 1) {
    throw new TypeError("Organization undo requires a valid action snapshot.");
  }

  const snapshots = windows.map(createWindowSnapshot);
  const windowIds = new Set(snapshots.map((window) => window.id));

  if (snapshots.length === 0 || windowIds.size !== snapshots.length) {
    throw new TypeError("Organization undo requires unique browser windows.");
  }

  const tabs = snapshots.flatMap((window) => window.tabs);
  const tabIds = new Set(tabs.map((tab) => tab.id));

  if (tabs.length === 0 || tabIds.size !== tabs.length) {
    throw new TypeError("Organization undo requires unique browser tabs.");
  }

  const groupSnapshots = groups.map(createGroupSnapshot);
  const groupIds = new Set(groupSnapshots.map((group) => group.id));
  const referencedGroupIds = new Set(
    tabs.filter((tab) => tab.groupId >= 0).map((tab) => tab.groupId),
  );

  if (
    groupIds.size !== groupSnapshots.length ||
    [...referencedGroupIds].some((groupId) => !groupIds.has(groupId))
  ) {
    throw new TypeError("Organization undo requires metadata for every tab group.");
  }

  return {
    id,
    action,
    label,
    count,
    createdAt,
    state: ORGANIZATION_UNDO_STATE.PENDING,
    windows: snapshots,
    groups: groupSnapshots,
  };
}

export function commitOrganizationUndoTransaction(transaction) {
  if (transaction?.state !== ORGANIZATION_UNDO_STATE.PENDING) {
    throw new Error("Only a pending organization action can be committed.");
  }

  return {
    ...transaction,
    state: ORGANIZATION_UNDO_STATE.OPEN,
  };
}

export function claimOrganizationUndoTransaction(transaction) {
  if (transaction?.state !== ORGANIZATION_UNDO_STATE.OPEN) {
    return null;
  }

  return {
    ...transaction,
    state: ORGANIZATION_UNDO_STATE.RESTORING,
  };
}

export function reopenOrganizationUndoTransaction(transaction) {
  if (transaction?.state !== ORGANIZATION_UNDO_STATE.RESTORING) {
    throw new Error("Only a restoring organization action can be reopened.");
  }

  return {
    ...transaction,
    state: ORGANIZATION_UNDO_STATE.OPEN,
  };
}

export function getOrganizationUndoSummary(transaction) {
  if (transaction?.state !== ORGANIZATION_UNDO_STATE.OPEN) {
    return null;
  }

  return {
    id: transaction.id,
    action: transaction.action,
    label: transaction.label,
    count: transaction.count,
    createdAt: transaction.createdAt,
  };
}

export function buildOrganizationRestorationPlan(
  transaction,
  liveTabs,
  liveWindowIds,
) {
  if (transaction?.state !== ORGANIZATION_UNDO_STATE.RESTORING) {
    throw new Error("The organization action has not been claimed for restoration.");
  }

  const liveTabIds = new Set(
    liveTabs.filter((tab) => Number.isInteger(tab?.id)).map((tab) => tab.id),
  );
  const snapshotTabs = transaction.windows.flatMap((window) => window.tabs);
  const missingTab = snapshotTabs.find((tab) => !liveTabIds.has(tab.id));

  if (missingTab) {
    throw new Error(
      "Undo is unavailable because a tab from the saved arrangement is no longer open.",
    );
  }

  const existingWindowIds = new Set(liveWindowIds);

  return {
    windows: transaction.windows.map((window) => ({
      ...window,
      exists: existingWindowIds.has(window.id),
      createWithTabId: existingWindowIds.has(window.id)
        ? null
        : window.tabs[0]?.id ?? null,
    })),
    groups: transaction.groups.map((group) => ({
      ...group,
      tabIds: snapshotTabs
        .filter((tab) => tab.groupId === group.id)
        .sort((left, right) => left.index - right.index)
        .map((tab) => tab.id),
    })),
  };
}

function createWindowSnapshot(window) {
  if (!Number.isInteger(window?.id) || window.type !== "normal") {
    throw new TypeError("Organization undo only supports normal browser windows.");
  }

  const tabs = [...(window.tabs || [])]
    .map((tab) => createTabSnapshot(tab, window.id))
    .sort((left, right) => left.index - right.index);

  return {
    id: window.id,
    incognito: Boolean(window.incognito),
    focused: Boolean(window.focused),
    state: window.state || "normal",
    left: Number.isInteger(window.left) ? window.left : null,
    top: Number.isInteger(window.top) ? window.top : null,
    width: Number.isInteger(window.width) ? window.width : null,
    height: Number.isInteger(window.height) ? window.height : null,
    activeTabId: tabs.find((tab) => tab.active)?.id ?? null,
    tabs,
  };
}

function createTabSnapshot(tab, windowId) {
  if (
    !Number.isInteger(tab?.id) ||
    tab.windowId !== windowId ||
    !Number.isInteger(tab.index)
  ) {
    throw new TypeError("Organization undo received an invalid tab snapshot.");
  }

  return {
    id: tab.id,
    index: tab.index,
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
  };
}

function createGroupSnapshot(group) {
  if (!Number.isInteger(group?.id) || group.id < 0) {
    throw new TypeError("Organization undo received invalid tab-group metadata.");
  }

  return {
    id: group.id,
    title: group.title || "",
    color: group.color || "grey",
    collapsed: Boolean(group.collapsed),
  };
}
