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
    return "Address unavailable";
  }

  try {
    const url = new URL(urlValue);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.toLowerCase().replace(/^www\./, "") ||
        "Address unavailable";
    }

    if (url.protocol === "file:") {
      return "Local file";
    }

    if (url.hostname) {
      return `${url.protocol}//${url.hostname}`;
    }

    return url.protocol.slice(0, -1) || "Address unavailable";
  } catch {
    return urlValue;
  }
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
    tabCount: 1,
    representativeTitles: [title],
    lastModified: getLastModified({ lastModified }),
    ariaLabel: `Restore tab: ${title}, ${domain}`,
  };
}

function createWindowItem(window, lastModified) {
  const tabs = Array.isArray(window.tabs) ? window.tabs : [];
  const representativeTitles = getRepresentativeTitles(tabs);
  const tabCount = tabs.length;
  const title = representativeTitles[0] || "Recently closed window";
  const countLabel = `${tabCount} ${pluralize("tab", tabCount)}`;
  const representativeLabel = representativeTitles.join(", ");

  return {
    sessionId: window.sessionId,
    kind: "window",
    title,
    context: countLabel,
    tabCount,
    representativeTitles,
    lastModified: getLastModified({ lastModified }),
    ariaLabel: representativeLabel
      ? `Restore window with ${countLabel}: ${representativeLabel}`
      : `Restore window with ${countLabel}`,
  };
}

function getRepresentativeTitles(tabs) {
  const labels = [];
  const seen = new Set();

  for (const tab of tabs) {
    const label = getTabLabel(tab);
    const key = label.toLocaleLowerCase();

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
  return title || (tab?.url ? formatRecentDomain(tab.url) : "Untitled tab");
}

function getLastModified(session) {
  return Number.isFinite(session?.lastModified) ? session.lastModified : 0;
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}
