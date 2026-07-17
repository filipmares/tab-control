const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function getTabUrl(tab) {
  return tab.pendingUrl || tab.url || "";
}

export function normalizeUrl(tab) {
  const value = getTabUrl(tab);

  if (!value) {
    return "";
  }

  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

export function getDomainInfo(tab) {
  const value = getTabUrl(tab);

  if (!value) {
    return { key: "unknown:", label: "Unknown" };
  }

  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();

    if (protocol === "http:" || protocol === "https:") {
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      return {
        key: hostname || protocol,
        label: hostname || protocol.slice(0, -1),
      };
    }

    if (protocol === "file:") {
      return { key: "file:", label: "Local files" };
    }

    if (protocol === "chrome-extension:") {
      return { key: "chrome-extension:", label: "Extensions" };
    }

    if (url.hostname) {
      const hostname = url.hostname.toLowerCase();
      return {
        key: `${protocol}//${hostname}`,
        label: `${protocol}//${hostname}`,
      };
    }

    const page = url.pathname.split("/").filter(Boolean)[0];
    const label = page ? `${protocol}${page}` : protocol.slice(0, -1);
    return { key: label.toLowerCase(), label };
  } catch {
    return { key: value.toLowerCase(), label: value };
  }
}

export function getDuplicateTabIds(tabs) {
  const groups = new Map();

  for (const tab of tabs) {
    const key = normalizeUrl(tab);

    if (!key || !Number.isInteger(tab.id)) {
      continue;
    }

    const group = groups.get(key) || [];
    group.push(tab);
    groups.set(key, group);
  }

  const duplicateIds = [];

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const ordered = [...group].sort(compareDuplicateKeepPriority);
    duplicateIds.push(...ordered.slice(1).map((tab) => tab.id));
  }

  return duplicateIds;
}

export function getReviewTabIdsToClose(tabs, tabIdToKeep) {
  return tabs
    .filter(
      (tab) => Number.isInteger(tab.id) && tab.id !== tabIdToKeep,
    )
    .map((tab) => tab.id);
}

export function getSortedTabIds(tabs) {
  const sortableTabs = tabs.filter((tab) => Number.isInteger(tab.id));
  const pinnedTabs = sortableTabs.filter((tab) => tab.pinned);
  const regularTabs = sortableTabs.filter((tab) => !tab.pinned);

  return [
    ...pinnedTabs.sort(compareTabsForDomainSort),
    ...regularTabs.sort(compareTabsForDomainSort),
  ].map((tab) => tab.id);
}

export function getDomainGroupingPlan(tabs) {
  const domains = new Map();

  for (const tab of tabs) {
    if (tab.pinned || !Number.isInteger(tab.id) || !getTabUrl(tab)) {
      continue;
    }

    const domain = getDomainInfo(tab);
    const entry = domains.get(domain.key) || {
      key: domain.key,
      label: domain.label,
      tabs: [],
    };

    entry.tabs.push(tab);
    domains.set(domain.key, entry);
  }

  return [...domains.values()]
    .filter((domain) => domain.tabs.length >= 2)
    .filter((domain) => !isAlreadyGroupedByDomain(domain, tabs))
    .sort((left, right) => collator.compare(left.key, right.key))
    .map((domain) => ({
      key: domain.key,
      label: domain.label,
      tabIds: [...domain.tabs]
        .sort((left, right) => left.index - right.index)
        .map((tab) => tab.id),
    }));
}

export function getDomainUngroupingPlan(tabs) {
  const groups = new Map();

  for (const tab of tabs) {
    if (
      !Number.isInteger(tab.id) ||
      !Number.isInteger(tab.groupId) ||
      tab.groupId < 0 ||
      !getTabUrl(tab)
    ) {
      continue;
    }

    const group = groups.get(tab.groupId) || [];
    group.push(tab);
    groups.set(tab.groupId, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => {
      const domainKey = getDomainInfo(group[0]).key;
      return group.every((tab) => getDomainInfo(tab).key === domainKey);
    })
    .sort(
      ([, left], [, right]) =>
        (left[0].index ?? Number.MAX_SAFE_INTEGER) -
        (right[0].index ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([groupId, group]) => {
      const domain = getDomainInfo(group[0]);

      return {
        groupId,
        key: domain.key,
        label: domain.label,
        tabIds: [...group]
          .sort(
            (left, right) =>
              (left.index ?? Number.MAX_SAFE_INTEGER) -
              (right.index ?? Number.MAX_SAFE_INTEGER),
          )
          .map((tab) => tab.id),
      };
    });
}

export function getGatherTabsPlan(windows, targetWindow) {
  if (!Number.isInteger(targetWindow?.id)) {
    return [];
  }

  return windows
    .filter(
      (window) =>
        window.id !== targetWindow.id &&
        window.type === "normal" &&
        Boolean(window.incognito) === Boolean(targetWindow.incognito),
    )
    .map((window) => ({
      windowId: window.id,
      tabIds: (window.tabs || [])
        .filter(
          (tab) =>
            Number.isInteger(tab.id) &&
            !tab.pinned &&
            (!Number.isInteger(tab.groupId) || tab.groupId < 0),
        )
        .sort(
          (left, right) =>
            (left.index ?? Number.MAX_SAFE_INTEGER) -
            (right.index ?? Number.MAX_SAFE_INTEGER),
        )
        .map((tab) => tab.id),
    }))
    .filter((source) => source.tabIds.length > 0);
}

export function getPartialDuplicateGroups(tabs) {
  const entries = tabs
    .map((tab) => createPartialUrlEntry(tab))
    .filter(Boolean);
  const parents = entries.map((_, index) => index);

  function find(index) {
    if (parents[index] !== index) {
      parents[index] = find(parents[index]);
    }

    return parents[index];
  }

  function union(leftIndex, rightIndex) {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);

    if (leftRoot !== rightRoot) {
      parents[rightRoot] = leftRoot;
    }
  }

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      if (isPartialUrlMatch(entries[leftIndex], entries[rightIndex])) {
        union(leftIndex, rightIndex);
      }
    }
  }

  const groups = new Map();

  for (const [index, entry] of entries.entries()) {
    const root = find(index);
    const group = groups.get(root) || [];
    group.push(entry.tab);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) =>
      group.sort(
        (left, right) =>
          (left.index ?? Number.MAX_SAFE_INTEGER) -
          (right.index ?? Number.MAX_SAFE_INTEGER),
      ),
    )
    .sort(
      (left, right) =>
        (left[0].index ?? Number.MAX_SAFE_INTEGER) -
        (right[0].index ?? Number.MAX_SAFE_INTEGER),
    );
}

export function getTabSummary(tabs) {
  const domains = new Set(tabs.map((tab) => getDomainInfo(tab).key));

  return {
    tabCount: tabs.length,
    duplicateCount: getDuplicateTabIds(tabs).length,
    domainCount: domains.size,
  };
}

function createPartialUrlEntry(tab) {
  if (!Number.isInteger(tab.id)) {
    return null;
  }

  try {
    const url = new URL(getTabUrl(tab));

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return {
      tab,
      href: url.href,
      origin: url.origin,
      path: normalizeComparisonPath(url.pathname),
    };
  } catch {
    return null;
  }
}

function isPartialUrlMatch(left, right) {
  if (left.origin !== right.origin || left.href === right.href) {
    return false;
  }

  if (left.path === right.path) {
    return true;
  }

  const [shorterPath, longerPath] =
    left.path.length < right.path.length
      ? [left.path, right.path]
      : [right.path, left.path];

  return (
    shorterPath !== "/" && longerPath.startsWith(`${shorterPath}/`)
  );
}

function normalizeComparisonPath(path) {
  if (path === "/") {
    return path;
  }

  return path.replace(/\/+$/, "");
}

function isAlreadyGroupedByDomain(domain, tabs) {
  const groupIds = new Set(domain.tabs.map((tab) => tab.groupId));

  if (groupIds.size !== 1) {
    return false;
  }

  const [groupId] = groupIds;

  if (!Number.isInteger(groupId) || groupId < 0) {
    return false;
  }

  const groupTabs = tabs.filter((tab) => tab.groupId === groupId);
  return (
    groupTabs.length === domain.tabs.length &&
    groupTabs.every((tab) => getDomainInfo(tab).key === domain.key)
  );
}

function compareDuplicateKeepPriority(left, right) {
  const leftIsActive = Boolean(left.active);
  const rightIsActive = Boolean(right.active);

  if (leftIsActive !== rightIsActive) {
    return leftIsActive ? -1 : 1;
  }

  const leftIsPinned = Boolean(left.pinned);
  const rightIsPinned = Boolean(right.pinned);

  if (leftIsPinned !== rightIsPinned) {
    return leftIsPinned ? -1 : 1;
  }

  return (left.index ?? Number.MAX_SAFE_INTEGER) -
    (right.index ?? Number.MAX_SAFE_INTEGER);
}

function compareTabsForDomainSort(left, right) {
  const leftDomain = getDomainInfo(left).key;
  const rightDomain = getDomainInfo(right).key;
  const domainOrder = collator.compare(leftDomain, rightDomain);

  if (domainOrder !== 0) {
    return domainOrder;
  }

  const titleOrder = collator.compare(left.title || "", right.title || "");

  if (titleOrder !== 0) {
    return titleOrder;
  }

  const urlOrder = collator.compare(normalizeUrl(left), normalizeUrl(right));

  if (urlOrder !== 0) {
    return urlOrder;
  }

  return (left.index ?? Number.MAX_SAFE_INTEGER) -
    (right.index ?? Number.MAX_SAFE_INTEGER);
}
