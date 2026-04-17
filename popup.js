// ── Storage helpers ──────────────────────────────────────────────

function getBookmarks() {
  return new Promise(resolve => {
    chrome.storage.local.get('bookmarks', ({ bookmarks = [] }) => resolve(bookmarks));
  });
}

function setBookmarks(bookmarks) {
  return new Promise(resolve => {
    chrome.storage.local.set({ bookmarks }, resolve);
  });
}

// ── Tab helpers ──────────────────────────────────────────────────

function tabToBookmark(tab, source = 'single') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: tab.title || tab.url,
    url: tab.url,
    favicon: tab.favIconUrl || '',
    savedAt: Date.now(),
    source, // 'single' | 'window' | 'all'
  };
}

// De-duplicate against existing bookmarks by URL
function dedup(incoming, existing) {
  const existingUrls = new Set(existing.map(b => b.url));
  return incoming.filter(b => !existingUrls.has(b.url));
}

// Filter out chrome:// and extension pages
function isCaptureable(tab) {
  return tab.url &&
    !tab.url.startsWith('chrome://') &&
    !tab.url.startsWith('chrome-extension://') &&
    !tab.url.startsWith('about:');
}

// ── UI helpers ───────────────────────────────────────────────────

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function formatUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function render(bookmarks) {
  const list = document.getElementById('bookmark-list');
  const badge = document.getElementById('count-badge');

  badge.textContent = `${bookmarks.length} saved`;

  if (bookmarks.length === 0) {
    list.innerHTML = `<div class="empty-state">No tabs saved yet.<br>Capture one above to get started.</div>`;
    return;
  }

  // Newest first
  const sorted = [...bookmarks].sort((a, b) => b.savedAt - a.savedAt);

  list.innerHTML = sorted.map(b => {
    const tagClass = b.source === 'window' ? 'bulk' : b.source === 'all' ? 'all' : '';
    const tagLabel = b.source === 'window' ? 'window' : b.source === 'all' ? 'all' : '';

    return `
      <div class="bookmark-item">
        ${b.favicon
          ? `<img class="bookmark-favicon" src="${b.favicon}" alt="" />`
          : `<div class="bookmark-favicon"></div>`
        }
        <div class="bookmark-info">
          <a class="bookmark-title" href="${b.url}" target="_blank" title="${b.title}">${b.title}</a>
          <div class="bookmark-url">${formatUrl(b.url)}</div>
        </div>
        ${tagLabel ? `<span class="bookmark-tag ${tagClass}">${tagLabel}</span>` : ''}
        <button class="remove-btn" data-id="${b.id}" title="Remove">×</button>
      </div>
    `;
  }).join('');

  // Remove individual bookmark
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      const current = await getBookmarks();
      const updated = current.filter(b => b.id !== id);
      await setBookmarks(updated);
      render(updated);
    });
  });
}

// ── Tab counts for button labels ─────────────────────────────────

async function updateCounts() {
  const [currentWindow] = await Promise.all([
    chrome.windows.getCurrent({ populate: true })
  ]);

  const windowTabs = currentWindow.tabs.filter(isCaptureable);
  document.getElementById('window-count').textContent = `${windowTabs.length} tabs`;

  const allWindows = await chrome.windows.getAll({ populate: true });
  const allTabs = allWindows.flatMap(w => w.tabs).filter(isCaptureable);
  document.getElementById('all-count').textContent = `${allTabs.length} tabs`;
}

// ── Capture actions ──────────────────────────────────────────────

// 1. Save current tab
document.getElementById('btn-save-one').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isCaptureable(tab)) {
    showToast('Cannot save this tab');
    return;
  }
  const current = await getBookmarks();
  const bookmark = tabToBookmark(tab, 'single');
  const newOnes = dedup([bookmark], current);
  if (newOnes.length === 0) {
    showToast('Already saved');
    return;
  }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  showToast('Tab saved ✓');
});

// 2. Save all tabs in current window
document.getElementById('btn-save-window').addEventListener('click', async () => {
  const currentWindow = await chrome.windows.getCurrent({ populate: true });
  const tabs = currentWindow.tabs.filter(isCaptureable);
  if (tabs.length === 0) {
    showToast('No capturable tabs in this window');
    return;
  }
  const current = await getBookmarks();
  const incoming = tabs.map(t => tabToBookmark(t, 'window'));
  const newOnes = dedup(incoming, current);
  if (newOnes.length === 0) {
    showToast('All tabs already saved');
    return;
  }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  showToast(`${newOnes.length} tab${newOnes.length !== 1 ? 's' : ''} saved ✓`);
});

// 3. Save all tabs across all windows
document.getElementById('btn-save-all').addEventListener('click', async () => {
  const allWindows = await chrome.windows.getAll({ populate: true });
  const tabs = allWindows.flatMap(w => w.tabs).filter(isCaptureable);
  if (tabs.length === 0) {
    showToast('No capturable tabs found');
    return;
  }
  const current = await getBookmarks();
  const incoming = tabs.map(t => tabToBookmark(t, 'all'));
  const newOnes = dedup(incoming, current);
  if (newOnes.length === 0) {
    showToast('All tabs already saved');
    return;
  }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  showToast(`${newOnes.length} tab${newOnes.length !== 1 ? 's' : ''} saved across ${allWindows.length} windows ✓`);
});

// Clear all
document.getElementById('btn-clear').addEventListener('click', async () => {
  await setBookmarks([]);
  render([]);
  showToast('Cleared');
});

// ── Init ─────────────────────────────────────────────────────────

(async () => {
  const bookmarks = await getBookmarks();
  render(bookmarks);
  updateCounts();
})();
