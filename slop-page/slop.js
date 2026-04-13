const params = new URLSearchParams(window.location.search);
const target = params.get("target") || "";
const type = params.get("type") || "";
const value = params.get("value") || "";

document.getElementById("target").textContent = target;
document.getElementById("match").textContent = `${type} = ${value}`;

document.getElementById("back").addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.close();
  }
});

document.getElementById("unmark").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ cmd: "removeMark", mark: { type, value } });
  window.location.replace(target);
});

document.getElementById("continue").addEventListener("click", async () => {
  // Ask the background script for a one-shot bypass on this tab so the
  // webNavigation listener lets the next navigation through exactly once.
  await browser.runtime.sendMessage({ cmd: "bypass" });
  window.location.replace(target);
});
