(function () {
  "use strict";

  var inactivityThresholdMs = 30 * 60 * 1000;
  var activityStorageKey = "gym-planner-last-activity";
  var lastActivityAt = 0;
  var lastStorageWriteAt = 0;
  var requestInProgress = false;
  var appOpenStatus = document.getElementById("app-open-status");

  function readLastActivity() {
    try {
      return Number(window.localStorage.getItem(activityStorageKey)) || 0;
    } catch (error) {
      console.error("Could not read app activity time:", error);
      return lastActivityAt;
    }
  }

  function storeLastActivity(timestamp) {
    lastActivityAt = timestamp;
    if (timestamp - lastStorageWriteAt < 10000) return;
    try {
      window.localStorage.setItem(activityStorageKey, String(timestamp));
      lastStorageWriteAt = timestamp;
    } catch (error) {
      console.error("Could not save app activity time:", error);
    }
  }

  function showTrackingError(message) {
    if (!appOpenStatus) {
      appOpenStatus = document.createElement("div");
      appOpenStatus.id = "app-open-status";
      appOpenStatus.className = "banner capacity-error";
      appOpenStatus.setAttribute("role", "status");
      appOpenStatus.setAttribute("aria-live", "polite");
      var app = document.querySelector(".app");
      var main = app && app.querySelector("main");
      if (app) app.insertBefore(appOpenStatus, main || null);
    }
    if (appOpenStatus) {
      appOpenStatus.hidden = false;
      appOpenStatus.textContent = message;
    }
  }

  function recordOpen() {
    if (requestInProgress) return Promise.resolve();
    requestInProgress = true;
    return fetch("/app/open", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(function (response) {
      return response.json().catch(function () {
        return null;
      }).then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "Could not record this app open.");
        }
      });
    }).catch(function (error) {
      console.error("App open tracking failed:", error);
      showTrackingError(error.message || "Could not record this app open.");
    }).finally(function () {
      requestInProgress = false;
    });
  }

  function handleActivity() {
    var now = Date.now();
    var previousActivityAt = Math.max(lastActivityAt, readLastActivity());
    if (previousActivityAt && now - previousActivityAt >= inactivityThresholdMs) {
      recordOpen();
    }
    storeLastActivity(now);
  }

  var previousActivityAt = readLastActivity();
  if (!previousActivityAt || Date.now() - previousActivityAt >= inactivityThresholdMs) {
    recordOpen();
  }
  storeLastActivity(Date.now());

  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (eventName) {
    document.addEventListener(eventName, handleActivity, { passive: true });
  });
  window.addEventListener("focus", handleActivity);
  window.addEventListener("pageshow", handleActivity);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") handleActivity();
  });
})();
