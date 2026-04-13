const ALL_URLS = { origins: ["<all_urls>"] };

async function currentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

async function init() {
  const tab = await currentTab();
  const url = tab?.url ?? "";
  setText("current-url", url);

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    document.getElementById("mark-form").hidden = true;
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    document.getElementById("mark-form").hidden = true;
    setText("current-url", `${url} (can't mark this scheme)`);
    return;
  }

  const hasPermission = await browser.permissions.contains(ALL_URLS);
  if (!hasPermission) {
    document.getElementById("mark-form").hidden = true;
    document.getElementById("needs-permission").hidden = false;
    document.getElementById("grant").addEventListener("click", async () => {
      // Requesting from a popup closes the popup; the granted permission is
      // persistent, so the user re-opens the popup to mark.
      await browser.permissions.request(ALL_URLS);
    });
    return;
  }

  const suggest = await browser.runtime.sendMessage({ cmd: "suggestMarks", url });
  setText("opt-domain", suggest.domain);
  setText("opt-host", suggest.host);
  setText("opt-path", suggest.path);

  const existing = await browser.runtime.sendMessage({ cmd: "findMatch", url });
  if (existing) {
    document.getElementById("already-marked").hidden = false;
    setText("match-type", existing.type);
    setText("match-value", existing.value);
    document.getElementById("unmark").addEventListener("click", async () => {
      await browser.runtime.sendMessage({ cmd: "removeMark", mark: existing });
      window.close();
    });
  }

  document.getElementById("mark-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = new FormData(e.target).get("type");
    const value = suggest[type];
    await browser.runtime.sendMessage({ cmd: "addMark", mark: { type, value } });
    window.close();
  });
}

init();
