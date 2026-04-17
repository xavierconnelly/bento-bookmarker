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
    pile: null,
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

// ── Close tabs helper ────────────────────────────────────────────

async function closeTabsIfToggled(savedTabs) {
  const toggle = document.getElementById('toggle-close');
  if (!toggle.checked) return;

  // Get the currently active tab so we don't close it
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = activeTab?.id;

  const idsToClose = savedTabs
    .filter(t => t.id !== activeTabId)
    .map(t => t.id);

  if (idsToClose.length > 0) {
    await chrome.tabs.remove(idsToClose);
  }
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

// ── Zone config ──────────────────────────────────────────────────

const ZONES = {
  inbox:   { icon: '📥', name: 'Inbox' },
  inspo:   { icon: '✦',  name: 'Inspo' },
  tasks:   { icon: '◎',  name: 'Tasks' },
  read:    { icon: '▤',  name: 'Read later' },
  japan:   { icon: '◈',  name: 'Japan' },
  discard: { icon: '×',  name: 'Discard' },
};

// ── Pile detail view ─────────────────────────────────────────────

let activePile = null;

function openPile(pile, bookmarks) {
  activePile = pile;
  const z = ZONES[pile];
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('pile-view').classList.add('active');
  document.getElementById('pile-title-icon').textContent = z.icon;
  document.getElementById('pile-title-name').textContent = z.name;
  renderPileList(pile, bookmarks);
}

function closePile() {
  activePile = null;
  document.getElementById('main-view').classList.remove('hidden');
  document.getElementById('pile-view').classList.remove('active');
}

function renderPileList(pile, bookmarks) {
  const list = document.getElementById('pile-list');
  const items = bookmarks.filter(b => b.pile === pile).sort((a, b) => b.savedAt - a.savedAt);

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><strong>Empty</strong>Drag items here from Unsorted.</div>`;
    return;
  }

  list.innerHTML = items.map(b => `
    <div class="bookmark-item" data-id="${b.id}">
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

  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const current = await getBookmarks();
      const updated = current.filter(b => b.id !== btn.dataset.id);
      await setBookmarks(updated);
      renderPileList(pile, updated);
      updateZoneCounts(updated);
      document.getElementById('count-badge').textContent = `${updated.length} saved`;
    });
  });
}

document.getElementById('pile-back').addEventListener('click', closePile);

document.getElementById('pile-clear').addEventListener('click', async () => {
  if (!activePile) return;
  const current = await getBookmarks();
  const updated = current.filter(b => b.pile !== activePile);
  await setBookmarks(updated);
  renderPileList(activePile, updated);
  updateZoneCounts(updated);
  document.getElementById('count-badge').textContent = `${updated.length} saved`;
  showToast('Pile cleared');
});

// ── Render main list ─────────────────────────────────────────────

function updateZoneCounts(bookmarks) {
  Object.keys(ZONES).forEach(pile => {
    const count = bookmarks.filter(b => b.pile === pile).length;
    const el = document.getElementById(`zone-count-${pile}`);
    if (el) el.textContent = `${count} item${count !== 1 ? 's' : ''}`;
  });
}

function render(bookmarks) {
  document.getElementById('count-badge').textContent = `${bookmarks.length} saved`;
  updateZoneCounts(bookmarks);

  const list = document.getElementById('bookmark-list');
  const unsorted = bookmarks.filter(b => !b.pile).sort((a, b) => b.savedAt - a.savedAt);

  if (unsorted.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <strong>${bookmarks.length === 0 ? 'Nothing saved yet' : 'All sorted ✓'}</strong>
      ${bookmarks.length === 0 ? 'Capture a tab above to get started.' : 'All tabs have been sorted into piles.'}
    </div>`;
    return;
  }

  list.innerHTML = unsorted.map(b => `
    <div class="bookmark-item draggable" draggable="true" data-id="${b.id}">
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

  list.querySelectorAll('.bookmark-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('bookmarkId', item.dataset.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  });

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
  // Click to open pile
  zone.addEventListener('click', async () => {
    const bookmarks = await getBookmarks();
    openPile(zone.dataset.pile, bookmarks);
  });

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation(); // prevent click firing
    zone.classList.remove('drag-over');
    const id = e.dataTransfer.getData('bookmarkId');
    if (!id) return;
    const pile = zone.dataset.pile;
    const current = await getBookmarks();
    const updated = current.map(b => b.id === id ? { ...b, pile } : b);
    await setBookmarks(updated);
    render(updated);
    showToast(`Moved to ${ZONES[pile].name}`);
  });
});

// ── Capture: save tab ────────────────────────────────────────────

document.getElementById('btn-save-one').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isCaptureable(tab)) { showToast('Cannot save this tab'); return; }
  const current = await getBookmarks();
  const newOnes = dedup([tabToBookmark(tab, 'single')], current);
  if (!newOnes.length) { showToast('Already saved'); return; }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  // Single tab: never close the active tab (it's the one being saved)
  showToast('Tab saved ✓');
});

// ── Capture: this window ─────────────────────────────────────────

document.getElementById('btn-save-window').addEventListener('click', async () => {
  const currentWindow = await chrome.windows.getCurrent({ populate: true });
  const tabs = currentWindow.tabs.filter(isCaptureable);
  if (!tabs.length) { showToast('No capturable tabs'); return; }
  const current = await getBookmarks();
  const newOnes = dedup(tabs.map(t => tabToBookmark(t, 'window')), current);
  if (!newOnes.length) { showToast('All tabs already saved'); return; }
  const updated = [...current, ...newOnes];
  await setBookmarks(updated);
  render(updated);
  await closeTabsIfToggled(tabs);
  showToast(`${newOnes.length} tab${newOnes.length !== 1 ? 's' : ''} saved ✓`);
});

// ── Capture: all windows ─────────────────────────────────────────

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
  await closeTabsIfToggled(tabs);
  showToast(`${newOnes.length} tabs saved across ${allWindows.length} windows ✓`);
});

// ── Clear all ────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', async () => {
  await setBookmarks([]);
  render([]);
  showToast('Cleared');
});

// ── Init ─────────────────────────────────────────────────────────

(async () => {
  const bookmarks = await getBookmarks();
  render(bookmarks);
})();
