const STORAGE_KEYS = {
  RULES: "rules",
  USAGE: "usage",
  LAST_RESET_DAY: "lastResetDay"
};

const DNR_RULE_ID_BASE = 10000;
const TRACKED_PROTOCOLS = new Set(["http:", "https:"]);
const EXTENSION_BLOCKED_PAGE = "src/blocked.html";

let cache = {
  rules: [],
  usage: {},
  lastResetDay: null
};

let activeSession = {
  tabId: null,
  ruleId: null,
  startedAt: null,
  url: null
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

function dayKeyLocal(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function normalizeInput(raw) {
  const value = (raw || "").trim().toLowerCase();
  if (!value) {
    return null;
  }

  const hasScheme = value.includes("://");
  const synthetic = hasScheme ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(synthetic);
  } catch (_) {
    return null;
  }

  if (!parsed.hostname) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const hasPathPrefix = parsed.pathname && parsed.pathname !== "/";
  const normalizedPath = hasPathPrefix ? parsed.pathname.replace(/\/+$/, "") : "";
  return {
    host,
    pathPrefix: normalizedPath,
    isDomainRule: !hasPathPrefix,
    normalizedPattern: hasPathPrefix ? `${host}${normalizedPath}` : host
  };
}

function ruleMatchesUrl(rule, urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    return false;
  }

  if (!TRACKED_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!(hostname === rule.host || hostname.endsWith(`.${rule.host}`))) {
    return false;
  }

  if (!rule.pathPrefix) {
    return true;
  }

  const path = parsed.pathname || "/";
  return path === rule.pathPrefix || path.startsWith(`${rule.pathPrefix}/`);
}

function findMatchingRule(urlString) {
  let best = null;
  for (const rule of cache.rules) {
    if (!rule.enabled) {
      continue;
    }
    if (ruleMatchesUrl(rule, urlString)) {
      if (!best || rule.pattern.length > best.pattern.length) {
        best = rule;
      }
    }
  }
  return best;
}

function getUsageSeconds(ruleId) {
  return cache.usage[ruleId] || 0;
}

function isRuleExceeded(rule) {
  return getUsageSeconds(rule.id) >= rule.limitSeconds;
}

function dnrRuleForBlocked(rule) {
  const blockedUrl = chrome.runtime.getURL(
    `${EXTENSION_BLOCKED_PAGE}?ruleId=${encodeURIComponent(rule.id)}`
  );
  const condition = {
    resourceTypes: ["main_frame"]
  };

  if (rule.pathPrefix) {
    condition.urlFilter = `||${rule.host}${rule.pathPrefix}`;
  } else {
    condition.urlFilter = `||${rule.host}/`;
  }

  return {
    id: DNR_RULE_ID_BASE + rule.dnrIndex,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        url: blockedUrl
      }
    },
    condition
  };
}

function blockedUrlForRule(rule) {
  return chrome.runtime.getURL(
    `${EXTENSION_BLOCKED_PAGE}?ruleId=${encodeURIComponent(rule.id)}`
  );
}

async function syncDnrRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = [];

  for (const rule of cache.rules) {
    if (!rule.enabled) {
      continue;
    }
    if (rule.limitSeconds === 0 || isRuleExceeded(rule)) {
      addRules.push(dnrRuleForBlocked(rule));
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.USAGE,
    STORAGE_KEYS.LAST_RESET_DAY
  ]);

  cache.rules = Array.isArray(stored[STORAGE_KEYS.RULES])
    ? stored[STORAGE_KEYS.RULES]
    : [];
  cache.usage =
    stored[STORAGE_KEYS.USAGE] && typeof stored[STORAGE_KEYS.USAGE] === "object"
      ? stored[STORAGE_KEYS.USAGE]
      : {};
  cache.lastResetDay = stored[STORAGE_KEYS.LAST_RESET_DAY] || null;
}

async function persistUsageAndDay() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.USAGE]: cache.usage,
    [STORAGE_KEYS.LAST_RESET_DAY]: cache.lastResetDay
  });
}

function clearActiveSession() {
  activeSession = {
    tabId: null,
    ruleId: null,
    startedAt: null,
    url: null
  };
}

async function finalizeActiveSession() {
  if (!activeSession.ruleId || !activeSession.startedAt) {
    clearActiveSession();
    return;
  }

  const elapsed = nowSeconds() - activeSession.startedAt;
  if (elapsed <= 0) {
    clearActiveSession();
    return;
  }

  cache.usage[activeSession.ruleId] = (cache.usage[activeSession.ruleId] || 0) + elapsed;
  await persistUsageAndDay();
  await syncDnrRules();
  clearActiveSession();
}

async function maybeResetForNewDay() {
  const today = dayKeyLocal();
  if (cache.lastResetDay === today) {
    return;
  }

  await finalizeActiveSession();
  cache.usage = {};
  cache.lastResetDay = today;
  await persistUsageAndDay();
  await syncDnrRules();
}

async function updateActiveTracking(forceRoll = false) {
  await maybeResetForNewDay();

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id || !tab.url) {
    await finalizeActiveSession();
    return;
  }

  const matchingRule = findMatchingRule(tab.url);
  if (!matchingRule) {
    await finalizeActiveSession();
    return;
  }

  const shouldBlockNow = matchingRule.limitSeconds === 0 || isRuleExceeded(matchingRule);
  if (shouldBlockNow) {
    await finalizeActiveSession();
    const blockUrl = blockedUrlForRule(matchingRule);
    if (tab.url !== blockUrl) {
      await chrome.tabs.update(tab.id, { url: blockUrl });
    }
    return;
  }

  const sameSession =
    activeSession.tabId === tab.id &&
    activeSession.ruleId === matchingRule.id &&
    activeSession.url === tab.url;
  if (sameSession && !forceRoll) {
    return;
  }

  await finalizeActiveSession();
  activeSession = {
    tabId: tab.id,
    ruleId: matchingRule.id,
    startedAt: nowSeconds(),
    url: tab.url
  };
}

async function initialize() {
  await loadState();
  if (!cache.lastResetDay) {
    cache.lastResetDay = dayKeyLocal();
    await persistUsageAndDay();
  }
  await maybeResetForNewDay();
  await syncDnrRules();
  await updateActiveTracking();
}

chrome.runtime.onInstalled.addListener(() => {
  initialize().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  initialize().catch(console.error);
});

chrome.tabs.onActivated.addListener(() => {
  updateActiveTracking().catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateActiveTracking().catch(console.error);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((_details) => {
  updateActiveTracking().catch(console.error);
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener((_details) => {
  updateActiveTracking().catch(console.error);
});

chrome.windows.onFocusChanged.addListener(() => {
  updateActiveTracking().catch(console.error);
});

chrome.idle.onStateChanged?.addListener((newState) => {
  if (newState === "active") {
    updateActiveTracking().catch(console.error);
  } else {
    finalizeActiveSession().catch(console.error);
  }
});

chrome.alarms.create("day-reset-check", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "day-reset-check") {
    updateActiveTracking(true).catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getState") {
    maybeResetForNewDay()
      .then(() => updateActiveTracking(true))
      .then(() => {
        sendResponse({
          rules: cache.rules,
          usage: cache.usage,
          day: cache.lastResetDay
        });
      })
      .catch((err) => {
        sendResponse({ error: err?.message || String(err) });
      });
    return true;
  }

  if (message?.type === "saveRules") {
    const incoming = Array.isArray(message.rules) ? message.rules : [];
    finalizeActiveSession()
      .then(async () => {
        const normalized = [];
        let dnrIndex = 1;
        for (const rawRule of incoming) {
          const normalizedPattern = normalizeInput(rawRule.pattern);
          if (!normalizedPattern) {
            continue;
          }
          const limitSeconds = Math.max(0, Number(rawRule.limitSeconds) || 0);
          normalized.push({
            id: rawRule.id || crypto.randomUUID(),
            pattern: normalizedPattern.normalizedPattern,
            host: normalizedPattern.host,
            pathPrefix: normalizedPattern.pathPrefix,
            enabled: rawRule.enabled !== false,
            limitSeconds,
            dnrIndex: dnrIndex++
          });
        }

        cache.rules = normalized;

        const activeIds = new Set(normalized.map((r) => r.id));
        const nextUsage = {};
        for (const [id, seconds] of Object.entries(cache.usage)) {
          if (activeIds.has(id)) {
            nextUsage[id] = seconds;
          }
        }
        cache.usage = nextUsage;

        await chrome.storage.local.set({
          [STORAGE_KEYS.RULES]: cache.rules,
          [STORAGE_KEYS.USAGE]: cache.usage
        });
        await syncDnrRules();
        await updateActiveTracking();
        sendResponse({ ok: true, rules: cache.rules, usage: cache.usage });
      })
      .catch((err) => {
        sendResponse({ error: err?.message || String(err) });
      });
    return true;
  }

  return false;
});

initialize().catch(console.error);
