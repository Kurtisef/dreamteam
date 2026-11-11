(function () {
  "use strict";

  var btnIn = document.getElementById("btn-in");
  var btnOut = document.getElementById("btn-out");
  var btnCloseGym = document.getElementById("btn-close-gym");
  var closeConfirm = document.getElementById("close-confirm");
  var closeConfirmYes = document.getElementById("close-confirm-yes");
  var closeConfirmNo = document.getElementById("close-confirm-no");
  var insideEl = document.getElementById("inside-count");
  var msg = document.getElementById("admin-msg");
  var panel = document.getElementById("wait-panel");
  var form = document.getElementById("wait-form");
  var input = document.getElementById("wait-min");
  var err = document.getElementById("wait-err");
  var saveButton = form.querySelector('button[type="submit"]');
  var logList = document.getElementById("log-list");

  var inside = 0;
  var maxCapacity = 135;
  var pendingEvent = null; // the check in waiting for an optional wait time

  btnIn.disabled = true;
  btnOut.disabled = true;

  function saveEvent(event) {
    return requestJSON("/admin/events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: event.type,
        wait_time_min: event.type === "in" ? event.waitMinutes : null
      })
    });
  }

  function setMsg(text, kind) {
    msg.textContent = text || "";
    msg.className = kind || "";
  }

  function setBusy(busy) {
    btnIn.disabled = busy;
    btnOut.disabled = busy;
    btnCloseGym.disabled = busy;
  }

  function setWaitSaving(saving) {
    saveButton.disabled = saving;
  }

  function timeLabel(value) {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function renderActivity(events) {
    while (logList.firstChild) logList.removeChild(logList.firstChild);
    var recentEvents = events.slice(0, 8);
    if (!recentEvents.length) {
      var empty = document.createElement("li");
      empty.className = "mute empty";
      empty.textContent = "Nothing recorded yet.";
      logList.appendChild(empty);
      return;
    }

    recentEvents.forEach(function (event) {
      if (event.event_type !== "in" && event.event_type !== "out") return;
      var li = document.createElement("li");
      li.className = event.event_type;
      var left = document.createElement("span");
      var label = event.event_type === "in" ? "Checked in" : "Checked out";
      if (event.event_type === "in" && event.wait_time_min > 0) {
        label += " · waited " + event.wait_time_min + " min";
      }
      left.textContent = label;
      var right = document.createElement("span");
      right.className = "t";
      right.textContent = timeLabel(event.created_at);
      li.appendChild(left);
      li.appendChild(right);
      logList.appendChild(li);
    });

    if (!logList.firstChild) {
      var noValidEvents = document.createElement("li");
      noValidEvents.className = "mute empty";
      noValidEvents.textContent = "Nothing recorded yet.";
      logList.appendChild(noValidEvents);
    }
  }

  function loadState() {
    return requestJSON("/admin/events", {
      method: "GET",
      credentials: "same-origin"
    }).then(function (state) {
      if (!state || !Array.isArray(state.events) || !Number.isInteger(state.insideCount)) {
        throw new Error("The gym activity response was invalid.");
      }
      inside = state.insideCount;
      insideEl.textContent = inside;
      renderActivity(state.events);
    });
  }

  function openPanel() {
    input.value = "";
    err.textContent = "";
    panel.hidden = false;
    setBusy(true);
    setWaitSaving(false);
    input.focus();
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function closePanel() {
    panel.hidden = true;
    pendingEvent = null;
    setBusy(false);
    btnIn.focus();
  }

  function persistEvent(event, afterSave, successMessage) {
    setBusy(true);
    return saveEvent(event).then(function () {
      if (afterSave) {
        afterSave();
        setBusy(true);
      }
      return loadState().then(function () {
        setMsg(successMessage, "ok");
      }).catch(function () {
        setMsg("Saved, but gym activity could not be refreshed. Reload the page to sync.", "err");
      });
    }).catch(function () {
      setMsg("Could not save that. Please try again.", "err");
    }).then(function () {
      setBusy(false);
      setWaitSaving(false);
    });
  }

  btnIn.addEventListener("click", function () {
    if (inside >= maxCapacity) {
      setMsg("The gym is at its 135-person capacity.", "err");
      return;
    }
    inside += 1;
    render();
    setMsg("Enter the wait time or skip to save the check in.", "");
    pendingEvent = { type: "in", waitMinutes: null, at: new Date().toISOString() };
    openPanel();
  });

  btnOut.addEventListener("click", function () {
    if (inside <= 0) {
      setMsg("The count is already 0. Nobody to check out.", "err");
      return;
    }
    setMsg("Saving check out...", "");
    persistEvent({ type: "out", waitMinutes: null }, null, "Check out saved.");
  });

  input.addEventListener("input", function () {
    var cleaned = input.value.replace(/\D/g, "");
    if (cleaned !== input.value) input.value = cleaned;
    err.textContent = "";
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!pendingEvent) return;

    var raw = input.value.trim();
    var minutes = raw === "" ? null : Number(raw);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 59)) {
      err.textContent = "Wait time must be a whole number from 0 to 59 minutes.";
      return;
    }

    pendingEvent.waitMinutes = minutes;
    setWaitSaving(true);
    persistEvent(pendingEvent, closePanel, "Check in saved.");
  });

  btnCloseGym.addEventListener("click", function () {
    closeConfirm.hidden = false;
    closeConfirmYes.focus();
  });

  closeConfirmNo.addEventListener("click", function () {
    closeConfirm.hidden = true;
    btnCloseGym.focus();
  });

  closeConfirmYes.addEventListener("click", function () {
    closeConfirm.hidden = true;
    setBusy(true);
    setMsg("Closing the gym and clearing activity...", "");
    requestJSON("/admin/close", {
      method: "POST",
      credentials: "same-origin"
    }).then(function () {
      return loadState().then(function () {
        setMsg("Gym closed. The count and recent activity have been cleared.", "ok");
      }).catch(function () {
        setMsg("Gym closed, but activity could not be refreshed. Reload the page to sync.", "err");
      });
    }).catch(function () {
      setMsg("Could not close the gym or clear activity. Please try again.", "err");
    }).then(function () {
      setBusy(false);
    });
  });

  render();
  fetch("/admin/current-count", { credentials: "same-origin" })
    .then(function (response) {
      if (!response.ok) throw new Error("Could not load the current count.");
      return response.json();
    })
    .then(function (data) {
      inside = Math.max(0, Math.min(maxCapacity, Number(data.count) || 0));
      render();
      btnIn.disabled = false;
      btnOut.disabled = false;
    })
    .catch(function () {
      setMsg("Could not load today's count. Refresh or contact the administrator.", "err");
    });
})();
