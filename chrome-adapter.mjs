export const LIVE_SUMMARY_TAB_EVENTS = [
  "onCreated",
  "onUpdated",
  "onMoved",
  "onAttached",
  "onDetached",
  "onRemoved",
  "onReplaced",
];

export function createChromeAdapter(api) {
  return {
    queryCurrentWindowTabs() {
      return api.tabs.query({ currentWindow: true });
    },
    getCurrentWindow() {
      return api.windows.getCurrent();
    },
    getNormalWindows() {
      return api.windows.getAll({ populate: true, windowTypes: ["normal"] });
    },
    async getCurrentWindowSnapshot() {
      const [currentWindow, windows] = await Promise.all([
        api.windows.getCurrent(),
        api.windows.getAll({ populate: true, windowTypes: ["normal"] }),
      ]);
      const tabs =
        windows.find((window) => window.id === currentWindow.id)?.tabs ??
        (await api.tabs.query({ currentWindow: true }));

      return { tabs, currentWindow, windows };
    },
    moveTab(tabId, index) {
      return api.tabs.move(tabId, { index });
    },
    moveTabsToWindow(tabIds, windowId) {
      return api.tabs.move(tabIds, { windowId, index: -1 });
    },
    groupTabs(tabIds) {
      return api.tabs.group({ tabIds });
    },
    updateTabGroup(groupId, properties) {
      return api.tabGroups.update(groupId, properties);
    },
    ungroupTabs(tabIds) {
      return api.tabs.ungroup(tabIds);
    },
    createTab(url) {
      return api.tabs.create({ url });
    },
    async sendBackgroundMessage(message) {
      const response = await api.runtime.sendMessage(message);

      if (!response?.ok) {
        throw new Error(response?.error || "The extension did not respond.");
      }

      return response;
    },
    isRecentlyClosedAvailable() {
      return typeof api.sessions?.getRecentlyClosed === "function";
    },
    getRecentlyClosed(maxResults) {
      return api.sessions.getRecentlyClosed({ maxResults });
    },
    restoreSession(sessionId) {
      return api.sessions.restore(sessionId);
    },
    onSessionsChanged(listener) {
      api.sessions?.onChanged?.addListener(listener);
    },
    onTabsChanged(listener) {
      const events = LIVE_SUMMARY_TAB_EVENTS.map((name) => api.tabs[name]);

      for (const event of events) {
        event.addListener(listener);
      }

      return function stopListening() {
        for (const event of events) {
          event.removeListener(listener);
        }
      };
    },
  };
}
