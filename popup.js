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
import {
  createRecentlyClosedViewModel,
  RECENT_SESSION_LIMIT,
} from "./recent-logic.mjs";
import {
  createDebouncedRefresh,
  formatCompactUrl,
  getDifferenceRange,
  getPopupActionShortcut,
} from "./popup-ui-logic.mjs";

const LIVE_SUMMARY_REFRESH_DELAY = 100;

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
const liveSummaryRefresh = createDebouncedRefresh({
  delay: LIVE_SUMMARY_REFRESH_DELAY,
  shouldRefresh: canRefreshLiveSummary,
  refresh: () => {
    void refreshLiveSummary();
  },
});
const liveSummaryTabEvents = [
  chrome.tabs.onCreated,
  chrome.tabs.onUpdated,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.tabs.onRemoved,
  chrome.tabs.onReplaced,
];

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
chrome.sessions?.onChanged?.addListener(refreshOpenRecentlyClosedView);
for (const event of liveSummaryTabEvents) {
  event.addListener(scheduleLiveSummaryRefresh);
}
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

  if (typeof chrome.sessions?.getRecentlyClosed !== "function") {
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
    const sessions = await chrome.sessions.getRecentlyClosed({
      maxResults: RECENT_SESSION_LIMIT,
    });
    const items = createRecentlyClosedViewModel(sessions).filter(
      (item) => !state.recentUnavailableIds.has(item.sessionId),
    );

    renderRecentlyClosedItems(items);

    if (items.length === 0) {
      const message = notice?.tone === "success"
        ? `${notice.message} Chrome's browser-wide list is now empty.`
        : "Close a tab or window in Chrome, then refresh this view.";
      showRecentState(
        "Nothing recently closed",
        message,
        notice?.tone === "success" ? "success" : "neutral",
      );
    } else if (notice) {
      showRecentState(notice.title, notice.message, notice.tone);
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
    const entry = document.createElement("li");
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const meta = document.createElement("span");
    const type = document.createElement("span");
    const title = document.createElement("strong");
    const context = document.createElement("span");
    const restore = document.createElement("span");
    const representativeTitles = item.representativeTitles.slice(1).join(" · ");

    entry.className = "recent__entry";
    button.type = "button";
    button.className = `recent-item recent-item--${item.kind}`;
    button.dataset.sessionId = item.sessionId;
    button.setAttribute("aria-label", item.ariaLabel);
    button.addEventListener("click", () => restoreRecentlyClosedItem(item));

    copy.className = "recent-item__copy";
    meta.className = "recent-item__meta";
    type.className = "recent-item__type";
    type.textContent = item.kind === "window" ? "Window" : "Tab";
    title.className = "recent-item__title";
    title.textContent = item.title;
    context.className = "recent-item__context";
    context.textContent = item.kind === "window" && representativeTitles
      ? `${item.context} · ${representativeTitles}`
      : item.context;
    if (item.fullContext) {
      context.title = item.fullContext;
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
    await chrome.sessions.restore(item.sessionId);
    state.recentUnavailableIds.add(item.sessionId);
    await loadRecentlyClosed({
      title: `${item.kind === "window" ? "Window" : "Tab"} restored`,
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
  const unavailable =
    state.recentLoading || Boolean(state.recentRestoringId);
  elements.recentRefresh.disabled = unavailable;

  for (const button of elements.recentList.querySelectorAll("button")) {
    button.disabled = unavailable;
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
  elements.reviewProgress.textContent =
    `Match ${state.reviewIndex + 1} of ${state.reviewGroups.length}`;
  elements.reviewTabs.replaceChildren();
  elements.keepAllReviewTabs.textContent =
    group.length === 2 ? "Keep both tabs" : "Keep all tabs in this match";
  elements.closeAllReviewTabs.textContent =
    group.length === 2 ? "Close both tabs" : "Close all tabs in this match";

  const fullUrls = group.map(getTabUrlValue);
  const compactUrls = fullUrls.map(formatCompactUrl);

  for (const [tabIndex, tab] of group.entries()) {
    const stateDescription = [tab.active && "active", tab.pinned && "pinned"]
      .filter(Boolean)
      .join(" and ");
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const titleRow = document.createElement("span");
    const title = document.createElement("span");
    const url = document.createElement("span");
    const choice = document.createElement("span");

    button.type = "button";
    button.className = "review-tab";
    button.dataset.tabId = String(tab.id);
    button.setAttribute(
      "aria-label",
      [
        `Keep ${tab.title || "untitled tab"}`,
        fullUrls[tabIndex],
        stateDescription,
        "and close the other matching tabs",
      ]
        .filter(Boolean)
        .join(", "),
    );
    button.addEventListener("click", () => keepOnlyReviewTab(tab.id));

    copy.className = "review-tab__copy";
    titleRow.className = "review-tab__title-row";
    title.className = "review-tab__title";
    title.textContent = tab.title || "Untitled tab";
    url.className = "review-tab__url";
    url.title = fullUrls[tabIndex];
    appendHighlightedUrl(url, compactUrls, tabIndex);
    choice.className = "review-tab__choice";
    choice.textContent = "Keep this";

    titleRow.append(title);

    if (tab.active || tab.pinned) {
      const badge = document.createElement("span");
      badge.className = "review-tab__badge";
      badge.textContent = [tab.active && "Active", tab.pinned && "Pinned"]
        .filter(Boolean)
        .join(" · ");
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
    setStatus(
      `Review stopped. ${remainingCount} possible ${pluralize("match", remainingCount)} left unchanged.`,
    );
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
    queryCurrentWindowTabs(),
    chrome.windows.getCurrent(),
    queryNormalWindows(),
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

  for (const event of liveSummaryTabEvents) {
    event.removeListener(scheduleLiveSummaryRefresh);
  }
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

  if (state.reviewing) {
    leaveReview();
  }

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
  const actionsUnavailable = state.busy || state.reviewing;
  const shouldUngroup = state.ungroupableDomainCount > 0;
  const groupActionDescription = shouldUngroup
    ? "Removes groups that contain tabs from a single domain"
    : "Groups sites with two or more tabs by domain";

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

  elements.domainGroupTitle.textContent = shouldUngroup
    ? "Ungroup tabs"
    : "Group tabs by domain";
  elements.domainGroupDescription.textContent = shouldUngroup
    ? "Remove same-domain groups only"
    : "Group sites with two or more tabs";
  elements.domainGroupToggle.title = groupActionDescription;
  elements.domainGroupToggle.setAttribute(
    "aria-description",
    groupActionDescription,
  );
  elements.gatherTabsHere.disabled =
    actionsUnavailable || state.gatherableTabCount === 0;
  elements.openRecentlyClosed.disabled = actionsUnavailable;
}

function syncReviewControlStates() {
  elements.stopReview.disabled = state.busy;
  elements.keepAllReviewTabs.disabled = state.busy;
  elements.closeAllReviewTabs.disabled = state.busy;

  for (const button of elements.reviewTabs.querySelectorAll("button")) {
    button.disabled = state.busy;
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
  const value = values[valueIndex];
  const difference = getDifferenceRange(values, valueIndex);

  if (!difference || difference.start === difference.end) {
    element.textContent = value;
    return;
  }

  const before = document.createTextNode(value.slice(0, difference.start));
  const mark = document.createElement("mark");
  const after = document.createTextNode(value.slice(difference.end));
  mark.textContent = value.slice(difference.start, difference.end);
  element.append(before, mark, after);
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

function getTabUrlValue(tab) {
  return tab.pendingUrl || tab.url || "Unknown URL";
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
