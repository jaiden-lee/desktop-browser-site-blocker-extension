const currentEl = document.getElementById("current");
const rulesListEl = document.getElementById("rules-list");
const openOptionsBtn = document.getElementById("open-options");

let tickHandle = null;

function secondsToText(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function requestBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.url || "";
}

function renderCurrent(current, url) {
  if (!url) {
    currentEl.innerHTML = `<div class="muted">No active tab URL available.</div>`;
    return;
  }

  if (!current) {
    currentEl.innerHTML = `
      <div class="pattern">Current tab</div>
      <div class="muted">No rule matches this URL.</div>
    `;
    return;
  }

  const blockedClass = current.blocked ? "strong warn" : "strong";
  currentEl.innerHTML = `
    <div class="pattern">Current rule: ${escapeHtml(current.pattern)}</div>
    <div class="${blockedClass}">
      ${current.blocked ? "Blocked for today" : `${secondsToText(current.remainingSeconds)} left`}
    </div>
    <div class="muted">
      Used ${secondsToText(current.usedSeconds)} / ${secondsToText(current.limitSeconds)}
    </div>
  `;
}

function renderRules(rules) {
  if (!rules.length) {
    rulesListEl.innerHTML = `<div class="muted">No rules configured.</div>`;
    return;
  }

  rulesListEl.innerHTML = rules
    .map((rule) => {
      const remaining = rule.blocked ? "Blocked" : `${secondsToText(rule.remainingSeconds)} left`;
      return `
        <div class="rule">
          <div class="pattern">${escapeHtml(rule.pattern)}</div>
          <div class="${rule.blocked ? "warn" : ""}">${remaining}</div>
          <div class="muted">
            ${secondsToText(rule.usedSeconds)} / ${secondsToText(rule.limitSeconds)}
            ${rule.enabled ? "" : " (disabled)"}
          </div>
        </div>
      `;
    })
    .join("");
}

async function refresh() {
  try {
    const url = await getActiveTabUrl();
    const data = await requestBackground({ type: "getPopupStatus", url });
    renderCurrent(data.current, url);
    renderRules(data.rules || []);
  } catch (err) {
    currentEl.innerHTML = `<div class="warn">Failed to load: ${escapeHtml(err.message || "Unknown error")}</div>`;
  }
}

openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh();
tickHandle = setInterval(refresh, 1000);

window.addEventListener("unload", () => {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
});
