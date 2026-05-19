// Runs when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ total: 0, lastSite: null });
});