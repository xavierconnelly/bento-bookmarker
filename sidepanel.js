// ── Storage ──────────────────────────────────────────────────────

function getBookmarks() {
  return new Promise(resolve =>
    chrome.storage.local.get('bookmarks', ({ bookmarks = [] }) => resolve(bookmarks))
  );
}

function setBookmarks(bookmarks) {
  return new Promise(resolve => chrome.storage.local.set({ bookmarks }, resolve));
}

// ── Tab helpers ──────────────────────────────────────────────────

function tabToBookmark(tab, source = 'single') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: tab.title || tab.url,
    url: tab.url,
    favicon: tab.favIconUrl || '',
    savedAt: Date.now(),
    source,
    pile: null, // null = unsorted
  };
}

function dedup(incoming, existing) {
  const existingUrls = new Set(existing.map(b => b.url));
  return incoming.filter(b => !existingUrls.has(b.url));
}

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
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

// ── Render ───────────────────────────────────────────────────────

function updateZoneCounts(bookmarks) {
  const piles = ['inbox', 'inspo', 'tasks', 'read', 'japan', 'discard'];
  piles.forEach(pile => {
    const count = bookmarks.filter(b => b.pile === pile).length;
    const el = document.getElementById(`zone-count-${pile}`);
    if (el) el.textContent = `${count} item${count !== 1 ? 's' : ''}`;
  });
}

function render(bookmarks) {
  const list = document.getElementById('bookmark-list');
  const badge = document.getElementById('count-badge');

  badge.textContent = `${bookmarks.length} saved`;
  updateZoneCounts(bookmarks);

  // Only show unsorted in the list
  const unsorted = bookmarks.filter(b => !b.pile).sort((a, b) => b.savedAt - a.savedAt);

  if (unsorted.length === 0) {
    const allSorted = bookmarks.length > 0 && bookmarks.every(b => b.pile);
    list.innerHTML = `<div class="empty-state">
      <strong>${bookmarks.length === 0 ? 'Nothing saved yet' : 'All sorted ✓'}</strong>
      ${bookmarks.length === 0
        ? 'Capture a tab above to get started.'
        : 'Drag items from above into the piles to triage.'}
    </div>`;
    return;
  }

  list.innerHTML = unsorted.map(b => `
    <div class="bookmark-item" draggable="true" data-id="${b.id}">
      ${b.favicon
        ? `<img class="bookmark-favicon" src="${b.favicon}" alt="" onerror="this.style.display='none'" />`
        : `<div class="bookmark-favicon"></div>`
      }
      <div class="bookmark-info">
        <a class="bookmark-title" href="${b.url}" target="_blank" title="${b.title}">${b.title}</a>
        <div class="bookmark-url">${formatUrl(b.url)}</div>
      </div>
      <button class="remove-btn" data-id="${b.id}" title="Remove">×</button>
    </div>
  `).join('');

  // Drag from list
  list.querySelectorAll('.bookmark-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('bookmarkId', item.dataset.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  });

  // Remove buttons
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const current = await getBookmarks();
      const updated = current.filter(b => b.id !== btn.dataset.id);
      await setBookmarks(updated);
      render(updated);
    });
  });
}

// ── Drop zones ───────────────────────────────────────────────────

document.querySelectorAll('.drop-zone').forEach(zone => {
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    // Only remove if leaving the zone entirely (not a child element)
    if (!zone.contains(e.relatedTarget)) {
      zone.classList.remove('drag-over');
    }
  });

  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag-over');

    const id = e.dataTransfer.getData('bookmarkId');
    if (!id) return;

    const pile = zone.dataset.pile;
    const current = await getBookmarks();
    const updated = current.map(b => b.id === id ? { ...b, pile } : b);
    await setBookmarks(updated);
    render(updated);

    const pileName = zone.querySelector('.zone-name').textContent;
    showToast(`Moved to ${pileName}`);
  });
});

// ── Capture buttons ──────────────────────────────────────────────

document.getElementById('btn-save-one').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isCaptureable(tab)) { showToast('Cannot save this tab'); return; }
  const current = await getBookmarks();
  const newOnes = dedup([tabToBookmark(tab, 'single')], current);
  if (newOnes.length === 0) { showToast('Already saved'); return; }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  showToast('Tab saved ✓');
});

document.getElementById('btn-save-window').addEventListener('click', async () => {
  const currentWindow = await chrome.windows.getCurrent({ populate: true });
  const tabs = currentWindow.tabs.filter(isCaptureable);
  if (!tabs.length) { showToast('No capturable tabs in this window'); return; }
  const current = await getBookmarks();
  const newOnes = dedup(tabs.map(t => tabToBookmark(t, 'window')), current);
  if (!newOnes.length) { showToast('All tabs already saved'); return; }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  showToast(`${newOnes.length} tab${newOnes.length !== 1 ? 's' : ''} saved ✓`);
});

document.getElementById('btn-save-all').addEventListener('click', async () => {
  const allWindows = await chrome.windows.getAll({ populate: true });
  const tabs = allWindows.flatMap(w => w.tabs).filter(isCaptureable);
  if (!tabs.length) { showToast('No capturable tabs found'); return; }
  const current = await getBookmarks();
  const newOnes = dedup(tabs.map(t => tabToBookmark(t, 'all')), current);
  if (!newOnes.length) { showToast('All tabs already saved'); return; }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  showToast(`${newOnes.length} tab${newOnes.length !== 1 ? 's' : ''} saved across ${allWindows.length} windows ✓`);
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  await setBookmarks([]);
  render([]);
  showToast('Cleared');
});

// ── Tab counts on buttons ─────────────────────────────────────────
// (No visible meta text on buttons now, but keeping updateCounts
//  available for future use)

// ── Init ─────────────────────────────────────────────────────────

(async () => {
  const bookmarks = await getBookmarks();
  render(bookmarks);
})();
