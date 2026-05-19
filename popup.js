chrome.storage.local.get(['total', 'lastSite'], (data) => {
  const t = data.total || 0;
  document.getElementById('total').textContent =
    t < 1 ? t.toFixed(2) + 'g' : t.toFixed(1) + 'g';
});