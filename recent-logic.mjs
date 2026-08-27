import { createMessage, createPluralMessage } from "./i18n.mjs";

export const RECENT_SESSION_LIMIT = 10;

export function createRecentlyClosedViewModel(
  sessions,
  limit = RECENT_SESSION_LIMIT,
) {
  if (!Array.isArray(sessions)) {
    return [];
  }

  const safeLimit = Number.isInteger(limit) && limit >= 0
    ? limit
    : RECENT_SESSION_LIMIT;

  return sessions
    .map((session, index) => ({ session, index }))
    .sort(
      (left, right) =>
        getLastModified(right.session) - getLastModified(left.session) ||
        left.index - right.index,
    )
    .map(({ session }) => createRecentlyClosedItem(session))
    .filter(Boolean)
    .slice(0, safeLimit);
}

export function formatRecentDomain(urlValue) {
  if (!urlValue) {
    return createMessage("addressUnavailable");
  }

  try {
    const url = new URL(urlValue);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.toLowerCase().replace(/^www\./, "") ||
        createMessage("addressUnavailable");
    }

    if (url.protocol === "file:") {
      return createMessage("localFile");
    }

    if (url.hostname) {
      return `${url.protocol}//${url.hostname}`;
    }

    return url.protocol.slice(0, -1) || createMessage("addressUnavailable");
  } catch {
    return urlValue;
  }
}

export function getRecentKindLabel(kind) {
  return createMessage(kind === "window" ? "windowKind" : "tabKind");
}

export function getRecentItemPresentation(item) {
  const supportingTitles = item.representativeTitles.slice(1);

  return {
    typeLabel: getRecentKindLabel(item.kind),
    context: item.kind === "window" && supportingTitles.length > 0
      ? createMessage("recentWindowContext", [item.context, supportingTitles])
      : item.context,
    contextTitle: item.fullContext || null,
  };
}

export function getRecentListState({ itemCount, notice = null }) {
  if (itemCount > 0) {
    return notice
      ? { title: notice.title, message: notice.message, tone: notice.tone }
      : null;
  }

  const restoredEverything = notice?.tone === "success";

  return {
    title: createMessage("nothingRecentlyClosed"),
    message: restoredEverything
      ? createMessage("recentListEmptyAfterRestore", [notice.message])
      : createMessage("recentListEmpty"),
    tone: restoredEverything ? "success" : "neutral",
  };
}

function createRecentlyClosedItem(session) {
  if (session?.tab?.sessionId) {
    return createTabItem(session.tab, session.lastModified);
  }

  if (session?.window?.sessionId) {
    return createWindowItem(session.window, session.lastModified);
  }

  return null;
}

function createTabItem(tab, lastModified) {
  const domain = formatRecentDomain(tab.url);
  const title = getTabLabel(tab);

  return {
    sessionId: tab.sessionId,
    kind: "tab",
    title,
    context: domain,
    fullContext: tab.url || "",
    tabCount: 1,
    representativeTitles: [title],
    lastModified: getLastModified({ lastModified }),
    ariaLabel: createMessage("restoreTabLabel", [title, domain]),
  };
}

function createWindowItem(window, lastModified) {
  const tabs = Array.isArray(window.tabs) ? window.tabs : [];
  const representativeTitles = getRepresentativeTitles(tabs);
  const tabCount = tabs.length;
  const title = representativeTitles[0] ||
    createMessage("recentlyClosedWindow");
  const countLabel = createPluralMessage("tabCount", tabCount);

  return {
    sessionId: window.sessionId,
    kind: "window",
    title,
    context: countLabel,
    fullContext: "",
    tabCount,
    representativeTitles,
    lastModified: getLastModified({ lastModified }),
    ariaLabel: representativeTitles.length > 0
      ? createMessage("restoreWindowLabelWithTitles", [
        countLabel,
        representativeTitles,
      ])
      : createMessage("restoreWindowLabel", [countLabel]),
  };
}

function getRepresentativeTitles(tabs) {
  const labels = [];
  const seen = new Set();

  for (const tab of tabs) {
    const label = getTabLabel(tab);
    const key = typeof label === "string"
      ? label.toLocaleLowerCase()
      : JSON.stringify(label);

    if (!seen.has(key)) {
      labels.push(label);
      seen.add(key);
    }

    if (labels.length === 3) {
      break;
    }
  }

  return labels;
}

function getTabLabel(tab) {
  const title = typeof tab?.title === "string" ? tab.title.trim() : "";
  return title ||
    (tab?.url ? formatRecentDomain(tab.url) : createMessage("untitledTab"));
}

function getLastModified(session) {
  return Number.isFinite(session?.lastModified) ? session.lastModified : 0;
}
