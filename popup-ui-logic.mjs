const ACTION_SHORTCUTS = new Map([
  ["d", "close-duplicates"],
  ["s", "sort-by-domain"],
  ["g", "toggle-domain-groups"],
  ["a", "gather-tabs-here"],
  ["r", "open-recently-closed"],
]);

export function getPopupActionShortcut(event) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return null;
  }

  return ACTION_SHORTCUTS.get(event.key.toLowerCase()) || null;
}

export function getDifferenceRange(values, valueIndex) {
  const value = values[valueIndex] || "";

  if (values.length < 2 || values.every((candidate) => candidate === value)) {
    return null;
  }

  let prefixLength = 0;
  const shortestLength = Math.min(...values.map((candidate) => candidate.length));

  while (
    prefixLength < shortestLength &&
    values.every((candidate) => candidate[prefixLength] === value[prefixLength])
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = shortestLength - prefixLength;

  while (
    suffixLength < maxSuffixLength &&
    values.every(
      (candidate) =>
        candidate[candidate.length - 1 - suffixLength] ===
        value[value.length - 1 - suffixLength],
    )
  ) {
    suffixLength += 1;
  }

  return {
    start: prefixLength,
    end: value.length - suffixLength,
  };
}

export function formatCompactUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return value;
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .map((segment) => decodeUrlSegment(segment));
    const path = segments.join("/");
    const suffix = `${url.search}${compactHash(url.hash)}`;

    return path || suffix ? `${hostname} / ${path}${suffix}` : hostname;
  } catch {
    return value;
  }
}

function decodeUrlSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function compactHash(hash) {
  if (hash.length <= 18) {
    return hash;
  }

  return `${hash.slice(0, 17)}…`;
}
