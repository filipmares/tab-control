import {
  getCurrentTabIdOrder,
  getDomainGroupingPlan,
  getDomainUngroupingPlan,
  getDuplicateTabIds,
  getGatherTabsPlan,
  getPartialDuplicateGroups,
  getReviewTabIdsToClose,
  getSortedTabIds,
  getTabsByIds,
  getTabSummary,
  isSameTabOrder,
} from "./tab-logic.mjs";
import {
  createRecentlyClosedViewModel,
  getRecentItemPresentation,
  getRecentKindLabel,
  getRecentListState,
  RECENT_SESSION_LIMIT,
} from "./recent-logic.mjs";
import {
  createDebouncedRefresh,
  formatCompactUrl,
  getHighlightedUrlSegments,
  getPopupActionShortcut,
  getReviewGroupLabels,
  getReviewTabPresentation,
} from "./popup-ui-logic.mjs";
import {
  formatDuplicateCleanupOutcome,
  formatGatherOutcome,
  formatGroupOutcome,
  formatGroupTitle,
  formatRestorationOutcome,
  formatReviewOutcome,
  formatReviewStopped,
  formatSortOutcome,
  formatSummary,
  formatUnclosedTabs,
  formatUngroupOutcome,
  getErrorMessage,
  getGroupColor,
  getTabUrlValue,
} from "./popup-format.mjs";
import {
  getActionControlState,
  getRecentControlState,
  getReviewControlState,
  getUndoControlState,
  shouldUngroupDomains,
} from "./popup-control-state.mjs";
import { createChromeAdapter } from "./chrome-adapter.mjs";
import { createTabEditRetry } from "./tab-edit-retry.mjs";

const LIVE_SUMMARY_REFRESH_DELAY = 100;
const ISSUE_TRACKER_URL = "https://github.com/filipmares/tab-control/issues/new";

const browser = createChromeAdapter(chrome);
const runWithTabEditRetry = createTabEditRetry();

const elements = {
  appHeader: document.querySelector("#app-header"),
  actions: document.querySelector("#tab-actions"),
  closeDuplicates: document.querySelector("#close-duplicates"),
  sortByDomain: document.querySelector("#sort-by-domain"),
  domainGroupToggle: document.querySelector("#toggle-domain-groups"),
  domainGroupTitle: document.querySelector("#domain-group-title"),
  domainGroupDescription: document.querySelector(
    "#domain-group-description",
  ),
  gatherTabsHere: document.querySelector("#gather-tabs-here"),
  openRecentlyClosed: document.querySelector("#open-recently-closed"),
  review: document.querySelector("#duplicate-review"),
  reviewTabs: document.querySelector("#review-tabs"),
  reviewProgress: document.querySelector("#review-progress"),
  stopReview: document.querySelector("#stop-review"),
  keepAllReviewTabs: document.querySelector("#keep-all-review-tabs"),
  closeAllReviewTabs: document.querySelector("#close-all-review-tabs"),
  recentView: document.querySelector("#recent-view"),
  recentBack: document.querySelector("#recent-back"),
  recentRefresh: document.querySelector("#recent-refresh"),
  recentList: document.querySelector("#recent-list"),
  recentState: document.querySelector("#recent-state"),
  recentStateTitle: document.querySelector("#recent-state-title"),
  recentStateMessage: document.querySelector("#recent-state-message"),
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
  view: "actions",
  recentLoading: false,
  recentRestoringId: null,
  recentUnavailableIds: new Set(),
  undoTransaction: null,
};

let liveSummaryRefreshGeneration = 0;
let stopLiveSummaryTabListening = null;
const liveSummaryRefresh = createDebouncedRefresh({
  delay: LIVE_SUMMARY_REFRESH_DELAY,
  shouldRefresh: canRefreshLiveSummary,
  refresh: () => {
    void refreshLiveSummary();
  },
});

elements.closeDuplicates.addEventListener("click", closeDuplicateTabs);
elements.sortByDomain.addEventListener("click", sortTabsByDomain);
elements.domainGroupToggle.addEventListener("click", toggleDomainGroups);
elements.gatherTabsHere.addEventListener("click", gatherTabsHere);
elements.openRecentlyClosed.addEventListener("click", openRecentlyClosed);
elements.stopReview.addEventListener("click", stopPartialReview);
elements.keepAllReviewTabs.addEventListener("click", keepAllReviewTabs);
elements.closeAllReviewTabs.addEventListener("click", closeAllReviewTabs);
elements.recentBack.addEventListener("click", showActionsView);
elements.recentRefresh.addEventListener("click", () => loadRecentlyClosed());
elements.undoCleanup.addEventListener("click", undoDuplicateCleanup);
elements.reportIssue.addEventListener("click", openIssueTracker);
document.addEventListener("keydown", handlePopupKeydown);
browser.onSessionsChanged(refreshOpenRecentlyClosedView);
stopLiveSummaryTabListening = browser.onTabsChanged(scheduleLiveSummaryRefresh);
window.addEventListener("unload", disposeLiveSummaryRefresh, { once: true });

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

function openRecentlyClosed() {
  if (state.busy || state.reviewing) {
    return;
  }

  liveSummaryRefreshGeneration += 1;
  state.view = "recent";
  elements.appHeader.hidden = true;
  elements.actions.hidden = true;
  elements.recentView.hidden = false;
  elements.status.hidden = true;
  elements.recentBack.focus();
  loadRecentlyClosed();
}

async function showActionsView() {
  state.view = "actions";
  elements.appHeader.hidden = false;
  elements.recentView.hidden = true;
  elements.actions.hidden = false;
  elements.status.hidden = false;
  setBusy(true, "Checking this window…");

  try {
    const summary = await refreshSummary();
    setStatus(formatSummary(summary, state.partialGroupCount));
  } catch (error) {
    setStatus(`Could not read this window. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
    elements.openRecentlyClosed.focus();
  }
}

async function loadRecentlyClosed(notice = null) {
  state.recentLoading = true;
  elements.recentView.setAttribute("aria-busy", "true");
  elements.recentList.replaceChildren();
  elements.recentList.hidden = true;
  showRecentState(
    "Loading recently closed items",
    "Reading Chrome's browser-wide session history.",
    "busy",
  );
  syncRecentControlStates();

  if (!browser.isRecentlyClosedAvailable()) {
    state.recentLoading = false;
    elements.recentView.removeAttribute("aria-busy");
    showRecentState(
      "Recently closed is unavailable",
      "Reload Tab Control from chrome://extensions. This view requires Chrome's sessions permission.",
      "unavailable",
    );
    syncRecentControlStates();
    return;
  }

  try {
    const sessions = await browser.getRecentlyClosed(RECENT_SESSION_LIMIT);
    const items = createRecentlyClosedViewModel(sessions).filter(
      (item) => !state.recentUnavailableIds.has(item.sessionId),
    );

    renderRecentlyClosedItems(items);

    const listState = getRecentListState({ itemCount: items.length, notice });

    if (listState) {
      showRecentState(listState.title, listState.message, listState.tone);
    } else {
      elements.recentState.hidden = true;
    }
  } catch (error) {
    showRecentState(
      "Recently closed is unavailable",
      `Chrome could not provide its session history. ${getErrorMessage(error)}`,
      "unavailable",
    );
  } finally {
    state.recentLoading = false;
    elements.recentView.removeAttribute("aria-busy");
    syncRecentControlStates();
  }
}

function renderRecentlyClosedItems(items) {
  elements.recentList.replaceChildren();

  for (const item of items) {
    const presentation = getRecentItemPresentation(item);
    const entry = document.createElement("li");
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const meta = document.createElement("span");
    const type = document.createElement("span");
    const title = document.createElement("strong");
    const context = document.createElement("span");
    const restore = document.createElement("span");

    entry.className = "recent__entry";
    button.type = "button";
    button.className = `recent-item recent-item--${item.kind}`;
    button.dataset.sessionId = item.sessionId;
    button.setAttribute("aria-label", item.ariaLabel);
    button.addEventListener("click", () => restoreRecentlyClosedItem(item));

    copy.className = "recent-item__copy";
    meta.className = "recent-item__meta";
    type.className = "recent-item__type";
    type.textContent = presentation.typeLabel;
    title.className = "recent-item__title";
    title.textContent = item.title;
    context.className = "recent-item__context";
    context.textContent = presentation.context;
    if (presentation.contextTitle) {
      context.title = presentation.contextTitle;
    }
    restore.className = "recent-item__restore";
    restore.textContent = "Restore";
    restore.setAttribute("aria-hidden", "true");

    meta.append(type, context);
    copy.append(title, meta);
    button.append(copy, restore);
    entry.append(button);
    elements.recentList.append(entry);
  }

  elements.recentList.hidden = items.length === 0;
}

async function restoreRecentlyClosedItem(item) {
  if (state.recentLoading || state.recentRestoringId) {
    return;
  }

  state.recentRestoringId = item.sessionId;
  showRecentState(
    `Restoring ${item.kind}`,
    "Chrome will reopen this item.",
    "busy",
  );
  syncRecentControlStates();

  try {
    await browser.restoreSession(item.sessionId);
    state.recentUnavailableIds.add(item.sessionId);
    await loadRecentlyClosed({
      title: `${getRecentKindLabel(item.kind)} restored`,
      message: "The recently closed list is up to date.",
      tone: "success",
    });
  } catch (error) {
    state.recentUnavailableIds.add(item.sessionId);
    await loadRecentlyClosed({
      title: `Could not restore ${item.kind}`,
      message: `${getErrorMessage(error)} The item may no longer be available; Chrome's list was refreshed.`,
      tone: "error",
    });
  } finally {
    state.recentRestoringId = null;
    syncRecentControlStates();
  }
}

function refreshOpenRecentlyClosedView() {
  if (
    state.view === "recent" &&
    !state.recentLoading &&
    !state.recentRestoringId
  ) {
    loadRecentlyClosed();
  }
}

function showRecentState(title, message, tone = "neutral") {
  elements.recentStateTitle.textContent = title;
  elements.recentStateMessage.textContent = message;
  elements.recentState.dataset.tone = tone;
  elements.recentState.hidden = false;
}

function syncRecentControlStates() {
  const { controlsDisabled } = getRecentControlState(state);
  elements.recentRefresh.disabled = controlsDisabled;

  for (const button of elements.recentList.querySelectorAll("button")) {
    button.disabled = controlsDisabled;
  }
}

async function closeDuplicateTabs() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Finding exact duplicate pages…");

  try {
    const tabs = await browser.queryCurrentWindowTabs();
    const currentWindow = await browser.getCurrentWindow();
    const startedTransaction = await browser.sendBackgroundMessage({
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

    const remainingTabs = await browser.queryCurrentWindowTabs();
    const partialGroups = updateSummaryFromTabs(remainingTabs);

    if (partialGroups.length > 0) {
      startPartialReview(partialGroups, closeResult.closedNow);
      return;
    }

    const outcome = formatDuplicateCleanupOutcome({
      duplicateCount: duplicateIds.length,
      closedNow: closeResult.closedNow,
      failed: closeResult.failed,
    });
    setStatus(outcome.message, outcome.tone);
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

  elements.appHeader.hidden = true;
  elements.actions.hidden = true;
  elements.review.hidden = false;
  renderReviewGroup();
  syncButtonStates();

  setStatus(
    "Choose which tabs to keep in each similar group.",
  );
}

function renderReviewGroup() {
  const group = state.reviewGroups[state.reviewIndex];
  const labels = getReviewGroupLabels(
    group,
    state.reviewIndex,
    state.reviewGroups.length,
  );
  elements.reviewProgress.textContent = labels.progress;
  elements.reviewTabs.replaceChildren();
  elements.keepAllReviewTabs.textContent = labels.keepAllLabel;
  elements.closeAllReviewTabs.textContent = labels.closeAllLabel;

  const fullUrls = group.map(getTabUrlValue);
  const compactUrls = fullUrls.map(formatCompactUrl);

  for (const [tabIndex, tab] of group.entries()) {
    const presentation = getReviewTabPresentation(tab, fullUrls[tabIndex]);
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const titleRow = document.createElement("span");
    const title = document.createElement("span");
    const url = document.createElement("span");
    const choice = document.createElement("span");

    button.type = "button";
    button.className = "review-tab";
    button.dataset.tabId = String(tab.id);
    button.setAttribute("aria-label", presentation.ariaLabel);
    button.addEventListener("click", () => keepOnlyReviewTab(tab.id));

    copy.className = "review-tab__copy";
    titleRow.className = "review-tab__title-row";
    title.className = "review-tab__title";
    title.textContent = presentation.title;
    url.className = "review-tab__url";
    url.title = fullUrls[tabIndex];
    appendHighlightedUrl(url, compactUrls, tabIndex);
    choice.className = "review-tab__choice";
    choice.textContent = "Keep this";

    titleRow.append(title);

    if (presentation.badge) {
      const badge = document.createElement("span");
      badge.className = "review-tab__badge";
      badge.textContent = presentation.badge;
      titleRow.append(badge);
    }

    copy.append(titleRow, url);
    button.append(copy, choice);
    elements.reviewTabs.append(button);
  }

  syncReviewControlStates();
  requestAnimationFrame(() => {
    elements.reviewTabs.querySelector("button")?.focus();
  });
}

async function stopPartialReview() {
  if (state.busy || !state.reviewing) {
    return;
  }

  const remainingCount = state.reviewGroups.length - state.reviewIndex;
  setBusy(true, "Stopping review…");
  leaveReview();

  try {
    await refreshSummary();
    setStatus(formatReviewStopped(remainingCount));
  } catch (error) {
    setStatus(
      `Review stopped, but this window could not be refreshed. ${getErrorMessage(error)}`,
      "error",
    );
  } finally {
    setBusy(false);
    elements.closeDuplicates.focus();
  }
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
        throw new Error(formatUnclosedTabs(result.failed));
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
        throw new Error(formatUnclosedTabs(result.failed));
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
    setStatus("Choose which tabs to keep in this similar group.");
    return;
  }

  await finishPartialReview();
}

async function finishPartialReview() {
  const totalClosed =
    state.reviewExactClosedCount + state.reviewClosedCount;
  const reviewedCount = state.reviewGroups.length;

  leaveReview();
  await refreshSummary();

  const outcome = formatReviewOutcome({
    closedCount: totalClosed,
    reviewedCount,
  });
  setStatus(outcome.message, outcome.tone);
}

async function sortTabsByDomain() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Filing tabs by domain…");

  try {
    const tabs = await browser.queryCurrentWindowTabs();
    const currentIds = getCurrentTabIdOrder(tabs);
    const sortedIds = getSortedTabIds(tabs);
    let hasMovedTab = false;

    if (isSameTabOrder(currentIds, sortedIds)) {
      setStatus("This window is already sorted by domain.");
      return;
    }

    for (const [index, tabId] of sortedIds.entries()) {
      // Positions stay accurate only until the first move, so the leading
      // already-correct run is the only safe part to skip.
      if (!hasMovedTab && currentIds[index] === tabId) {
        continue;
      }

      hasMovedTab = true;
      await moveTabWithRetry(tabId, index);
    }

    const summary = await refreshSummary();
    setStatus(formatSortOutcome(summary), "success");
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
    const tabs = await browser.queryCurrentWindowTabs();
    const groupingPlan = getDomainGroupingPlan(tabs);

    if (groupingPlan.length === 0) {
      setStatus("No ungrouped domains have multiple tabs.");
      return;
    }

    let groupedTabCount = 0;

    for (const domain of groupingPlan) {
      const groupId = await runWithTabEditRetry(() =>
        browser.groupTabs(domain.tabIds),
      );

      await browser.updateTabGroup(groupId, {
        title: formatGroupTitle(domain.label),
        color: getGroupColor(domain.key),
        collapsed: false,
      });

      groupedTabCount += domain.tabIds.length;
    }

    await refreshSummary();
    setStatus(
      formatGroupOutcome(groupedTabCount, groupingPlan.length),
      "success",
    );
  } catch (error) {
    setStatus(`Could not group tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

function toggleDomainGroups() {
  return shouldUngroupDomains(state)
    ? ungroupDomainGroups()
    : groupTabsByDomain();
}

async function ungroupDomainGroups() {
  if (state.busy) {
    return;
  }

  setBusy(true, "Removing domain groups…");

  try {
    const tabs = await browser.queryCurrentWindowTabs();
    const ungroupingPlan = getDomainUngroupingPlan(tabs);

    if (ungroupingPlan.length === 0) {
      setStatus("No same-domain tab groups found.");
      return;
    }

    const tabIds = ungroupingPlan.flatMap((group) => group.tabIds);
    await runWithTabEditRetry(() => browser.ungroupTabs(tabIds));
    await refreshSummary();

    setStatus(
      formatUngroupOutcome(tabIds.length, ungroupingPlan.length),
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
      browser.getCurrentWindow(),
      browser.getNormalWindows(),
    ]);
    const gatherPlan = getGatherTabsPlan(windows, currentWindow);

    if (gatherPlan.length === 0) {
      setStatus("No loose tabs found in other windows.");
      return;
    }

    let gatheredTabCount = 0;

    for (const source of gatherPlan) {
      await runWithTabEditRetry(() =>
        browser.moveTabsToWindow(source.tabIds, currentWindow.id),
      );
      gatheredTabCount += source.tabIds.length;
    }

    await refreshSummary();
    setStatus(
      formatGatherOutcome(gatheredTabCount, gatherPlan.length),
      "success",
    );
  } catch (error) {
    setStatus(`Could not gather tabs. ${getErrorMessage(error)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshSummary() {
  const snapshot = await readSummarySnapshot();
  return applySummarySnapshot(snapshot);
}

async function refreshLiveSummary() {
  const generation = liveSummaryRefreshGeneration;

  try {
    const snapshot = await readSummarySnapshot();

    if (
      generation !== liveSummaryRefreshGeneration ||
      !canRefreshLiveSummary()
    ) {
      return;
    }

    const summary = applySummarySnapshot(snapshot);
    setStatus(formatSummary(summary, state.partialGroupCount));
  } catch (error) {
    if (generation === liveSummaryRefreshGeneration && canRefreshLiveSummary()) {
      setStatus(
        `Could not refresh this window. ${getErrorMessage(error)}`,
        "error",
      );
    }
  }
}

async function readSummarySnapshot() {
  const [tabs, currentWindow, windows] = await Promise.all([
    browser.queryCurrentWindowTabs(),
    browser.getCurrentWindow(),
    browser.getNormalWindows(),
  ]);

  return {
    tabs,
    gatherableTabCount: getGatherTabsPlan(windows, currentWindow).reduce(
      (count, source) => count + source.tabIds.length,
      0,
    ),
  };
}

function applySummarySnapshot(snapshot) {
  updateSummaryFromTabs(snapshot.tabs);
  state.gatherableTabCount = snapshot.gatherableTabCount;
  syncButtonStates();

  return state.summary;
}

function canRefreshLiveSummary() {
  return state.view === "actions" && !state.busy && !state.reviewing;
}

function scheduleLiveSummaryRefresh() {
  liveSummaryRefreshGeneration += 1;
  liveSummaryRefresh.schedule();
}

function disposeLiveSummaryRefresh() {
  liveSummaryRefreshGeneration += 1;
  liveSummaryRefresh.dispose();
  stopLiveSummaryTabListening?.();
  stopLiveSummaryTabListening = null;
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

async function closeTabsForCleanup(tabs) {
  if (!state.undoTransaction?.id) {
    throw new Error("The duplicate cleanup transaction is unavailable.");
  }

  const result = await browser.sendBackgroundMessage({
    type: "CLOSE_CLEANUP_TABS",
    transactionId: state.undoTransaction.id,
    tabs,
  });
  updateUndoTransaction(result.transaction);
  return result;
}

async function getUndoTransaction() {
  const result = await browser.sendBackgroundMessage({
    type: "GET_DUPLICATE_CLEANUP_UNDO",
  });
  return result.transaction;
}

async function undoDuplicateCleanup() {
  if (state.busy || !state.undoTransaction?.id) {
    return;
  }

  const transactionId = state.undoTransaction.id;

  if (state.reviewing) {
    leaveReview();
  }

  setBusy(true, "Restoring closed tabs…");

  try {
    const result = await browser.sendBackgroundMessage({
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
  const { message, tone } = formatRestorationOutcome(outcome);
  setStatus(message, tone);
}

async function moveTabWithRetry(tabId, index) {
  await runWithTabEditRetry(() => browser.moveTab(tabId, index));
}

function setBusy(busy, message) {
  if (busy) {
    liveSummaryRefreshGeneration += 1;
  }

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
  const controls = getActionControlState(state);

  elements.closeDuplicates.disabled = controls.closeDuplicatesDisabled;
  elements.sortByDomain.disabled = controls.sortByDomainDisabled;
  elements.domainGroupToggle.disabled = controls.domainGroupToggleDisabled;
  elements.domainGroupTitle.textContent = controls.domainGroupTitle;
  elements.domainGroupDescription.textContent = controls.domainGroupDescription;
  elements.domainGroupToggle.title = controls.domainGroupActionDescription;
  elements.domainGroupToggle.setAttribute(
    "aria-description",
    controls.domainGroupActionDescription,
  );
  elements.gatherTabsHere.disabled = controls.gatherTabsHereDisabled;
  elements.openRecentlyClosed.disabled = controls.openRecentlyClosedDisabled;
}

function syncReviewControlStates() {
  const { controlsDisabled } = getReviewControlState(state);

  elements.stopReview.disabled = controlsDisabled;
  elements.keepAllReviewTabs.disabled = controlsDisabled;
  elements.closeAllReviewTabs.disabled = controlsDisabled;

  for (const button of elements.reviewTabs.querySelectorAll("button")) {
    button.disabled = controlsDisabled;
  }
}

function leaveReview() {
  state.reviewing = false;
  state.reviewGroups = [];
  state.reviewIndex = 0;
  state.reviewExactClosedCount = 0;
  state.reviewClosedCount = 0;
  elements.review.hidden = true;
  elements.actions.hidden = false;
  elements.appHeader.hidden = false;
  syncButtonStates();
}

function handlePopupKeydown(event) {
  if (event.key === "Escape") {
    if (state.reviewing) {
      event.preventDefault();
      stopPartialReview();
    } else if (state.view === "recent") {
      event.preventDefault();
      showActionsView();
    }
    return;
  }

  if (state.view !== "actions" || state.reviewing || state.busy) {
    return;
  }

  const actionId = getPopupActionShortcut(event);
  const action = actionId ? document.getElementById(actionId) : null;

  if (!action || action.disabled) {
    return;
  }

  event.preventDefault();
  action.click();
}

function appendHighlightedUrl(element, values, valueIndex) {
  const { before, highlight, after } = getHighlightedUrlSegments(
    values,
    valueIndex,
  );

  if (!highlight) {
    element.textContent = before;
    return;
  }

  const mark = document.createElement("mark");
  mark.textContent = highlight;
  element.append(
    document.createTextNode(before),
    mark,
    document.createTextNode(after),
  );
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
  const undo = getUndoControlState(state);

  elements.undoOffer.hidden = undo.hidden;
  elements.undoCleanup.disabled = undo.disabled;

  if (undo.hidden) {
    return;
  }

  elements.undoText.textContent = undo.text;
  elements.undoCleanup.setAttribute("aria-label", undo.ariaLabel);
}

function openIssueTracker() {
  browser.createTab(ISSUE_TRACKER_URL);
}
