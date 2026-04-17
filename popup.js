// Load existing bookmarks on open
chrome.storage.local.get("bookmarks", ({ bookmarks = [] }) => {
  renderList(bookmarks);
});

// Save current tab
document.getElementById("save").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.storage.local.get("bookmarks", ({ bookmarks = [] }) => {
    const updated = [...bookmarks, { title: tab.title, url: tab.url }];
    chrome.storage.local.set({ bookmarks: updated }, () => renderList(updated));
  });
});

function renderList(bookmarks) {
  const ul = document.getElementById("list");
  ul.innerHTML = bookmarks
    .map(b => `<li><a href="${b.url}" target="_blank">${b.title}</a></li>`)
    .join("");
}