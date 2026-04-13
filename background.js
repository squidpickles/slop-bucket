// Slop Bucket background script.
//
// Storage schema (browser.storage.local):
//   marks: Array<{ type: "domain" | "host" | "path", value: string }>
//
//   - domain: registrable domain match (e.g. "example.com" matches
//     "foo.example.com" and "example.com"). Implemented as suffix match on host.
//   - host:   exact host match (e.g. "foo.example.com").
//   - path:   exact host + path-prefix match (e.g. "example.com/blog").

const SLOP_PAGE = browser.runtime.getURL("slop-page/slop.html");

async function getMarks() {
  const { marks = [] } = await browser.storage.local.get("marks");
  return marks;
}

async function setMarks(marks) {
  await browser.storage.local.set({ marks });
}

function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

// Returns the matching mark for a given URL, or null.
function findMatch(url, marks) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname;
  const hostPath = host + parsed.pathname;

  for (const mark of marks) {
    if (mark.type === "domain" && hostMatchesDomain(host, mark.value)) return mark;
    if (mark.type === "host" && host === mark.value) return mark;
    if (mark.type === "path" && (hostPath === mark.value || hostPath.startsWith(mark.value + "/"))) return mark;
  }
  return null;
}

// Extract suggested mark values for a URL, used by the popup.
function suggestMarks(url) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  // Naive registrable-domain guess: last two labels. Good enough for a skeleton;
  // real eTLD+1 resolution would need the Public Suffix List.
  const parts = host.split(".");
  const domain = parts.length >= 2 ? parts.slice(-2).join(".") : host;
  return {
    domain,
    host,
    path: host + parsed.pathname,
  };
}

async function addMark(mark) {
  const marks = await getMarks();
  // De-dupe on (type, value).
  if (!marks.some((m) => m.type === mark.type && m.value === mark.value)) {
    marks.push(mark);
    await setMarks(marks);
  }
}

async function removeMark(mark) {
  const marks = await getMarks();
  const next = marks.filter((m) => !(m.type === mark.type && m.value === mark.value));
  await setMarks(next);
}

// Short-lived per-tab bypass window. Used by the slop page's "Continue anyway"
// button to let navigations in that tab through without being re-intercepted.
//
// This is a time-windowed allow rather than a one-shot token because Firefox
// empirically fires onBeforeNavigate more than once for a single
// window.location.replace() out of the slop page (likely an interaction with
// the original navigation that we redirected away). A one-shot token gets
// consumed by the first fire and then the second fire bounces back to slop.
// Keeping the window open for a few seconds covers all fires for one user
// intent; the window is short enough that the user can't plausibly navigate
// to an unrelated slop site within it.
//
// We persist the window in storage.session rather than a module-level Map
// because MV3 background scripts are event pages: Firefox unloads them when
// idle and re-runs them on the next event, which would wipe an in-memory map
// between the "bypass" message and the subsequent onBeforeNavigate.
const BYPASS_WINDOW_MS = 3_000;

async function grantBypass(tabId) {
  const { bypasses = {} } = await browser.storage.session.get("bypasses");
  bypasses[tabId] = Date.now() + BYPASS_WINDOW_MS;
  await browser.storage.session.set({ bypasses });
}

async function isBypassed(tabId) {
  const { bypasses = {} } = await browser.storage.session.get("bypasses");
  const expiresAt = bypasses[tabId];
  if (expiresAt === undefined) return false;
  if (expiresAt < Date.now()) {
    delete bypasses[tabId];
    await browser.storage.session.set({ bypasses });
    return false;
  }
  return true;
}

browser.tabs.onRemoved.addListener(async (tabId) => {
  const { bypasses = {} } = await browser.storage.session.get("bypasses");
  if (tabId in bypasses) {
    delete bypasses[tabId];
    await browser.storage.session.set({ bypasses });
  }
});

// Intercept top-frame navigations to slop sites and redirect to the warning page.
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (details.url.startsWith(SLOP_PAGE)) return;

  if (await isBypassed(details.tabId)) return;

  const marks = await getMarks();
  const match = findMatch(details.url, marks);
  if (!match) return;

  const redirect =
    SLOP_PAGE +
    "?target=" + encodeURIComponent(details.url) +
    "&type=" + encodeURIComponent(match.type) +
    "&value=" + encodeURIComponent(match.value);

  await browser.tabs.update(details.tabId, { url: redirect });
});

// Message handlers for popup and slop page.
browser.runtime.onMessage.addListener(async (msg, sender) => {
  switch (msg?.cmd) {
    case "getMarks":
      return getMarks();
    case "suggestMarks":
      return suggestMarks(msg.url);
    case "addMark":
      return addMark(msg.mark);
    case "removeMark":
      return removeMark(msg.mark);
    case "findMatch": {
      const marks = await getMarks();
      return findMatch(msg.url, marks);
    }
    case "bypass": {
      const tabId = sender?.tab?.id;
      if (tabId === undefined) return false;
      await grantBypass(tabId);
      return true;
    }
    default:
      return undefined;
  }
});
