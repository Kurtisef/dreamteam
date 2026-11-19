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
  var busy = true;
  var pendingEvent = null; // the check in waiting for an optional wait time
  var activityEvents = [];

  function requestJSON(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () {
        return null;
      }).then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "The request could not be completed.");
        }
        return body;
      });
    });
  }

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

  function setBusy(isBusy) {
    busy = isBusy;
    render();
    btnCloseGym.disabled = isBusy;
    logList.querySelectorAll("button").forEach(function (button) {
      button.disabled = isBusy;
    });
  }

  function render() {
    insideEl.textContent = inside;
    btnIn.disabled = busy || inside >= maxCapacity || Boolean(pendingEvent);
    btnOut.disabled = busy || inside <= 0 || Boolean(pendingEvent);
  }

  function setWaitSaving(saving) {
    saveButton.disabled = saving;
  }

  function timeLabel(value) {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function dateTimeLabel(value) {
    return new Date(value).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function renderActivity(events) {
    activityEvents = events;
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
      li.dataset.eventId = event.event_id;
      var left = document.createElement("span");
      var label = event.event_type === "in" ? "Checked in" : "Checked out";
      if (event.event_type === "in") {
        label += event.wait_time_min === null
          ? " · wait not recorded"
          : " · waited " + event.wait_time_min + " min";
      }
      left.textContent = label;
      var right = document.createElement("span");
      right.className = "t";
      right.textContent = timeLabel(event.created_at);
      var summary = document.createElement("div");
      summary.className = "activity-summary";
      summary.appendChild(left);
      summary.appendChild(right);
      li.appendChild(summary);

      var details = document.createElement("dl");
      details.className = "activity-record-details";
      details.hidden = true;
      [
        ["Event type", event.event_type],
        ["Created at", dateTimeLabel(event.created_at)],
        ["Wait time", event.wait_time_min === null ? "Not recorded" : event.wait_time_min + " min"]
      ].forEach(function (field) {
        var term = document.createElement("dt");
        term.textContent = field[0];
        var value = document.createElement("dd");
        value.textContent = field[1] === null || field[1] === undefined || field[1] === ""
          ? "—"
          : String(field[1]);
        details.appendChild(term);
        details.appendChild(value);
      });
      li.appendChild(details);

      var actions = document.createElement("div");
      actions.className = "activity-actions";
      var viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "btn-secondary";
      viewButton.dataset.eventAction = "view";
      viewButton.textContent = "View record";
      viewButton.setAttribute("aria-expanded", "false");
      viewButton.setAttribute("aria-label", "View record details for " + label.toLowerCase() + " at " + right.textContent);
      actions.appendChild(viewButton);

      if (event.event_type === "in") {
        var editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "btn-secondary";
        editButton.dataset.eventAction = "edit";
        editButton.textContent = "Edit wait";
        editButton.setAttribute("aria-label", "Edit wait time for check-in at " + right.textContent);
        actions.appendChild(editButton);
      }

      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn-secondary";
      deleteButton.dataset.eventAction = "delete";
      deleteButton.textContent = "Delete";
      deleteButton.setAttribute("aria-label", "Delete " + label.toLowerCase() + " at " + right.textContent);
      actions.appendChild(deleteButton);
      li.appendChild(actions);
      logList.appendChild(li);
    });

    if (!logList.firstChild) {
      var noValidEvents = document.createElement("li");
      noValidEvents.className = "mute empty";
      noValidEvents.textContent = "Nothing recorded yet.";
      logList.appendChild(noValidEvents);
    }
  }

  function showWaitEditor(listItem, event) {
    var actions = listItem.querySelector(".activity-actions");
    while (actions.firstChild) actions.removeChild(actions.firstChild);

    var editor = document.createElement("form");
    editor.className = "activity-edit";
    var input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "59";
    input.step = "1";
    input.inputMode = "numeric";
    input.value = event.wait_time_min === null ? "" : String(event.wait_time_min);
    input.setAttribute("aria-label", "Wait time in minutes");
    input.placeholder = "0–59 min";

    var saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "btn-primary";
    saveButton.textContent = "Save";

    var cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn-secondary";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", function () {
      renderActivity(activityEvents);
    });

    editor.appendChild(input);
    editor.appendChild(saveButton);
    editor.appendChild(cancelButton);
    actions.appendChild(editor);
    input.focus();

    editor.addEventListener("submit", function (submitEvent) {
      submitEvent.preventDefault();
      var raw = input.value.trim();
      var waitTimeMin = raw === "" ? null : Number(raw);
      if (waitTimeMin !== null && (!Number.isInteger(waitTimeMin) || waitTimeMin < 0 || waitTimeMin > 59)) {
        setMsg("Wait time must be blank or a whole number from 0 to 59 minutes.", "err");
        input.focus();
        return;
      }

      setBusy(true);
      setMsg("Saving wait time...", "");
      requestJSON("/admin/events/" + encodeURIComponent(event.event_id), {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wait_time_min: waitTimeMin })
      }).then(function () {
        return loadState().then(function () {
          setMsg("Wait time updated.", "ok");
        });
      }).catch(function (error) {
        setMsg(error.message || "Could not update the wait time.", "err");
      }).then(function () {
        setBusy(false);
      });
    });
  }

  logList.addEventListener("click", function (clickEvent) {
    var button = clickEvent.target.closest("button[data-event-action]");
    if (!button || busy) return;

    var listItem = button.closest("li[data-event-id]");
    if (!listItem) return;
    var event = activityEvents.find(function (item) {
      return item.event_id === listItem.dataset.eventId;
    });
    if (!event) {
      setMsg("That activity entry could not be found. Refresh the page and try again.", "err");
      return;
    }

    if (button.dataset.eventAction === "edit") {
      showWaitEditor(listItem, event);
      return;
    }
    if (button.dataset.eventAction === "view") {
      var recordDetails = listItem.querySelector(".activity-record-details");
      var expanded = button.getAttribute("aria-expanded") === "true";
      recordDetails.hidden = expanded;
      button.setAttribute("aria-expanded", expanded ? "false" : "true");
      button.textContent = expanded ? "View record" : "Hide record";
      return;
    }
    if (button.dataset.eventAction !== "delete") return;
    if (!window.confirm("Delete this activity entry permanently?")) return;

    setBusy(true);
    setMsg("Deleting activity entry...", "");
    requestJSON("/admin/events/" + encodeURIComponent(event.event_id), {
      method: "DELETE",
      credentials: "same-origin"
    }).then(function () {
      return loadState().then(function () {
        setMsg("Activity entry deleted.", "ok");
      });
    }).catch(function (error) {
      setMsg(error.message || "Could not delete the activity entry.", "err");
    }).then(function () {
      setBusy(false);
    });
  });

  function loadState() {
    return requestJSON("/admin/events", {
      method: "GET",
      credentials: "same-origin"
    }).then(function (state) {
      if (!state || !Array.isArray(state.events) || !Number.isInteger(state.insideCount)) {
        throw new Error("The gym activity response was invalid.");
      }
      inside = state.insideCount;
      renderActivity(state.events);
      render();
    });
  }

  function openPanel() {
    input.value = "";
    err.textContent = "";
    panel.hidden = false;
    setWaitSaving(false);
    render();
    input.focus();
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function closePanel() {
    panel.hidden = true;
    pendingEvent = null;
    render();
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
    }).catch(function (error) {
      return loadState().catch(function () {
        return null;
      }).then(function () {
        setMsg(error.message || "Could not save that. Please try again.", "err");
      });
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
    }).catch(function (error) {
      setMsg(error.message || "Could not close the gym or clear activity. Please try again.", "err");
    }).then(function () {
      setBusy(false);
    });
  });

  document.addEventListener("keydown", function (event) {
    var target = event.target;
    var tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
    var isTextEntry = tagName === "input"
      || tagName === "textarea"
      || tagName === "select"
      || (target && target.isContentEditable);

    if (
      !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !isTextEntry
      && !busy
      && panel.hidden
      && closeConfirm.hidden
    ) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        btnIn.click();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        btnOut.click();
      }
    }

    if (event.key === "Escape" && !closeConfirm.hidden) {
      closeConfirm.hidden = true;
      btnCloseGym.focus();
    }
  });

  setBusy(true);
  setMsg("Loading gym activity...", "");
  loadState().then(function () {
    setMsg("", "");
    setBusy(false);
  }).catch(function (error) {
    setMsg(error.message || "Could not load gym activity. Refresh the page to try again.", "err");
  });
})();
