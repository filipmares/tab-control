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
  formatCompactUrl,
  getDifferenceRange,
  getPopupActionShortcut,
} from "./popup-ui-logic.mjs";
import { ORGANIZATION_ACTION } from "./organization-undo.mjs";

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
  undoAction: document.querySelector("#undo-action"),
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
  cleanupUndoTransaction: null,
  organizationUndoTransaction: null,
};

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
elements.undoAction.addEventListener("click", undoLatestAction);
elements.reportIssue.addEventListener("click", openIssueTracker);
document.addEventListener("keydown", handlePopupKeydown);
chrome.sessions?.onChanged?.addListener(refreshOpenRecentlyClosedView);

initialize();

async function initialize() {
  try {
    const [summary, cleanupUndoTransaction, organizationUndoTransaction] =
      await Promise.all([
        refreshSummary(),
        getCleanupUndoTransaction(),
        getOrganizationUndoTransaction(),
      ]);
    updateCleanupUndoTransaction(cleanupUndoTransaction);
    updateOrganizationUndoTransaction(organizationUndoTransaction);
    setStatus(formatSummary(summary, state.partialGroupCount));
  } catch (error) {
    setStatus(`Could not read this window. ${getErrorMessage(error)}`, "error");
  }
}

function openRecentlyClosed() {
  if (state.busy || state.reviewing) {
    return;
  }

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
    updateCleanupUndoTransaction(startedTransaction.transaction);

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

    const currentWindow = await chrome.windows.getCurrent();
    const result = await beginOrganizationAction({
      action: ORGANIZATION_ACTION.SORT,
      label: `Sorted ${tabs.length} ${pluralize("tab", tabs.length)}`,
      count: tabs.length,
      windowIds: [currentWindow.id],
      operation: { tabIds: sortedIds },
    });
    handleOrganizationActionResult(result, "Could not sort tabs.");
    const summary = await refreshSummary();
    setStatus(
      `Sorted ${summary.tabCount} ${pluralize("tab", summary.tabCount)} across ${summary.domainCount} ${pluralize("site", summary.domainCount)}.`,
      "success",
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
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

    const currentWindow = await chrome.windows.getCurrent();
    const tabCount = groupingPlan.reduce(
      (count, domain) => count + domain.tabIds.length,
      0,
    );
    const result = await beginOrganizationAction({
      action: ORGANIZATION_ACTION.GROUP,
      label: `Grouped ${tabCount} ${pluralize("tab", tabCount)}`,
      count: tabCount,
      windowIds: [currentWindow.id],
      operation: {
        groups: groupingPlan.map((domain) => ({
          tabIds: domain.tabIds,
          title: formatGroupTitle(domain.label),
          color: getGroupColor(domain.key),
        })),
      },
    });
    handleOrganizationActionResult(result, "Could not group tabs.");
    await refreshSummary();
    setStatus(
      `Grouped ${tabCount} ${pluralize("tab", tabCount)} into ${groupingPlan.length} domain ${pluralize("group", groupingPlan.length)}.`,
      "success",
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
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
    const currentWindow = await chrome.windows.getCurrent();
    const result = await beginOrganizationAction({
      action: ORGANIZATION_ACTION.UNGROUP,
      label: `Ungrouped ${tabIds.length} ${pluralize("tab", tabIds.length)}`,
      count: tabIds.length,
      windowIds: [currentWindow.id],
      operation: { tabIds },
    });
    handleOrganizationActionResult(result, "Could not ungroup tabs.");
    await refreshSummary();

    setStatus(
      `Ungrouped ${tabIds.length} ${pluralize("tab", tabIds.length)} from ${ungroupingPlan.length} domain ${pluralize("group", ungroupingPlan.length)}.`,
      "success",
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
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

    const gatheredTabTotal = gatherPlan.reduce(
      (count, source) => count + source.tabIds.length,
      0,
    );
    const result = await beginOrganizationAction({
      action: ORGANIZATION_ACTION.GATHER,
      label: `Gathered ${gatheredTabTotal} ${pluralize("tab", gatheredTabTotal)}`,
      count: gatheredTabTotal,
      windowIds: [
        currentWindow.id,
        ...gatherPlan.map((source) => source.windowId),
      ],
      operation: {
        targetWindowId: currentWindow.id,
        sources: gatherPlan,
      },
    });
    handleOrganizationActionResult(result, "Could not gather tabs.");
    await refreshSummary();
    setStatus(
      `Gathered ${gatheredTabTotal} ${pluralize("tab", gatheredTabTotal)} from ${gatherPlan.length} other ${pluralize("window", gatherPlan.length)}.`,
      "success",
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
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
  if (!state.cleanupUndoTransaction?.id) {
    throw new Error("The duplicate cleanup transaction is unavailable.");
  }

  const result = await sendBackgroundMessage({
    type: "CLOSE_CLEANUP_TABS",
    transactionId: state.cleanupUndoTransaction.id,
    tabs,
  });
  updateCleanupUndoTransaction(result.transaction);
  return result;
}

async function getCleanupUndoTransaction() {
  const result = await sendBackgroundMessage({
    type: "GET_DUPLICATE_CLEANUP_UNDO",
  });
  return result.transaction;
}

async function getOrganizationUndoTransaction() {
  const result = await sendBackgroundMessage({
    type: "GET_ORGANIZATION_UNDO",
  });
  return result.transaction;
}

async function undoLatestAction() {
  const undo = getLatestUndoTransaction();

  if (state.busy || !undo) {
    return;
  }

  if (state.reviewing) {
    leaveReview();
  }

  if (undo.type === "cleanup") {
    await undoDuplicateCleanup(undo);
    return;
  }

  await undoOrganizationAction(undo);
}

async function undoDuplicateCleanup(undo) {
  const transactionId = undo.id;
  setBusy(true, "Restoring closed tabs…");

  try {
    const result = await sendBackgroundMessage({
      type: "RESTORE_DUPLICATE_CLEANUP",
      transactionId,
    });
    updateCleanupUndoTransaction(result.transaction);
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

async function undoOrganizationAction(undo) {
  setBusy(true, "Restoring the previous tab arrangement…");

  try {
    const result = await sendBackgroundMessage({
      type: "RESTORE_ORGANIZATION_ACTION",
      transactionId: undo.id,
    });
    updateOrganizationUndoTransaction(result.transaction);
    showOrganizationRestorationOutcome(result.outcome);
    await refreshSummary();
  } catch (error) {
    setStatus(
      `Could not restore the previous arrangement. ${getErrorMessage(error)}`,
      "error",
    );
  } finally {
    setBusy(false);
  }
}

function showOrganizationRestorationOutcome(outcome) {
  switch (outcome.status) {
    case "restored":
      setStatus("Restored the previous tab arrangement.", "success");
      break;
    case "partial":
      setStatus(
        `Undo restored only part of the previous arrangement. ${outcome.error || ""}`.trim(),
        "error",
      );
      break;
    case "failed":
      setStatus(
        `Could not restore the previous arrangement. ${outcome.error || "The saved state is no longer available."}`,
        "error",
      );
      break;
    default:
      setStatus("Undo is no longer available.", "error");
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
}

function setStatus(message, tone = "neutral") {
  elements.statusText.textContent = message;
  elements.status.dataset.tone = tone;
}

function updateCleanupUndoTransaction(transaction) {
  state.cleanupUndoTransaction = transaction;
  syncUndoState();
}

function updateOrganizationUndoTransaction(transaction) {
  state.organizationUndoTransaction = transaction;
  syncUndoState();
}

function syncUndoState() {
  const undo = getLatestUndoTransaction();
  elements.undoOffer.hidden = !undo;
  elements.undoAction.disabled = state.busy;

  if (!undo) {
    return;
  }

  const description = undo.type === "cleanup"
    ? `Closed ${undo.count} ${pluralize("tab", undo.count)}`
    : undo.label;
  elements.undoText.textContent = description;
  elements.undoAction.setAttribute(
    "aria-label",
    `Undo ${description.toLowerCase()}`,
  );
}

function getLatestUndoTransaction() {
  const candidates = [
    state.cleanupUndoTransaction?.count > 0 && {
      ...state.cleanupUndoTransaction,
      type: "cleanup",
    },
    state.organizationUndoTransaction && {
      ...state.organizationUndoTransaction,
      type: "organization",
    },
  ].filter(Boolean);

  return candidates.sort(
    (left, right) => right.createdAt - left.createdAt,
  )[0] || null;
}

async function beginOrganizationAction({
  action,
  label,
  count,
  windowIds,
  operation,
}) {
  return sendBackgroundMessage({
    type: "RUN_ORGANIZATION_ACTION",
    action,
    label,
    count,
    windowIds,
    operation,
  });
}

function handleOrganizationActionResult(result, failurePrefix) {
  updateOrganizationUndoTransaction(result.transaction);

  if (result.status === "completed") {
    return;
  }

  const undoNotice = result.transaction
    ? " Undo is available for the changes that were made."
    : "";
  throw new Error(
    `${failurePrefix} ${result.error || "Chrome could not complete the action."}${undoNotice}`,
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

function openIssueTracker() {
  chrome.tabs.create({
    url: "https://github.com/filipmares/tab-control/issues/new",
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
