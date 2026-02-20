(() => {
  let lastHref = location.href;

  function sendHeartbeat(reason) {
    if (document.visibilityState !== "visible") {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "heartbeat",
        reason,
        url: location.href
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  function checkHrefChange(reason) {
    const current = location.href;
    if (current !== lastHref) {
      lastHref = current;
      sendHeartbeat(reason);
    }
  }

  const interval = setInterval(() => {
    checkHrefChange("interval-url-check");
    sendHeartbeat("interval-tick");
  }, 1000);

  window.addEventListener("popstate", () => {
    checkHrefChange("popstate");
    sendHeartbeat("popstate");
  });

  window.addEventListener("hashchange", () => {
    checkHrefChange("hashchange");
    sendHeartbeat("hashchange");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      sendHeartbeat("visibility-visible");
    }
  });

  sendHeartbeat("init");

  window.addEventListener("beforeunload", () => {
    clearInterval(interval);
  });
})();
