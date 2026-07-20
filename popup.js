import {
  getDomainGroupingPlan,
  getDomainUngroupingPlan,
  getDuplicateTabIds,
  getGatherTabsPlan,
  getPartialDuplicateGroups,
  getReviewTabIdsToClose,
  getSortedTabIds,
  getTabSummary,
} from "./tab-logic.mjs";

const elements = {
  actions: document.querySelector("#tab-actions"),
  closeDuplicates: document.querySelector("#close-duplicates"),
  sortByDomain: document.querySelector("#sort-by-domain"),
  domainGroupToggle: document.querySelector("#toggle-domain-groups"),
  domainGroupIcon: document.querySelector("#domain-group-icon"),
  domainGroupTitle: document.querySelector("#domain-group-title"),
  domainGroupDescription: document.querySelector(
    "#domain-group-description",
  ),
  gatherTabsHere: document.querySelector("#gather-tabs-here"),
  review: document.querySelector("#duplicate-review"),
  reviewTabs: document.querySelector("#review-tabs"),
  reviewProgress: document.querySelector("#review-progress"),
  keepAllReviewTabs: document.querySelector("#keep-all-review-tabs"),
  closeAllReviewTabs: document.querySelector("#close-all-review-tabs"),
  status: document.querySelector("#status"),
  statusText: document.querySelector("#status-text"),
  undoOffer: document.querySelector("#undo-offer"),
  undoText: document.querySelector("#undo-text"),
  undoCleanup: document.querySelector("#undo-cleanup"),
  reportIssue: document.querySelector("#report-issue"),
};

const state = {
  busy: false,
  summary: {
    tabCount: 0,
    duplicateCount: 0,
    domainCount: 0,
  },
  groupableDomainCount: 0,
  ungroupableDomainCount: 0,
  gatherableTabCount: 0,
  partialGroupCount: 0,
  reviewing: false,
  reviewGroups: [],
  reviewIndex: 0,
  reviewExactClosedCount: 0,
  reviewClosedCount: 0,
  undoTransaction: null,
};

elements.closeDuplicates.addEventListener("click", closeDuplicateTabs);
elements.sortByDomain.addEventListener("click", sortTabsByDomain);
elements.domainGroupToggle.addEventListener("click", toggleDomainGroups);
elements.gatherTabsHere.addEventListener("click", gatherTabsHere);
elements.keepAllReviewTabs.addEventListener("click", keepAllReviewTabs);
elements.closeAllReviewTabs.addEventListener("click", closeAllReviewTabs);
elements.undoCleanup.addEventListener("click", undoDuplicateCleanup);
elements.reportIssue.addEventListener("click", openIssueTracker);

initialize();

async function initialize() {
  try {
    const [summary, undoTransaction] = await Promise.all([
      refreshSummary(),
      getUndoTransaction(),
    ]);
    updateUndoTransaction(undoTransaction);
    setStatus(formatSummary(summary, state.partialGroupCount));
  } catch (error) {
    setStatus(`Could not read this window. ${getErrorMessage(error)}`, "error");
  }
}

async function closeDuplicateTabs() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Finding exact duplicate pages…");

  try {
    const tabs = await queryCurrentWindowTabs();
    const currentWindow = await chrome.windows.getCurrent();
    const startedTransaction = await sendBackgroundMessage({
      type: "BEGIN_DUPLICATE_CLEANUP",
      windowId: currentWindow.id,
    });
    updateUndoTransaction(startedTransaction.transaction);

    const duplicateIds = getDuplicateTabIds(tabs);
    const duplicateTabs = getTabsByIds(tabs, duplicateIds);
    let closeResult = {
      transaction: startedTransaction.transaction,
      closedNow: 0,
      failed: 0,
    };

    if (duplicateTabs.length > 0) {
      closeResult = await closeTabsForCleanup(duplicateTabs);
    }

    const remainingTabs = await queryCurrentWindowTabs();
    const partialGroups = updateSummaryFromTabs(remainingTabs);

    if (partialGroups.length > 0) {
      startPartialReview(partialGroups, closeResult.closedNow);
      return;
    }

    if (duplicateIds.length === 0) {
      setStatus("No duplicate or similar tab addresses found.");
      return;
    }

    if (closeResult.closedNow === 0) {
      setStatus("Could not close the exact duplicate tabs.", "error");
    } else if (closeResult.failed > 0) {
      setStatus(
        `${closeResult.failed} exact ${pluralize("duplicate", closeResult.failed)} could not be closed.`,
        "error",
      );
    } else {
      setStatus("Duplicate cleanup complete.", "success");
    }
  } catch (error) {
    setStatus(`Could not close duplicates. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

function startPartialReview(groups, exactClosedCount) {
  state.reviewing = true;
  state.reviewGroups = groups;
  state.reviewIndex = 0;
  state.reviewExactClosedCount = exactClosedCount;
  state.reviewClosedCount = 0;

  elements.actions.hidden = true;
  elements.review.hidden = false;
  renderReviewGroup();
  syncButtonStates();

  setStatus(
    `Review ${groups.length} possible ${pluralize("match", groups.length)}.`,
  );
}

function renderReviewGroup() {
  const group = state.reviewGroups[state.reviewIndex];
  elements.reviewProgress.textContent =
    `${state.reviewIndex + 1} / ${state.reviewGroups.length}`;
  elements.reviewTabs.replaceChildren();
  elements.keepAllReviewTabs.textContent =
    group.length === 2 ? "Keep both tabs" : "Keep all tabs in this match";
  elements.closeAllReviewTabs.textContent =
    group.length === 2 ? "Close both tabs" : "Close all tabs in this match";

  for (const tab of group) {
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const title = document.createElement("span");
    const url = document.createElement("span");
    const choice = document.createElement("span");

    button.type = "button";
    button.className = "review-tab";
    button.dataset.tabId = String(tab.id);
    button.setAttribute(
      "aria-label",
      `Keep ${tab.title || formatTabUrl(tab)} and close the other matching tabs`,
    );
    button.addEventListener("click", () => keepOnlyReviewTab(tab.id));

    copy.className = "review-tab__copy";
    title.className = "review-tab__title";
    title.textContent = tab.title || "Untitled tab";
    url.className = "review-tab__url";
    url.textContent = formatTabUrl(tab);
    choice.className = "review-tab__choice";
    choice.textContent = "Keep";

    copy.append(title, url);

    if (tab.active || tab.pinned) {
      const badge = document.createElement("span");
      badge.className = "review-tab__badge";
      badge.textContent = [tab.active && "Active", tab.pinned && "Pinned"]
        .filter(Boolean)
        .join(" · ");
      copy.append(badge);
    }

    button.append(copy, choice);
    elements.reviewTabs.append(button);
  }

  syncReviewControlStates();
  requestAnimationFrame(() => {
    elements.reviewTabs.querySelector("button")?.focus();
  });
}

async function keepOnlyReviewTab(tabId) {
  if (state.busy) {
    return;
  }

  const group = state.reviewGroups[state.reviewIndex];
  const tabIdsToClose = getReviewTabIdsToClose(group, tabId);

  setBusy(true, "Applying your duplicate choice…");

  try {
    if (tabIdsToClose.length > 0) {
      const result = await closeTabsForCleanup(
        getTabsByIds(group, tabIdsToClose),
      );
      state.reviewClosedCount += result.closedNow;

      if (result.failed > 0) {
        throw new Error(
          `${result.failed} ${pluralize("tab", result.failed)} could not be closed.`,
        );
      }
    }

    await advanceReview();
  } catch (error) {
    setStatus(`Could not apply this choice. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function keepAllReviewTabs() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Keeping these tabs…");

  try {
    await advanceReview();
  } catch (error) {
    setStatus(`Could not continue the review. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function closeAllReviewTabs() {
  if (state.busy) {
    return;
  }

  const group = state.reviewGroups[state.reviewIndex];
  const tabIdsToClose = getReviewTabIdsToClose(group);

  setBusy(true, "Closing these tabs…");

  try {
    if (tabIdsToClose.length > 0) {
      const result = await closeTabsForCleanup(
        getTabsByIds(group, tabIdsToClose),
      );
      state.reviewClosedCount += result.closedNow;

      if (result.failed > 0) {
        throw new Error(
          `${result.failed} ${pluralize("tab", result.failed)} could not be closed.`,
        );
      }
    }

    await advanceReview();
  } catch (error) {
    setStatus(`Could not close these tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function advanceReview() {
  state.reviewIndex += 1;

  if (state.reviewIndex < state.reviewGroups.length) {
    renderReviewGroup();
    setStatus(
      `Review possible match ${state.reviewIndex + 1} of ${state.reviewGroups.length}.`,
    );
    return;
  }

  await finishPartialReview();
}

async function finishPartialReview() {
  const totalClosed =
    state.reviewExactClosedCount + state.reviewClosedCount;
  const reviewedCount = state.reviewGroups.length;

  state.reviewing = false;
  state.reviewGroups = [];
  state.reviewIndex = 0;
  state.reviewExactClosedCount = 0;
  state.reviewClosedCount = 0;

  elements.review.hidden = true;
  elements.actions.hidden = false;
  await refreshSummary();

  if (totalClosed > 0) {
    setStatus("Duplicate cleanup complete.", "success");
  } else {
    setStatus(
      `Kept all tabs from ${reviewedCount} possible ${pluralize("match", reviewedCount)}.`,
    );
  }
}

async function sortTabsByDomain() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Filing tabs by domain…");

  try {
    const tabs = await queryCurrentWindowTabs();
    const currentIds = [...tabs]
      .sort((left, right) => left.index - right.index)
      .map((tab) => tab.id);
    const sortedIds = getSortedTabIds(tabs);

    if (arraysMatch(currentIds, sortedIds)) {
      setStatus("This window is already sorted by domain.");
      return;
    }

    for (const [index, tabId] of sortedIds.entries()) {
      await moveTabWithRetry(tabId, index);
    }

    const summary = await refreshSummary();
    setStatus(
      `Sorted ${summary.tabCount} ${pluralize("tab", summary.tabCount)} across ${summary.domainCount} ${pluralize("site", summary.domainCount)}.`,
      "success",
    );
  } catch (error) {
    setStatus(`Could not sort tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function groupTabsByDomain() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Building domain groups…");

  try {
    const tabs = await queryCurrentWindowTabs();
    const groupingPlan = getDomainGroupingPlan(tabs);

    if (groupingPlan.length === 0) {
      setStatus("No ungrouped domains have multiple tabs.");
      return;
    }

    let groupedTabCount = 0;

    for (const domain of groupingPlan) {
      const groupId = await runWithTabEditRetry(() =>
        chrome.tabs.group({ tabIds: domain.tabIds }),
      );

      await chrome.tabGroups.update(groupId, {
        title: formatGroupTitle(domain.label),
        color: getGroupColor(domain.key),
        collapsed: false,
      });

      groupedTabCount += domain.tabIds.length;
    }

    await refreshSummary();
    setStatus(
      `Grouped ${groupedTabCount} ${pluralize("tab", groupedTabCount)} into ${groupingPlan.length} domain ${pluralize("group", groupingPlan.length)}.`,
      "success",
    );
  } catch (error) {
    setStatus(`Could not group tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

function toggleDomainGroups() {
  return state.ungroupableDomainCount > 0
    ? ungroupDomainGroups()
    : groupTabsByDomain();
}

async function ungroupDomainGroups() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Removing domain groups…");

  try {
    const tabs = await queryCurrentWindowTabs();
    const ungroupingPlan = getDomainUngroupingPlan(tabs);

    if (ungroupingPlan.length === 0) {
      setStatus("No same-domain tab groups found.");
      return;
    }

    const tabIds = ungroupingPlan.flatMap((group) => group.tabIds);
    await runWithTabEditRetry(() => chrome.tabs.ungroup(tabIds));
    await refreshSummary();

    setStatus(
      `Ungrouped ${tabIds.length} ${pluralize("tab", tabIds.length)} from ${ungroupingPlan.length} domain ${pluralize("group", ungroupingPlan.length)}.`,
      "success",
    );
  } catch (error) {
    setStatus(`Could not ungroup tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function gatherTabsHere() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Gathering tabs from other windows…");

  try {
    const [currentWindow, windows] = await Promise.all([
      chrome.windows.getCurrent(),
      queryNormalWindows(),
    ]);
    const gatherPlan = getGatherTabsPlan(windows, currentWindow);

    if (gatherPlan.length === 0) {
      setStatus("No loose tabs found in other windows.");
      return;
    }

    let gatheredTabCount = 0;

    for (const source of gatherPlan) {
      await runWithTabEditRetry(() =>
        chrome.tabs.move(source.tabIds, {
          windowId: currentWindow.id,
          index: -1,
        }),
      );
      gatheredTabCount += source.tabIds.length;
    }

    await refreshSummary();
    setStatus(
      `Gathered ${gatheredTabCount} ${pluralize("tab", gatheredTabCount)} from ${gatherPlan.length} other ${pluralize("window", gatherPlan.length)}.`,
      "success",
    );
  } catch (error) {
    setStatus(`Could not gather tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshSummary() {
  const [tabs, currentWindow, windows] = await Promise.all([
    queryCurrentWindowTabs(),
    chrome.windows.getCurrent(),
    queryNormalWindows(),
  ]);
  updateSummaryFromTabs(tabs);
  state.gatherableTabCount = getGatherTabsPlan(
    windows,
    currentWindow,
  ).reduce((count, source) => count + source.tabIds.length, 0);
  syncButtonStates();

  return state.summary;
}

function updateSummaryFromTabs(tabs) {
  state.summary = getTabSummary(tabs);
  state.groupableDomainCount = getDomainGroupingPlan(tabs).length;
  state.ungroupableDomainCount = getDomainUngroupingPlan(tabs).length;
  const partialGroups = getPartialDuplicateGroups(tabs);
  state.partialGroupCount = partialGroups.length;

  syncButtonStates();
  return partialGroups;
}

function queryCurrentWindowTabs() {
  return chrome.tabs.query({ currentWindow: true });
}

function queryNormalWindows() {
  return chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });
}

async function closeTabsForCleanup(tabs) {
  if (!state.undoTransaction?.id) {
    throw new Error("The duplicate cleanup transaction is unavailable.");
  }

  const result = await sendBackgroundMessage({
    type: "CLOSE_CLEANUP_TABS",
    transactionId: state.undoTransaction.id,
    tabs,
  });
  updateUndoTransaction(result.transaction);
  return result;
}

async function getUndoTransaction() {
  const result = await sendBackgroundMessage({
    type: "GET_DUPLICATE_CLEANUP_UNDO",
  });
  return result.transaction;
}

async function undoDuplicateCleanup() {
  if (state.busy || !state.undoTransaction?.id) {
    return;
  }

  const transactionId = state.undoTransaction.id;
  setBusy(true, "Restoring closed tabs…");

  try {
    const result = await sendBackgroundMessage({
      type: "RESTORE_DUPLICATE_CLEANUP",
      transactionId,
    });
    updateUndoTransaction(result.transaction);
    showRestorationOutcome(result.outcome);
    await refreshSummary();
  } catch (error) {
    setStatus(
      `Could not restore closed tabs. ${getErrorMessage(error)}`,
      "error",
    );
  } finally {
    setBusy(false);
  }
}

function showRestorationOutcome(outcome) {
  switch (outcome.status) {
    case "restored":
      setStatus(
        `Restored ${outcome.restored} ${pluralize("tab", outcome.restored)}.`,
        "success",
      );
      break;
    case "partial":
      setStatus(
        `Restored ${outcome.restored} of ${outcome.total} tabs. ${outcome.failed} could not be restored.`,
        "error",
      );
      break;
    case "failed": {
      const detail = outcome.error ? ` ${outcome.error}` : "";
      setStatus(
        `Could not restore ${outcome.total} closed ${pluralize("tab", outcome.total)}.${detail}`,
        "error",
      );
      break;
    }
    default:
      setStatus("Undo is no longer available.", "error");
  }
}

function sendBackgroundMessage(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) {
      throw new Error(response?.error || "The extension did not respond.");
    }

    return response;
  });
}

async function moveTabWithRetry(tabId, index) {
  await runWithTabEditRetry(() => chrome.tabs.move(tabId, { index }));
}

async function runWithTabEditRetry(operation) {
  const retryLimit = 3;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isTemporaryEditLock = getErrorMessage(error).includes(
        "Tabs cannot be edited right now",
      );

      if (!isTemporaryEditLock || attempt === retryLimit) {
        throw error;
      }

      await wait(60 * (attempt + 1));
    }
  }
}

function setBusy(busy, message) {
  state.busy = busy;
  document.body.toggleAttribute("aria-busy", busy);
  syncButtonStates();
  syncReviewControlStates();
  syncUndoState();

  if (busy && message) {
    setStatus(message, "busy");
  }
}

function syncButtonStates() {
  const actionsUnavailable = state.busy || state.reviewing;
  const shouldUngroup = state.ungroupableDomainCount > 0;

  elements.closeDuplicates.disabled =
    actionsUnavailable ||
    (state.summary.duplicateCount === 0 && state.partialGroupCount === 0);
  elements.sortByDomain.disabled =
    actionsUnavailable || state.summary.tabCount < 2;
  elements.domainGroupToggle.disabled =
    actionsUnavailable ||
    (shouldUngroup
      ? state.ungroupableDomainCount === 0
      : state.groupableDomainCount === 0);

  elements.domainGroupToggle.classList.toggle(
    "action--blue",
    !shouldUngroup,
  );
  elements.domainGroupToggle.classList.toggle(
    "action--green",
    shouldUngroup,
  );
  elements.domainGroupIcon.textContent = shouldUngroup ? "UNG" : "GRP";
  elements.domainGroupTitle.textContent = shouldUngroup
    ? "Ungroup tabs"
    : "Group tabs by domain";
  elements.domainGroupDescription.textContent = shouldUngroup
    ? "Remove same-domain groups only"
    : "Group sites with two or more tabs";
  elements.gatherTabsHere.disabled =
    actionsUnavailable || state.gatherableTabCount === 0;
}

function syncReviewControlStates() {
  elements.keepAllReviewTabs.disabled = state.busy;
  elements.closeAllReviewTabs.disabled = state.busy;

  for (const button of elements.reviewTabs.querySelectorAll("button")) {
    button.disabled = state.busy;
  }
}

function setStatus(message, tone = "neutral") {
  elements.statusText.textContent = message;
  elements.status.dataset.tone = tone;
}

function updateUndoTransaction(transaction) {
  state.undoTransaction = transaction;
  syncUndoState();
}

function syncUndoState() {
  const count = state.undoTransaction?.count || 0;
  elements.undoOffer.hidden = count === 0;
  elements.undoCleanup.disabled = state.busy;

  if (count === 0) {
    return;
  }

  elements.undoText.textContent =
    `Closed ${count} ${pluralize("tab", count)}`;
  elements.undoCleanup.setAttribute(
    "aria-label",
    `Undo the latest duplicate cleanup and restore ${count} ${pluralize("tab", count)}`,
  );
}

function getTabsByIds(tabs, tabIds) {
  const ids = new Set(tabIds);
  return tabs.filter((tab) => ids.has(tab.id));
}

function arraysMatch(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function formatSummary(summary, partialGroupCount) {
  return `${summary.tabCount} ${pluralize("tab", summary.tabCount)} · ${summary.duplicateCount} exact · ${partialGroupCount} possible · ${summary.domainCount} ${pluralize("site", summary.domainCount)}`;
}

function formatGroupTitle(label) {
  return label.length <= 24 ? label : `${label.slice(0, 23)}…`;
}

function getGroupColor(key) {
  const colors = [
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
  let hash = 0;

  for (const character of key) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }

  return colors[hash % colors.length];
}

function formatTabUrl(tab) {
  const value = tab.pendingUrl || tab.url || "Unknown URL";

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function openIssueTracker() {
  chrome.tabs.create({
    url: "https://github.com/filipmares/tab-control/issues/new",
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
