import { createMessage, createPluralMessage } from "./i18n.mjs";

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

export function formatSummary(summary, partialGroupCount) {
  return createPluralMessage(
    "windowSummary",
    [summary.tabCount, summary.domainCount],
    [
      summary.tabCount,
      summary.duplicateCount,
      partialGroupCount,
      summary.domainCount,
    ],
  );
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
  return tab.pendingUrl || tab.url || "";
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
      message: createMessage("noDuplicateAddresses"),
      tone: "neutral",
    };
  }

  if (closedNow === 0) {
    return {
      message: createMessage("couldNotCloseExactDuplicates"),
      tone: "error",
    };
  }

  if (failed > 0) {
    return {
      message: createPluralMessage("exactDuplicatesNotClosed", failed),
      tone: "error",
    };
  }

  return { message: createMessage("duplicateCleanupComplete"), tone: "success" };
}

export function formatReviewOutcome({ closedCount, reviewedCount }) {
  if (closedCount > 0) {
    return {
      message: createMessage("duplicateCleanupComplete"),
      tone: "success",
    };
  }

  return {
    message: createPluralMessage("keptAllReviewTabs", reviewedCount),
    tone: "neutral",
  };
}

export function formatReviewStopped(remainingCount) {
  return createPluralMessage("reviewStopped", remainingCount);
}

export function formatUnclosedTabs(failedCount) {
  return createPluralMessage("tabsNotClosed", failedCount);
}

export function formatSortOutcome(summary) {
  return createPluralMessage(
    "sortOutcome",
    [summary.tabCount, summary.domainCount],
    [summary.tabCount, summary.domainCount],
  );
}

export function formatGroupOutcome(groupedTabCount, groupCount) {
  return createPluralMessage(
    "groupOutcome",
    [groupedTabCount, groupCount],
    [groupedTabCount, groupCount],
  );
}

export function formatUngroupOutcome(ungroupedTabCount, groupCount) {
  return createPluralMessage(
    "ungroupOutcome",
    [ungroupedTabCount, groupCount],
    [ungroupedTabCount, groupCount],
  );
}

export function formatGatherOutcome(gatheredTabCount, windowCount) {
  return createPluralMessage(
    "gatherOutcome",
    [gatheredTabCount, windowCount],
    [gatheredTabCount, windowCount],
  );
}

export function formatRestorationOutcome(
  outcome,
  operation = "duplicate-cleanup",
) {
  if (operation !== "duplicate-cleanup") {
    return formatOperationRestorationOutcome(outcome, operation);
  }

  switch (outcome.status) {
    case "restored": {
      return {
        message: outcome.recreated > 0
          ? createPluralMessage(
            "restorationCompleteRecreated",
            [outcome.restored, outcome.recreated],
            [outcome.restored, outcome.recreated],
          )
          : createPluralMessage(
            "restorationCompleteHistory",
            outcome.restored,
          ),
        tone: "success",
      };
    }
    case "partial": {
      return {
        message: outcome.recreated > 0
          ? createPluralMessage(
            "restorationPartialRecreated",
            [outcome.total, outcome.recreated],
            [
              outcome.restored,
              outcome.total,
              outcome.failed,
              outcome.recreated,
            ],
          )
          : createPluralMessage(
            "restorationPartial",
            outcome.total,
            [outcome.restored, outcome.total, outcome.failed],
          ),
        tone: "error",
      };
    }
    case "failed": {
      return {
        message: outcome.error
          ? createPluralMessage(
            "restorationFailedWithError",
            outcome.total,
            [outcome.total, outcome.error],
          )
          : createPluralMessage("restorationFailed", outcome.total),
        tone: "error",
      };
    }
    default:
      return {
        message: createMessage("undoUnavailable"),
        tone: "error",
      };
  }
}

function formatOperationRestorationOutcome(outcome, operation) {
  const failures = outcome.failures?.join(" ") || "";

  if (outcome.status === "expired") {
    return { message: createMessage("undoUnavailable"), tone: "error" };
  }

  if (outcome.status === "restored") {
    return {
      message: getOperationRestoredMessage(outcome, operation),
      tone: "success",
    };
  }

  if (outcome.status === "partial") {
    if (outcome.restored === outcome.total && outcome.failed === 0) {
      return {
        message: getOperationWarningMessage(outcome, operation),
        tone: "error",
      };
    }

    return {
      message: getOperationPartialMessage(outcome, operation, failures),
      tone: "error",
    };
  }

  return {
    message: createMessage(getOperationFailedKey(operation), [failures]),
    tone: "error",
  };
}

function getOperationWarningMessage(outcome, operation) {
  const tabs = createPluralMessage("tabCount", outcome.restored);
  const failures = outcome.failures?.join(" ") || "";

  if (operation === "gather-tabs-here") {
    return createMessage("undoGatherWarning", [tabs, failures]);
  }

  return createMessage("undoOrganizationWarning", [tabs, failures]);
}

function getOperationRestoredMessage(outcome, operation) {
  const tabs = createPluralMessage("tabCount", outcome.restored);

  switch (operation) {
    case "sort-by-domain":
      return createMessage("undoSortRestored", [tabs]);
    case "group-tabs":
      return createMessage("undoGroupRestored", [tabs]);
    case "ungroup-tabs":
      return createMessage("undoUngroupRestored", [
        tabs,
        createPluralMessage("domainGroupCount", outcome.groupCount),
      ]);
    case "gather-tabs-here":
      return createMessage("undoGatherRestored", [
        tabs,
        createPluralMessage("windowCount", outcome.windowCount),
      ]);
    default:
      return createMessage("undoOrganizationRestored", [tabs]);
  }
}

function getOperationPartialMessage(outcome, operation, failures) {
  const totalTabs = createPluralMessage("tabCount", outcome.total);
  const substitutions = [
    outcome.restored,
    totalTabs,
    outcome.failed,
    failures,
  ];
  switch (operation) {
    case "sort-by-domain":
      return createMessage("undoSortPartial", substitutions);
    case "group-tabs":
      return createMessage("undoGroupPartial", substitutions);
    case "ungroup-tabs":
      return createMessage("undoUngroupPartial", [
        ...substitutions,
        createPluralMessage("domainGroupCount", outcome.groupCount),
      ]);
    case "gather-tabs-here":
      return createMessage("undoGatherPartial", [
        ...substitutions,
        createPluralMessage("windowCount", outcome.windowCount),
      ]);
    default:
      return createMessage("undoOrganizationPartial", substitutions);
  }
}

function getOperationFailedKey(operation) {
  switch (operation) {
    case "sort-by-domain":
      return "undoSortFailed";
    case "group-tabs":
      return "undoGroupFailed";
    case "ungroup-tabs":
      return "undoUngroupFailed";
    case "gather-tabs-here":
      return "undoGatherFailed";
    default:
      return "undoOrganizationFailed";
  }
}
