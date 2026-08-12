import { createPluralMessage } from "./i18n.mjs";

const GROUP_ACTION_COPY = {
  group: {
    title: "groupTabs",
    description: "groupSummary",
    actionDescription: "groupActionDescription",
  },
  ungroup: {
    title: "ungroupTabs",
    description: "ungroupSummary",
    actionDescription: "ungroupActionDescription",
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
    text: createPluralMessage("closedTabs", count),
    ariaLabel: createPluralMessage("undoClosedTabs", count),
  };
}
