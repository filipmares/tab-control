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
  const tabs = `${count} ${pluralize("tab", count)}`;

  switch (operation) {
    case "sort-by-domain":
      return {
        text: `Sorted ${tabs}`,
        ariaLabel: `Undo sorting and restore the previous order of ${tabs}`,
      };
    case "group-tabs": {
      const groupCount = summary.groupCount || 0;
      return {
        text: `Grouped ${tabs} into ${groupCount} ${pluralize("group", groupCount)}`,
        ariaLabel:
          `Undo grouping and ungroup ${tabs} from ${groupCount} ${pluralize("group", groupCount)}`,
      };
    }
    case "ungroup-tabs": {
      const groupCount = summary.groupCount || 0;
      return {
        text: `Ungrouped ${tabs} from ${groupCount} ${pluralize("group", groupCount)}`,
        ariaLabel:
          `Undo ungrouping and restore ${tabs} to ${groupCount} ${pluralize("group", groupCount)}`,
      };
    }
    case "gather-tabs-here": {
      const windowCount = summary.windowCount || 0;
      return {
        text: `Gathered ${tabs} from ${windowCount} ${pluralize("window", windowCount)}`,
        ariaLabel:
          `Undo gathering and return ${tabs} to ${windowCount} ${pluralize("window", windowCount)}`,
      };
    }
    default:
      return {
        text: `Closed ${tabs}`,
        ariaLabel:
          `Undo the latest duplicate cleanup and restore ${tabs}`,
      };
  }
}
