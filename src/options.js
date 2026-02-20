const form = document.getElementById("rule-form");
const statusEl = document.getElementById("status");
const rulesBody = document.getElementById("rules-body");
const patternInput = document.getElementById("pattern");
const limitInput = document.getElementById("limitSeconds");

let state = {
  rules: [],
  usage: {}
};

function secondsToText(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b21f1f" : "#0a7f35";
}

function renderRules() {
  rulesBody.innerHTML = "";
  if (!state.rules.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">No rules yet.</td>`;
    rulesBody.appendChild(tr);
    return;
  }

  for (const rule of state.rules) {
    const used = state.usage[rule.id] || 0;
    const remaining = Math.max(0, rule.limitSeconds - used);
    const tr = document.createElement("tr");

    const enabledCell = document.createElement("td");
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.checked = rule.enabled !== false;
    enabledInput.addEventListener("change", async () => {
      rule.enabled = enabledInput.checked;
      await saveRules();
    });
    enabledCell.appendChild(enabledInput);

    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.className = "danger";
    removeButton.addEventListener("click", async () => {
      state.rules = state.rules.filter((r) => r.id !== rule.id);
      await saveRules();
    });

    tr.innerHTML = `
      <td>${rule.pattern}</td>
      <td>${secondsToText(rule.limitSeconds)}</td>
      <td>${secondsToText(used)}</td>
      <td>${secondsToText(remaining)}</td>
      <td></td>
      <td></td>
    `;
    tr.children[4].replaceWith(enabledCell);
    tr.children[5].replaceWith((() => {
      const td = document.createElement("td");
      td.appendChild(removeButton);
      return td;
    })());

    rulesBody.appendChild(tr);
  }
}

async function requestBackground(payload) {
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

async function loadState() {
  const response = await requestBackground({ type: "getState" });
  state.rules = response.rules || [];
  state.usage = response.usage || {};
  renderRules();
}

async function saveRules() {
  const response = await requestBackground({
    type: "saveRules",
    rules: state.rules
  });
  state.rules = response.rules || [];
  state.usage = response.usage || {};
  renderRules();
  showStatus("Saved.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pattern = patternInput.value.trim();
  const limitSeconds = Number(limitInput.value);

  if (!pattern) {
    showStatus("Pattern is required.", true);
    return;
  }

  if (!Number.isFinite(limitSeconds) || limitSeconds < 0) {
    showStatus("Limit must be 0 or greater.", true);
    return;
  }

  state.rules.push({
    id: crypto.randomUUID(),
    pattern,
    limitSeconds: Math.floor(limitSeconds),
    enabled: true
  });

  try {
    await saveRules();
    patternInput.value = "";
    limitInput.value = "";
  } catch (err) {
    showStatus(err.message || "Failed to save rule.", true);
  }
});

loadState().catch((err) => {
  showStatus(err.message || "Failed to load rules.", true);
});
