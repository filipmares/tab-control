# Privacy

Tab Control processes tab information locally inside Chrome.

## Data handling

Tab Control does not:

- collect browsing history or personal information;
- transmit tab titles, addresses, or usage data;
- use analytics or tracking services;
- store tab information after an action completes.

## Permissions

- `tabs` allows the extension to read, close, and move tabs.
- `tabGroups` allows the extension to create, label, color, and remove native
  Chrome tab groups.

Incognito windows remain separate and are only accessible if the user
explicitly enables the extension in incognito mode. Cross-window gathering
never moves tabs between regular and incognito contexts.

Questions or concerns can be reported through this repository's GitHub issues.
