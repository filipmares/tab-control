import { createMessage, createPluralMessage } from "./i18n.mjs";

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
  const operation = state.undoTransaction?.operation || "duplicate-cleanup";

  if (count === 0) {
    return { hidden: true, disabled: state.busy, text: null, ariaLabel: null };
  }

  const copy = getUndoCopy(operation, state.undoTransaction);

  return {
    hidden: false,
    disabled: state.busy,
    text: copy.text,
    ariaLabel: copy.ariaLabel,
  };
}

function getUndoCopy(operation, summary) {
  const count = summary.count;
  const tabs = createPluralMessage("tabCount", count);

  switch (operation) {
    case "sort-by-domain":
      return {
        text: createMessage("undoSortText", [tabs]),
        ariaLabel: createMessage("undoSortLabel", [tabs]),
      };
    case "group-tabs": {
      const groupCount = summary.groupCount || 0;
      const groups = createPluralMessage("groupCount", groupCount);
      return {
        text: createMessage("undoGroupText", [tabs, groups]),
        ariaLabel: createMessage("undoGroupLabel", [tabs, groups]),
      };
    }
    case "ungroup-tabs": {
      const groupCount = summary.groupCount || 0;
      const groups = createPluralMessage("groupCount", groupCount);
      return {
        text: createMessage("undoUngroupText", [tabs, groups]),
        ariaLabel: createMessage("undoUngroupLabel", [tabs, groups]),
      };
    }
    case "gather-tabs-here": {
      const windowCount = summary.windowCount || 0;
      const windows = createPluralMessage("windowCount", windowCount);
      return {
        text: createMessage("undoGatherText", [tabs, windows]),
        ariaLabel: createMessage("undoGatherLabel", [tabs, windows]),
      };
    }
    default:
      return {
        text: createPluralMessage("closedTabs", count),
        ariaLabel: createPluralMessage("undoClosedTabs", count),
      };
  }
}
