const GROUP_COLORS = [
  "blue",
  "red",
  "yellow",
  "green",
  "purple",
  "cyan",
  "orange",
  "pink",
  "grey",
];

const GROUP_TITLE_LIMIT = 24;

export function pluralize(word, count) {
  if (count === 1) {
    return word;
  }

  return /(?:s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

export function formatSummary(summary, partialGroupCount) {
  return `${summary.tabCount} ${pluralize("tab", summary.tabCount)} · ${summary.duplicateCount} exact · ${partialGroupCount} possible · ${summary.domainCount} ${pluralize("site", summary.domainCount)}`;
}

export function formatGroupTitle(label) {
  return label.length <= GROUP_TITLE_LIMIT
    ? label
    : `${label.slice(0, GROUP_TITLE_LIMIT - 1)}…`;
}

export function getGroupColor(key) {
  let hash = 0;

  for (const character of key) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }

  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

export function getTabUrlValue(tab) {
  return tab.pendingUrl || tab.url || "Unknown URL";
}

export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function formatDuplicateCleanupOutcome({
  duplicateCount,
  closedNow,
  failed,
}) {
  if (duplicateCount === 0) {
    return {
      message: "No duplicate or similar tab addresses found.",
      tone: "neutral",
    };
  }

  if (closedNow === 0) {
    return {
      message: "Could not close the exact duplicate tabs.",
      tone: "error",
    };
  }

  if (failed > 0) {
    return {
      message:
        `${failed} exact ${pluralize("duplicate", failed)} could not be closed.`,
      tone: "error",
    };
  }

  return { message: "Duplicate cleanup complete.", tone: "success" };
}

export function formatReviewOutcome({ closedCount, reviewedCount }) {
  if (closedCount > 0) {
    return { message: "Duplicate cleanup complete.", tone: "success" };
  }

  return {
    message:
      `Kept all tabs from ${reviewedCount} possible ${pluralize("match", reviewedCount)}.`,
    tone: "neutral",
  };
}

export function formatReviewStopped(remainingCount) {
  return `Review stopped. ${remainingCount} possible ${pluralize("match", remainingCount)} left unchanged.`;
}

export function formatUnclosedTabs(failedCount) {
  return `${failedCount} ${pluralize("tab", failedCount)} could not be closed.`;
}

export function formatSortOutcome(summary) {
  return `Sorted ${summary.tabCount} ${pluralize("tab", summary.tabCount)} across ${summary.domainCount} ${pluralize("site", summary.domainCount)}.`;
}

export function formatGroupOutcome(groupedTabCount, groupCount) {
  return `Grouped ${groupedTabCount} ${pluralize("tab", groupedTabCount)} into ${groupCount} domain ${pluralize("group", groupCount)}.`;
}

export function formatUngroupOutcome(ungroupedTabCount, groupCount) {
  return `Ungrouped ${ungroupedTabCount} ${pluralize("tab", ungroupedTabCount)} from ${groupCount} domain ${pluralize("group", groupCount)}.`;
}

export function formatGatherOutcome(gatheredTabCount, windowCount) {
  return `Gathered ${gatheredTabCount} ${pluralize("tab", gatheredTabCount)} from ${windowCount} other ${pluralize("window", windowCount)}.`;
}

export function formatRestorationOutcome(outcome) {
  switch (outcome.status) {
    case "restored": {
      const detail = outcome.recreated > 0
        ? ` ${outcome.recreated} ${pluralize("tab", outcome.recreated)} reopened from saved ${pluralizeAddress(outcome.recreated)} because Chrome no longer had browsing history.`
        : " Browsing history was restored.";

      return {
        message: `Restored ${outcome.restored} ${pluralize("tab", outcome.restored)}.${detail}`,
        tone: "success",
      };
    }
    case "partial": {
      const detail = outcome.recreated > 0
        ? ` ${outcome.recreated} restored ${pluralize("tab", outcome.recreated)} reopened from saved ${pluralizeAddress(outcome.recreated)} without browsing history.`
        : "";

      return {
        message: `Restored ${outcome.restored} of ${outcome.total} tabs. ${outcome.failed} could not be restored.${detail}`,
        tone: "error",
      };
    }
    case "failed": {
      const detail = outcome.error ? ` ${outcome.error}` : "";

      return {
        message: `Could not restore ${outcome.total} closed ${pluralize("tab", outcome.total)}.${detail}`,
        tone: "error",
      };
    }
    default:
      return { message: "Undo is no longer available.", tone: "error" };
  }
}

function pluralizeAddress(count) {
  return count === 1 ? "address" : "addresses";
}
