const clutteredTabs = [
  {
    id: 101,
    index: 0,
    pinned: true,
    active: false,
    title: "Inbox (12) - mail",
    url: "https://mail.google.com/mail/u/0/#inbox",
  },
  {
    id: 102,
    index: 1,
    active: true,
    title: "feat: redesign popup interface by filipmares · Pull Request #20",
    url: "https://github.com/filipmares/tab-control/pull/20",
  },
  {
    id: 103,
    index: 2,
    title: "feat: redesign popup interface by filipmares · Pull Request #20",
    url: "https://github.com/filipmares/tab-control/pull/20",
  },
  {
    id: 104,
    index: 3,
    title: "Braun design audit – Figma",
    url: "https://www.figma.com/file/braun-audit",
  },
  {
    id: 105,
    index: 4,
    title: "Braun design audit – Figma",
    url: "https://www.figma.com/file/braun-audit/tokens",
  },
  {
    id: 106,
    index: 5,
    title: "Issues · filipmares/tab-control",
    url: "https://github.com/filipmares/tab-control/issues",
  },
  {
    id: 107,
    index: 6,
    title: "chrome.tabs | Chrome Extensions",
    url: "https://developer.chrome.com/docs/extensions/reference/tabs",
  },
  {
    id: 108,
    index: 7,
    title: "chrome.tabs | Chrome Extensions",
    url: "https://developer.chrome.com/docs/extensions/reference/tabs/",
  },
  {
    id: 109,
    index: 8,
    title: "chrome.tabGroups | Chrome Extensions",
    url: "https://developer.chrome.com/docs/extensions/reference/tabGroups",
  },
  {
    id: 110,
    index: 9,
    title: "Technology - The New York Times",
    url: "https://www.nytimes.com/section/technology",
  },
];

const exactDuplicateTabs = [
  {
    id: 201,
    index: 0,
    pinned: true,
    title: "Inbox (12) - mail",
    url: "https://mail.google.com/mail/u/0/#inbox",
  },
  {
    id: 202,
    index: 1,
    active: true,
    title: "Issues · filipmares/tab-control",
    url: "https://github.com/filipmares/tab-control/issues",
  },
  {
    id: 203,
    index: 2,
    title: "Issues · filipmares/tab-control",
    url: "https://github.com/filipmares/tab-control/issues",
  },
  {
    id: 204,
    index: 3,
    title: "chrome.tabs | Chrome Extensions",
    url: "https://developer.chrome.com/docs/extensions/reference/tabs",
  },
  {
    id: 205,
    index: 4,
    title: "chrome.tabs | Chrome Extensions",
    url: "https://developer.chrome.com/docs/extensions/reference/tabs",
  },
  {
    id: 206,
    index: 5,
    title: "Technology - The New York Times",
    url: "https://www.nytimes.com/section/technology",
  },
];

const looseTabs = [
  {
    id: 301,
    index: 0,
    active: true,
    title: "Archivo - Google Fonts",
    url: "https://fonts.google.com/specimen/Archivo",
  },
  {
    id: 302,
    index: 1,
    title: "Web Content Accessibility Guidelines 2.2",
    url: "https://www.w3.org/TR/WCAG22/",
  },
  {
    id: 303,
    index: 2,
    title: "Dieter Rams: ten principles for good design",
    url: "https://www.vitsoe.com/gb/about/good-design",
  },
];

const recentlyClosed = [
  {
    lastModified: 1_770_000_900,
    tab: {
      sessionId: "r1",
      title: "Manifest V3 migration checklist",
      url: "https://developer.chrome.com/docs/extensions/develop/migrate",
    },
  },
  {
    lastModified: 1_770_000_800,
    window: {
      sessionId: "r2",
      tabs: [
        { title: "Release Please", url: "https://github.com/googleapis/release-please" },
        { title: "Conventional Commits", url: "https://www.conventionalcommits.org" },
        { title: "Semantic Versioning", url: "https://semver.org" },
        { title: "Keep a Changelog", url: "https://keepachangelog.com" },
      ],
    },
  },
  {
    lastModified: 1_770_000_700,
    tab: {
      sessionId: "r3",
      title: "Chrome Web Store image guidelines",
      url: "https://developer.chrome.com/docs/webstore/images",
    },
  },
  {
    lastModified: 1_770_000_600,
    tab: {
      sessionId: "r4",
      title: "Braun SK 4 – Museum of Modern Art",
      url: "https://www.moma.org/collection/works/braun-sk4",
    },
  },
  {
    lastModified: 1_770_000_500,
    tab: {
      sessionId: "r5",
      title: "Technology - The New York Times",
      url: "https://www.nytimes.com/section/technology",
    },
  },
];

function buildWorld(tabs) {
  return {
    currentWindowId: 1,
    windows: [
      { id: 1, type: "normal", incognito: false, tabs },
      { id: 2, type: "normal", incognito: false, tabs: looseTabs },
    ],
    recentlyClosed,
  };
}

export const scenarios = {
  actions: { world: () => buildWorld(clutteredTabs), drive: null },
  review: { world: () => buildWorld(clutteredTabs), drive: "close-duplicates" },
  grouped: { world: () => buildWorld(clutteredTabs), drive: "toggle-domain-groups" },
  gathered: { world: () => buildWorld(clutteredTabs), drive: "gather-tabs-here" },
  recent: { world: () => buildWorld(clutteredTabs), drive: "open-recently-closed" },
  cleanup: { world: () => buildWorld(exactDuplicateTabs), drive: "close-duplicates" },
};
