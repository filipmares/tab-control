# Privacy

Tab Control processes tab information locally inside Chrome.

## Data handling

Tab Control does not:

- collect or build a separate browsing history or personal profile;
- transmit tab titles, addresses, or usage data;
- use analytics or tracking services;
- keep a permanent or synced tab history.

For the Undo feature, Tab Control keeps the addresses and positions of tabs
closed by the latest duplicate cleanup in Chrome's in-memory session storage.
This one transaction is replaced by the next cleanup, removed after Undo, and
cleared when Chrome restarts, the extension reloads, or the extension is
disabled.

The Recently closed view reads up to 10 entries from Chrome's browser-wide
recently closed session history while the popup is open. Those entries can
include tabs and windows closed outside Tab Control. They remain managed by
Chrome and are neither copied into a Tab Control history nor sent elsewhere.

## Permissions

- `tabs` allows the extension to read, close, and move tabs.
- `tabGroups` allows the extension to create, label, color, and remove native
  Chrome tab groups.
- `sessions` allows the extension to read and restore Chrome's browser-wide
  recently closed tabs and windows.
- `storage` keeps the latest duplicate cleanup available to Undo only for the
  current browser session.

Incognito windows remain separate and are only accessible if the user
explicitly enables the extension in incognito mode. Cross-window gathering
never moves tabs between regular and incognito contexts.

Questions or concerns can be reported through this repository's GitHub issues.
