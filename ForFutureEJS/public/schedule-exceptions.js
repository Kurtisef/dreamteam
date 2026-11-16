(function () {
  "use strict";
  var target = document.getElementById("upcoming-exceptions-list");
  if (!target) return;

  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }
  function dateInGymZone() {
    var zone = document.querySelector("main").dataset.gymTimeZone || "America/Denver";
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    var part = {};
    parts.forEach(function (item) { part[item.type] = item.value; });
    return new Date(Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day)));
  }
  function readableDate(key) {
    return new Date(key + "T00:00:00Z").toLocaleDateString([], {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric"
    });
  }
  function readableTime(value) {
    if (!value) return "";
    var bits = value.split(":");
    return new Date(Date.UTC(2000, 0, 1, Number(bits[0]), Number(bits[1] || 0)))
      .toLocaleTimeString([], { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  }
  var start = dateInGymZone();
  var end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 30);

  fetch("/schedule-exceptions?start_date=" + dateKey(start) + "&end_date=" + dateKey(end))
    .then(function (response) {
      if (!response.ok) throw new Error("Upcoming schedule changes are unavailable.");
      return response.json();
    })
    .then(function (exceptions) {
      if (!exceptions.length) {
        target.innerHTML = '<p class="mute">No upcoming schedule changes.</p>';
        return;
      }
      var list = document.createElement("ul");
      list.className = "exception-list";
      exceptions.forEach(function (item) {
        var row = document.createElement("li");
        var date = document.createElement("strong");
        date.textContent = readableDate(item.exception_date);
        row.appendChild(date);
        var details = document.createElement("span");
        if (item.is_closed_all_day) details.textContent = "Closed all day";
        else details.textContent = "Open hours: " + readableTime(item.start_time) + "–" + readableTime(item.end_time);
        row.appendChild(details);
        if (item.reason) {
          var reason = document.createElement("span");
          reason.className = "exception-reason";
          reason.textContent = item.reason;
          row.appendChild(reason);
        }
        list.appendChild(row);
      });
      target.replaceChildren(list);
    })
    .catch(function () {
      target.innerHTML = '<p class="mute">Could not load upcoming schedule changes.</p>';
    });
})();
