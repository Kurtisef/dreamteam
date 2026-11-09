(function () {
  "use strict";

  var summary = document.getElementById("hourly-summary");
  var chart = document.getElementById("hourly-bars");
  var hourPickerGroup = document.getElementById("hour-picker-group");
  var hourPickerTrigger = document.getElementById("hour-picker-trigger");
  var hourPickerValue = document.getElementById("hour-picker-value");
  var hourPickerOptions = document.getElementById("hour-picker-options");
  var capacityError = document.getElementById("capacity-error");
  var capacityGauge = document.getElementById("capacity-gauge");
  var capacityValue = document.getElementById("capacity-value");
  var capacityVerdict = document.getElementById("capacity-verdict");
  var capacityUpdated = document.getElementById("capacity-updated");
  var outsideWait = document.getElementById("outside-wait");
  var outsideWaitValue = document.getElementById("outside-wait-value");
  var equipmentWaitValue = document.getElementById("equipment-wait-value");
  var mobileChart = window.matchMedia("(max-width: 720px)");
  var mockFullnessByHour = [
    20, 15, 12, 10, 12, 18, 28, 40, 52, 62, 66, 60,
    55, 50, 52, 60, 62, 78, 86, 66, 48, 30, 20, 15
  ];

  function parseTime(value) {
    if (typeof value !== "string") return null;
    var match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
    if (!match) return null;
    var hours = Number(match[1]);
    var minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function timeLabel(minutes) {
    var date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function hourLabel(hour) {
    var date = new Date(2000, 0, 1, hour);
    return date.toLocaleTimeString([], { hour: "numeric" });
  }

  function compactHourLabel(hour) {
    var normalizedHour = ((hour % 24) + 24) % 24;
    var suffix = normalizedHour < 12 ? "a" : "p";
    var hour12 = normalizedHour % 12 || 12;
    return hour12 + suffix;
  }

  function setEmptyChart(message) {
    chart.replaceChildren();
    hourPickerGroup.hidden = true;
    hourPickerOptions.hidden = true;
    hourPickerTrigger.setAttribute("aria-expanded", "false");
    var empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = message;
    chart.appendChild(empty);
  }

  function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function renderCapacity(capacity) {
    if (!capacity) {
      capacityError.hidden = false;
      capacityError.textContent = "Live gym estimates are not available yet.";
      capacityValue.textContent = "--%";
      capacityVerdict.textContent = "Live capacity unavailable";
      outsideWaitValue.textContent = "-- min";
      equipmentWaitValue.textContent = "-- min";
      capacityUpdated.textContent = "";
      capacityGauge.style.setProperty("--v", 0);
      capacityGauge.setAttribute("aria-label", "Live gym capacity unavailable");
      return;
    }

    if (
      !isNonNegativeInteger(capacity.capacity_percentage)
      || !isNonNegativeInteger(capacity.outside_wait_mins)
      || typeof capacity.at_max_capacity !== "boolean"
      || (capacity.current_headcount !== null && !isNonNegativeInteger(capacity.current_headcount))
      || (capacity.equipment_wait_mins !== null && !isNonNegativeInteger(capacity.equipment_wait_mins))
      || capacity.capacity_percentage > 100
    ) {
      throw new Error("The latest capacity record contains invalid metrics.");
    }

    var percent = capacity.capacity_percentage;
    capacityError.hidden = true;
    capacityValue.textContent = percent + "% full";
    capacityVerdict.textContent = percent >= 85 ? "The gym is very busy right now." : "Live gym capacity";
    outsideWaitValue.textContent = capacity.outside_wait_mins + " min";
    equipmentWaitValue.textContent = capacity.equipment_wait_mins === null
      ? "Unavailable"
      : capacity.equipment_wait_mins + " min";
    capacityGauge.style.setProperty("--v", percent / 100);
    capacityGauge.setAttribute("aria-label", "Gym is " + percent + "% full");

    var recordedAtValue = capacity.recorded_at;
    if (typeof recordedAtValue === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(recordedAtValue)) {
      recordedAtValue += "Z";
    }
    if (typeof recordedAtValue === "string") {
      recordedAtValue = recordedAtValue.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/i, "$1");
    }
    var recordedAt = new Date(recordedAtValue);
    if (Number.isNaN(recordedAt.getTime())) {
      capacityUpdated.textContent = "Latest AI estimate";
    } else {
      capacityUpdated.textContent = "Updated " + recordedAt.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      });
    }
  }

  function loadCapacity() {
    return fetch("/capacity/latest", { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.error ? body.error : "Could not load live gym capacity.");
          }
          return body;
        });
      })
      .then(function (body) {
        if (!body || !Object.prototype.hasOwnProperty.call(body, "capacity")) {
          throw new Error("The live capacity response was invalid.");
        }
        renderCapacity(body.capacity);
      });
  }

  function renderSchedule(rows, now) {
    if (!rows.length) {
      summary.textContent = "No operating hours are configured for today.";
      setEmptyChart("Hours unavailable");
      return;
    }

    var intervals = [];
    rows.forEach(function (row) {
      if (row.is_closed_all_day === true) return;
      var start = parseTime(row.open_time);
      var end = parseTime(row.close_time);
      if (start === null || end === null) return;
      if (end === 0 && start > 0) end = 24 * 60;
      else if (end <= start) end += 24 * 60;
      intervals.push({ start: start, end: end });
    });

    intervals.sort(function (a, b) { return a.start - b.start; });
    if (!intervals.length) {
      if (rows.every(function (row) { return row.is_closed_all_day === true; })) {
        summary.textContent = "The gym is closed all day today.";
        setEmptyChart("Closed all day");
      } else {
        summary.textContent = "Today’s schedule is unavailable.";
        setEmptyChart("Hours unavailable");
      }
      return;
    }

    summary.textContent = "Expected fullness by hour. Today’s hours: " + intervals.map(function (interval) {
      return timeLabel(interval.start) + "–" + timeLabel(interval.end);
    }).join(", ") + ".";

    var firstHour = Math.floor(intervals[0].start / 60);
    var lastHour = Math.ceil(intervals.reduce(function (latest, interval) {
      return Math.max(latest, interval.end);
    }, 0) / 60);
    var currentMinute = now.getHours() * 60 + now.getMinutes();
    var slots = [];

    for (var hour = firstHour; hour < lastHour; hour += 1) {
      var start = hour * 60;
      var end = start + 60;
      var open = intervals.some(function (interval) {
        return interval.start < end && interval.end > start;
      });
      var fullness = mockFullnessByHour[((hour % 24) + 24) % 24];
      slots.push({ hour: hour, open: open, fullness: fullness });
    }

    var selectedHour = slots.reduce(function (closest, slot) {
      return Math.abs(slot.hour - now.getHours()) < Math.abs(closest - now.getHours())
        ? slot.hour
        : closest;
    }, slots[0].hour);
    hourPickerOptions.replaceChildren();
    slots.forEach(function (slot) {
      var option = document.createElement("div");
      option.className = "hour-picker-option";
      option.setAttribute("role", "option");
      option.setAttribute("tabindex", "-1");
      option.dataset.hour = slot.hour;
      option.textContent = hourLabel(slot.hour) + (slot.open ? "" : " · Closed");
      option.addEventListener("click", function () {
        selectHour(slot.hour);
        closeHourPicker(true);
        renderChart();
      });
      option.addEventListener("keydown", function (event) {
        var options = Array.from(hourPickerOptions.querySelectorAll('[role="option"]'));
        var optionIndex = options.indexOf(option);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          var direction = event.key === "ArrowDown" ? 1 : -1;
          options[(optionIndex + direction + options.length) % options.length].focus();
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          options[event.key === "Home" ? 0 : options.length - 1].focus();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectHour(slot.hour);
          closeHourPicker(true);
          renderChart();
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeHourPicker(true);
        } else if (event.key === "Tab") {
          closeHourPicker(false);
        }
      });
      hourPickerOptions.appendChild(option);
    });
    selectHour(selectedHour);
    hourPickerGroup.hidden = !mobileChart.matches;

    function renderChart() {
      var visibleSlots = mobileChart.matches
        ? slots.filter(function (slot) { return slot.hour === selectedHour; })
        : slots;
      chart.replaceChildren();
      visibleSlots.forEach(function (slot) {
        var current = currentMinute >= slot.hour * 60 && currentMinute < (slot.hour + 1) * 60;
        var bar = document.createElement("div");
        bar.className = "bar " + (slot.open
          ? (slot.fullness < 35 ? "go" : slot.fullness < 70 ? "mid" : "hot")
          : "closed");
        if (slot.open) bar.style.setProperty("--p", slot.fullness);
        if (current) bar.classList.add("now");
        bar.setAttribute("role", "listitem");
        bar.setAttribute("aria-label", hourLabel(slot.hour)
          + (slot.open ? ", " + slot.fullness + "% expected fullness" : ", closed")
          + (current ? ", current hour" : ""));

        var value = document.createElement("em");
        value.textContent = slot.open ? slot.fullness + "%" : "Closed";
        var column = document.createElement("i");
        var label = document.createElement("b");
        label.textContent = mobileChart.matches ? hourLabel(slot.hour) : compactHourLabel(slot.hour);
        label.title = hourLabel(slot.hour);
        if (current) label.setAttribute("aria-label", hourLabel(slot.hour) + ", now");

        bar.appendChild(value);
        bar.appendChild(column);
        bar.appendChild(label);
        chart.appendChild(bar);
      });
    }

    function selectHour(hour) {
      selectedHour = hour;
      var selectedSlot = slots.find(function (slot) { return slot.hour === hour; });
      hourPickerValue.textContent = hourLabel(hour) + (selectedSlot.open ? "" : " · Closed");
      Array.from(hourPickerOptions.querySelectorAll('[role="option"]')).forEach(function (option) {
        var selected = Number(option.dataset.hour) === hour;
        option.setAttribute("aria-selected", String(selected));
        option.classList.toggle("is-selected", selected);
      });
    }

    function closeHourPicker(returnFocus) {
      hourPickerOptions.hidden = true;
      hourPickerTrigger.setAttribute("aria-expanded", "false");
      if (returnFocus) hourPickerTrigger.focus();
    }

    hourPickerTrigger.onclick = function () {
      var opening = hourPickerOptions.hidden;
      hourPickerOptions.hidden = !opening;
      hourPickerTrigger.setAttribute("aria-expanded", String(opening));
      if (opening) {
        var selectedOption = hourPickerOptions.querySelector('[aria-selected="true"]');
        if (selectedOption) selectedOption.focus();
      }
    };
    hourPickerTrigger.onkeydown = function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (hourPickerOptions.hidden) {
          hourPickerOptions.hidden = false;
          hourPickerTrigger.setAttribute("aria-expanded", "true");
        }
        var selectedOption = hourPickerOptions.querySelector('[aria-selected="true"]');
        if (selectedOption) selectedOption.focus();
      }
    };
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".hour-picker-control")) closeHourPicker(false);
    });
    if (mobileChart.addEventListener) mobileChart.addEventListener("change", function () {
      hourPickerGroup.hidden = !mobileChart.matches;
      closeHourPicker(false);
      renderChart();
    });
    renderChart();
  }

  var now = new Date();
  loadCapacity().catch(function () {
    capacityError.hidden = false;
    capacityError.textContent = "Live gym estimates could not be loaded. Please try again shortly.";
    capacityValue.textContent = "--%";
    capacityVerdict.textContent = "Live capacity unavailable";
    outsideWaitValue.textContent = "-- min";
    equipmentWaitValue.textContent = "-- min";
  });
  window.setInterval(function () {
    loadCapacity().catch(function () {
      capacityError.hidden = false;
      capacityError.textContent = "Could not refresh live gym estimates. Displaying the latest saved data.";
    });
  }, 60 * 1000);

  var localDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  fetch("/operating-hours?day_of_week=" + now.getDay() + "&date=" + localDate, { credentials: "same-origin" })
    .then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "Could not load today’s gym schedule.");
        }
        return body;
      });
    })
    .then(function (rows) {
      if (!Array.isArray(rows)) throw new Error("The operating-hours response was invalid.");
      renderSchedule(rows, now);
    })
    .catch(function () {
      summary.textContent = "Today’s schedule is unavailable.";
      setEmptyChart("Could not load gym hours.");
    });
})();
