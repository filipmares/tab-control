# Privacy

Tab Control processes tab information locally inside Chrome.

## Data handling

Tab Control does not:

- collect or build a separate browsing history or personal profile;
- transmit tab titles, addresses, or usage data;
- use analytics or tracking services;
- store tab information after an action completes.

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

Incognito windows remain separate and are only accessible if the user
explicitly enables the extension in incognito mode. Cross-window gathering
never moves tabs between regular and incognito contexts.

Questions or concerns can be reported through this repository's GitHub issues.
