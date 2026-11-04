(function () {
  "use strict";

  var btnIn = document.getElementById("btn-in");
  var btnOut = document.getElementById("btn-out");
  var insideEl = document.getElementById("inside-count");
  var msg = document.getElementById("admin-msg");
  var panel = document.getElementById("wait-panel");
  var form = document.getElementById("wait-form");
  var input = document.getElementById("wait-min");
  var err = document.getElementById("wait-err");
  var skip = document.getElementById("wait-skip");
  var logList = document.getElementById("log-list");

  var inside = 0;
  var pendingEvent = null; // the check in waiting for an optional wait time

  function saveEvent(event) {
    return fetch("/admin/events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: event.type,
        wait_time_min: event.type === "in" ? event.waitMinutes : null
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("The event could not be saved.");
    });
  }

  function setMsg(text, kind) {
    msg.textContent = text || "";
    msg.className = kind || "";
  }

  function render() {
    insideEl.textContent = inside;
  }

  function timeLabel(d) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function addLog(type, waitMinutes, when) {
    var empty = logList.querySelector(".empty");
    if (empty) empty.remove();
    var li = document.createElement("li");
    li.className = type;
    var label = type === "in" ? "Checked in" : "Checked out";
    if (type === "in" && waitMinutes) label += " · waited " + waitMinutes + " min";
    var left = document.createElement("span");
    left.textContent = label;
    var right = document.createElement("span");
    right.className = "t";
    right.textContent = timeLabel(when);
    li.appendChild(left);
    li.appendChild(right);
    logList.insertBefore(li, logList.firstChild);
    while (logList.children.length > 8) logList.removeChild(logList.lastChild);
  }

  function setBusy(busy) {
    btnIn.disabled = busy;
    btnOut.disabled = busy;
  }

  function openPanel() {
    input.value = "";
    err.textContent = "";
    panel.hidden = false;
    setBusy(true); // normal screen returns after Save or Skip
    input.focus();
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function closePanel() {
    panel.hidden = true;
    pendingEvent = null;
    setBusy(false);
    btnIn.focus();
  }

  function commit(event) {
    return saveEvent(event).then(function () {
      addLog(event.type, event.waitMinutes, new Date(event.at));
    }).catch(function () {
      inside += event.type === "in" ? -1 : 1;
      render();
      setMsg("Could not save that. Please try again.", "err");
    });
  }

  btnIn.addEventListener("click", function () {
    inside += 1;
    render();
    setMsg("Enter the wait time or skip to save the check in.", "");
    pendingEvent = { type: "in", waitMinutes: null, at: new Date().toISOString() };
    openPanel();
  });

  btnOut.addEventListener("click", function () {
    if (inside === 0) {
      setMsg("The count is already 0. Nobody to check out.", "err");
      return;
    }
    inside -= 1;
    render();
    setMsg("Saving check out...", "");
    commit({ type: "out", waitMinutes: null, at: new Date().toISOString() });
  });

  // Numbers only: strip anything that is not a digit as it is typed or pasted
  input.addEventListener("input", function () {
    var cleaned = input.value.replace(/\D/g, "");
    if (cleaned !== input.value) input.value = cleaned;
    err.textContent = "";
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = input.value.trim();
    if (raw === "") {
      err.textContent = "Enter the minutes waited, or press Skip.";
      return;
    }
    var minutes = parseInt(raw, 10);
    if (!(minutes >= 1)) {
      err.textContent = "Wait time must be at least 1 minute.";
      return;
    }
    pendingEvent.waitMinutes = minutes;
    var ev = pendingEvent;
    closePanel();
    commit(ev);
  });

  skip.addEventListener("click", function () {
    var ev = pendingEvent;
    closePanel();
    commit(ev); // check in is still recorded, with no wait time
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panel.hidden) skip.click();
  });

  render();
})();
