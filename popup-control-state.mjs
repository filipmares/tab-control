import { pluralize } from "./popup-format.mjs";

const GROUP_ACTION_COPY = {
  group: {
    title: "Group tabs by domain",
    description: "Group sites with two or more tabs",
    actionDescription: "Groups sites with two or more tabs by domain",
  },
  ungroup: {
    title: "Ungroup tabs",
    description: "Remove same-domain groups only",
    actionDescription: "Removes groups that contain tabs from a single domain",
  },
};

export function shouldUngroupDomains(state) {
  return state.ungroupableDomainCount > 0;
}

export function getActionControlState(state) {
  const actionsUnavailable = state.busy || state.reviewing;
  const shouldUngroup = shouldUngroupDomains(state);
  const copy = GROUP_ACTION_COPY[shouldUngroup ? "ungroup" : "group"];

  return {
    shouldUngroup,
    closeDuplicatesDisabled:
      actionsUnavailable ||
      (state.summary.duplicateCount === 0 && state.partialGroupCount === 0),
    sortByDomainDisabled: actionsUnavailable || state.summary.tabCount < 2,
    domainGroupToggleDisabled:
      actionsUnavailable ||
      (shouldUngroup
        ? state.ungroupableDomainCount === 0
        : state.groupableDomainCount === 0),
    domainGroupTitle: copy.title,
    domainGroupDescription: copy.description,
    domainGroupActionDescription: copy.actionDescription,
    gatherTabsHereDisabled: actionsUnavailable || state.gatherableTabCount === 0,
    openRecentlyClosedDisabled: actionsUnavailable,
  };
}

export function getReviewControlState(state) {
  return { controlsDisabled: state.busy };
}

export function getRecentControlState(state) {
  return {
    controlsDisabled: state.recentLoading || Boolean(state.recentRestoringId),
  };
}

export function getUndoControlState(state) {
  const count = state.undoTransaction?.count || 0;

  if (count === 0) {
    return { hidden: true, disabled: state.busy, text: null, ariaLabel: null };
  }

  return {
    hidden: false,
    disabled: state.busy,
    text: `Closed ${count} ${pluralize("tab", count)}`,
    ariaLabel:
      `Undo the latest duplicate cleanup and restore ${count} ${pluralize("tab", count)}`,
  };
}
