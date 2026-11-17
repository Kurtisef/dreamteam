(function () {
  "use strict";
  var list = document.getElementById("admin-exceptions-list");
  var message = document.getElementById("schedule-admin-msg");
  if (!list || !message) return;
  var createForm = document.getElementById("new-exception-form");

  function request(url, options) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, options || {})).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || "Request failed.");
        return body;
      });
    });
  }
  function field(label, type, value) {
    var wrap = document.createElement("label");
    wrap.className = "exception-field";
    wrap.appendChild(document.createTextNode(label));
    var input = document.createElement("input");
    input.type = type;
    input.value = value || "";
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }
  function timeLabel(value) {
    if (!value) return "";
    var parts = value.split(":");
    return new Date(Date.UTC(2000, 0, 1, Number(parts[0]), Number(parts[1] || 0)))
      .toLocaleTimeString([], { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  }
  function render(rows) {
    list.replaceChildren();
    if (!rows.length) {
      message.textContent = "No future schedule changes are scheduled.";
      return;
    }
    message.textContent = "";
    rows.forEach(function (item) {
      var container = document.createElement("div");
      container.className = "exception-admin-item";
      var row = document.createElement("div");
      row.className = "exception-admin-row";
      var summary = document.createElement("p");
      summary.className = "exception-admin-summary";
      var date = document.createElement("strong");
      date.textContent = new Date(item.exception_date + "T00:00:00Z").toLocaleDateString([], {
        timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric"
      });
      var detail = document.createElement("span");
      detail.textContent = item.is_closed_all_day ? "Closed all day" : timeLabel(item.start_time) + "–" + timeLabel(item.end_time);
      var reasonText = document.createElement("span");
      reasonText.className = "exception-admin-reason";
      reasonText.textContent = item.reason || "No reason provided";
      summary.append(date, detail, reasonText);
      row.appendChild(summary);
      var actions = document.createElement("div");
      actions.className = "exception-admin-actions";
      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn-secondary";
      edit.textContent = "Edit";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-secondary";
      remove.textContent = "Delete";
      actions.append(edit, remove);
      row.appendChild(actions);
      container.appendChild(row);

      var form = document.createElement("form");
      form.className = "exception-admin-edit";
      var times = document.createElement("div");
      times.className = "exception-admin-fields";
      var start = field("Opens", "time", item.start_time);
      var end = field("Closes", "time", item.end_time);
      var reason = field("Reason", "text", item.reason);
      reason.input.maxLength = 240;
      var closedWrap = document.createElement("label");
      closedWrap.className = "exception-closed-toggle";
      var closed = document.createElement("input");
      closed.type = "checkbox";
      closed.checked = item.is_closed_all_day === true;
      closedWrap.appendChild(closed);
      closedWrap.appendChild(document.createTextNode("Closed all day"));
      times.append(start.wrap, end.wrap, reason.wrap, closedWrap);
      form.appendChild(times);
      function syncClosed() {
        start.wrap.hidden = end.wrap.hidden = closed.checked;
      }
      closed.addEventListener("change", syncClosed);
      syncClosed();
      var save = document.createElement("button");
      save.type = "submit";
      save.className = "btn-primary";
      save.textContent = "Save changes";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn-secondary";
      cancel.textContent = "Cancel";
      var editActions = document.createElement("div");
      editActions.className = "exception-admin-actions";
      editActions.append(save, cancel);
      form.appendChild(editActions);
      form.hidden = true;
      container.appendChild(form);
      edit.addEventListener("click", function () { form.hidden = !form.hidden; });
      cancel.addEventListener("click", function () { form.hidden = true; });
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        save.disabled = true;
        request("/admin/schedule-exceptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          schedule_id: item.schedule_id, exception_date: item.exception_date,
          start_time: start.input.value, end_time: end.input.value,
          reason: reason.input.value, is_closed_all_day: closed.checked
        }) }).then(load).then(function () { message.textContent = "Schedule change saved."; })
          .catch(function (error) { message.textContent = error.message; })
          .finally(function () { save.disabled = false; });
      });
      remove.addEventListener("click", function () {
        if (!window.confirm("Delete this future schedule change?")) return;
        remove.disabled = true;
        request("/admin/schedule-exceptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          schedule_id: item.schedule_id, exception_date: item.exception_date
        }) }).then(load).then(function () { message.textContent = "Schedule change removed."; })
          .catch(function (error) { message.textContent = error.message; remove.disabled = false; });
      });
      list.appendChild(container);
    });
  }
  function load() {
    return request("/admin/schedule-exceptions").then(render).catch(function (error) {
      message.textContent = error.message || "Could not load future schedule changes.";
    });
  }
  if (createForm) {
    var dateInput = document.getElementById("exception-date");
    var createMessage = document.getElementById("exception-create-msg");
    var createButton = document.getElementById("exception-create-submit");
    var closedInput = document.getElementById("exception-closed");
    var startInput = document.getElementById("exception-start");
    var endInput = document.getElementById("exception-end");
    function gymToday() {
      var zone = document.querySelector("main").dataset.gymTimeZone || "America/Denver";
      var p = {};
      new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date()).forEach(function (part) { p[part.type] = part.value; });
      return p.year + "-" + p.month + "-" + p.day;
    }
    dateInput.min = gymToday();
    closedInput.addEventListener("change", function () {
      startInput.disabled = endInput.disabled = closedInput.checked;
      startInput.required = endInput.required = !closedInput.checked;
    });
    createForm.addEventListener("submit", function (event) {
      event.preventDefault();
      createButton.disabled = true;
      createMessage.textContent = "Saving schedule change…";
      request("/admin/schedule-exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        exception_date: dateInput.value,
        start_time: startInput.value,
        end_time: endInput.value,
        reason: document.getElementById("exception-reason").value,
        is_closed_all_day: closedInput.checked
      }) }).then(function () {
        createMessage.textContent = "Schedule change added.";
        createForm.reset();
        dateInput.min = gymToday();
        return load();
      }).catch(function (error) {
        createMessage.textContent = error.message;
      }).finally(function () { createButton.disabled = false; });
    });
  }
  load();
})();
