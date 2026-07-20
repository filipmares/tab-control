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
  openRecentlyClosed: document.querySelector("#open-recently-closed"),
  review: document.querySelector("#duplicate-review"),
  reviewTabs: document.querySelector("#review-tabs"),
  reviewProgress: document.querySelector("#review-progress"),
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
  actionHint: document.querySelector("#action-hint"),
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
};

elements.closeDuplicates.addEventListener("click", closeDuplicateTabs);
elements.sortByDomain.addEventListener("click", sortTabsByDomain);
elements.domainGroupToggle.addEventListener("click", toggleDomainGroups);
elements.gatherTabsHere.addEventListener("click", gatherTabsHere);
elements.openRecentlyClosed.addEventListener("click", openRecentlyClosed);
elements.keepAllReviewTabs.addEventListener("click", keepAllReviewTabs);
elements.closeAllReviewTabs.addEventListener("click", closeAllReviewTabs);
elements.recentBack.addEventListener("click", showActionsView);
elements.recentRefresh.addEventListener("click", () => loadRecentlyClosed());
elements.reportIssue.addEventListener("click", openIssueTracker);
chrome.sessions?.onChanged?.addListener(refreshOpenRecentlyClosedView);

initialize();

async function initialize() {
  try {
    const summary = await refreshSummary();
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
  elements.actions.hidden = true;
  elements.recentView.hidden = false;
  elements.status.hidden = true;
  elements.actionHint.hidden = true;
  elements.recentBack.focus();
  loadRecentlyClosed();
}

async function showActionsView() {
  state.view = "actions";
  elements.recentView.hidden = true;
  elements.actions.hidden = false;
  elements.status.hidden = false;
  elements.actionHint.hidden = false;
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
    const marker = document.createElement("span");
    const copy = document.createElement("span");
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

    marker.className = "recent-item__marker";
    marker.textContent = item.kind === "window" ? "WIN" : "TAB";
    marker.setAttribute("aria-hidden", "true");

    copy.className = "recent-item__copy";
    type.className = "recent-item__type";
    type.textContent = item.kind === "window" ? "Window" : "Tab";
    title.className = "recent-item__title";
    title.textContent = item.title;
    context.className = "recent-item__context";
    context.textContent = item.kind === "window" && representativeTitles
      ? `${item.context} · ${representativeTitles}`
      : item.context;
    restore.className = "recent-item__restore";
    restore.textContent = "Restore";
    restore.setAttribute("aria-hidden", "true");

    copy.append(type, title, context);
    button.append(marker, copy, restore);
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
    "Using Chrome's normal session restore behavior.",
    "busy",
  );
  syncRecentControlStates();

  try {
    await chrome.sessions.restore(item.sessionId);
    state.recentUnavailableIds.add(item.sessionId);
    await loadRecentlyClosed({
      title: `${item.kind === "window" ? "Window" : "Tab"} restored`,
      message: "Chrome restored the item and refreshed this browser-wide list.",
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
    const duplicateIds = getDuplicateTabIds(tabs);

    if (duplicateIds.length > 0) {
      await chrome.tabs.remove(duplicateIds);
    }

    const remainingTabs = await queryCurrentWindowTabs();
    const partialGroups = updateSummaryFromTabs(remainingTabs);

    if (partialGroups.length > 0) {
      startPartialReview(partialGroups, duplicateIds.length);
      return;
    }

    if (duplicateIds.length === 0) {
      setStatus("No duplicate or similar tab addresses found.");
      return;
    }

    setStatus(
      `Closed ${duplicateIds.length} exact duplicate ${pluralize("tab", duplicateIds.length)}.`,
      "success",
    );
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

  const prefix =
    exactClosedCount > 0
      ? `Closed ${exactClosedCount} exact ${pluralize("duplicate", exactClosedCount)}. `
      : "";
  setStatus(
    `${prefix}Review ${groups.length} possible ${pluralize("match", groups.length)}.`,
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
      await chrome.tabs.remove(tabIdsToClose);
      state.reviewClosedCount += tabIdsToClose.length;
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
      await chrome.tabs.remove(tabIdsToClose);
      state.reviewClosedCount += tabIdsToClose.length;
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
    setStatus(
      `Closed ${totalClosed} duplicate ${pluralize("tab", totalClosed)}.`,
      "success",
    );
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
  elements.openRecentlyClosed.disabled = actionsUnavailable;
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
