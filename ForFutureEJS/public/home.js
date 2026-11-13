(function () {
  "use strict";

  var summary = document.getElementById("hourly-summary");
  var chart = document.getElementById("hourly-bars");
  var hourPickerGroup = document.getElementById("hour-picker-group");
  var hourPickerTrigger = document.getElementById("hour-picker-trigger");
  var hourPickerValue = document.getElementById("hour-picker-value");
  var hourPickerOptions = document.getElementById("hour-picker-options");
  var capacityError = document.getElementById("capacity-error");
  var capacityHero = document.getElementById("capacity-hero");
  var capacityGauge = document.getElementById("capacity-gauge");
  var capacityValue = document.getElementById("capacity-value");
  var capacityVerdict = document.getElementById("capacity-verdict");
  var capacityUpdated = document.getElementById("capacity-updated");
  var outsideWait = document.getElementById("outside-wait");
  var outsideWaitValue = document.getElementById("outside-wait-value");
  var equipmentWaitValue = document.getElementById("equipment-wait-value");
  var mobileChart = window.matchMedia("(max-width: 720px)");
  var capacityData = null;
  var capacityAvailable = false;
  var scheduleStatus = "loading";
  var maximumCapacityAgeMs = 30 * 60 * 1000;

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

  function isValidCapacity(capacity) {
    var recordedAtValue = typeof capacity.recorded_at === "string"
      ? capacity.recorded_at
      : "";
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(recordedAtValue)) {
      recordedAtValue += "Z";
    }
    recordedAtValue = recordedAtValue.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/i, "$1");
    var recordedAt = new Date(recordedAtValue);
    var ageMs = Date.now() - recordedAt.getTime();
    if (
      !isNonNegativeInteger(capacity.capacity_percentage)
      || !isNonNegativeInteger(capacity.outside_wait_mins)
      || typeof capacity.at_max_capacity !== "boolean"
      || (capacity.current_headcount !== null && !isNonNegativeInteger(capacity.current_headcount))
      || (capacity.equipment_wait_mins !== null && !isNonNegativeInteger(capacity.equipment_wait_mins))
      || capacity.capacity_percentage > 100
      || Number.isNaN(recordedAt.getTime())
      || ageMs > maximumCapacityAgeMs
      || ageMs < -5 * 60 * 1000
    ) {
      throw new Error("The latest capacity record contains invalid metrics.");
    }
  }

  function renderHeroState() {
    capacityHero.classList.remove("is-closed", "is-unavailable");

    if (scheduleStatus === "closed") {
      capacityError.hidden = true;
      capacityHero.classList.add("is-closed");
      capacityVerdict.textContent = "The gym is closed right now.";
      capacityValue.textContent = "Closed";
      outsideWaitValue.textContent = "Closed";
      equipmentWaitValue.textContent = "Closed";
      capacityUpdated.textContent = "";
      capacityGauge.style.setProperty("--v", 0);
      capacityGauge.setAttribute("aria-label", "The gym is closed");
      return;
    }

    if (scheduleStatus === "unavailable" || !capacityAvailable || !capacityData) {
      capacityError.hidden = false;
      capacityError.textContent = "Live estimates are unavailable. We can’t load current gym data right now.";
      capacityHero.classList.add("is-unavailable");
      capacityVerdict.textContent = "We can’t read the gym right now.";
      capacityValue.textContent = "Unavailable";
      outsideWaitValue.textContent = "Unavailable";
      equipmentWaitValue.textContent = "Unavailable";
      capacityUpdated.textContent = "";
      capacityGauge.style.setProperty("--v", 0);
      capacityGauge.setAttribute("aria-label", "Live gym capacity unavailable");
      return;
    }

    capacityError.hidden = true;
    var percent = capacityData.capacity_percentage;
    capacityValue.textContent = percent + "% full";
    capacityVerdict.textContent = percent >= 85 ? "The gym is very busy right now." : "Live gym capacity";
    outsideWaitValue.textContent = capacityData.outside_wait_mins + " min";
    equipmentWaitValue.textContent = capacityData.equipment_wait_mins === null
      ? "Unavailable"
      : capacityData.equipment_wait_mins + " min";
    capacityGauge.style.setProperty("--v", percent / 100);
    capacityGauge.setAttribute("aria-label", "Gym is " + percent + "% full");

    var recordedAtValue = capacityData.recorded_at;
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

  function renderCapacity(capacity) {
    if (!capacity) {
      capacityData = null;
      capacityAvailable = false;
      renderHeroState();
      return;
    }

    isValidCapacity(capacity);
    capacityData = capacity;
    capacityAvailable = true;
    renderHeroState();
  }

  function setUnavailable(error, scheduleUnavailable) {
    if (error) console.error("Live gym data is unavailable:", error);
    capacityData = null;
    capacityAvailable = false;
    if (scheduleUnavailable) scheduleStatus = "unavailable";
    renderHeroState();
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

  function fetchHourlyCapacity(date) {
    return fetch("/capacity/hourly?date=" + date, {
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "Could not load hourly gym capacity.");
        }
        function isValidAverageSet(averages) {
          return Array.isArray(averages)
            && averages.length === 24
            && averages.every(function (item, index) {
              return item
                && item.hour === index
                && Number.isInteger(item.sample_count)
                && item.sample_count >= 0
                && (item.average_capacity === null
                  || (typeof item.average_capacity === "number"
                    && Number.isFinite(item.average_capacity)
                    && item.average_capacity >= 0
                    && item.average_capacity <= 100));
            });
        }
        if (
          !body
          || body.date !== date
          || !isValidAverageSet(body.today)
          || !isValidAverageSet(body.weekday)
          || typeof body.historical_start_date !== "string"
        ) {
          throw new Error("The hourly capacity response was invalid.");
        }
        return body;
      });
    });
  }

  function renderSchedule(rows, now, hourlyAverages) {
    if (!rows.length) {
      scheduleStatus = "unavailable";
      renderHeroState();
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
        scheduleStatus = "closed";
        renderHeroState();
        summary.textContent = "The gym is closed all day today.";
        setEmptyChart("Closed all day");
      } else {
        scheduleStatus = "unavailable";
        renderHeroState();
        summary.textContent = "Today’s schedule is unavailable.";
        setEmptyChart("Hours unavailable");
      }
      return;
    }

    var currentMinute = now.getHours() * 60 + now.getMinutes();
    var isOpenNow = intervals.some(function (interval) {
      return currentMinute >= interval.start && currentMinute < interval.end;
    });
    scheduleStatus = isOpenNow ? "open" : "closed";
    renderHeroState();

    summary.textContent = "Today’s hours: " + intervals.map(function (interval) {
      return timeLabel(interval.start) + "–" + timeLabel(interval.end);
    }).join(", ") + ".";

    var firstHour = Math.floor(intervals[0].start / 60);
    var lastHour = Math.ceil(intervals.reduce(function (latest, interval) {
      return Math.max(latest, interval.end);
    }, 0) / 60);
    var slots = [];

    for (var hour = firstHour; hour < lastHour; hour += 1) {
      var start = hour * 60;
      var end = start + 60;
      var open = intervals.some(function (interval) {
        return interval.start < end && interval.end > start;
      });
      slots.push({ hour: hour, open: open, fullness: null, forecast: false });
    }
    updateSlotAverages(hourlyAverages, now);

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
          ? (slot.fullness === null
            ? "no-data"
            : (slot.fullness < 35 ? "go" : slot.fullness < 70 ? "mid" : "hot"))
          : "closed");
        if (slot.open && slot.fullness !== null) bar.style.setProperty("--p", slot.fullness);
        if (current) bar.classList.add("now");
        bar.setAttribute("role", "listitem");
        bar.setAttribute("aria-label", hourLabel(slot.hour)
          + (slot.open
            ? (slot.fullness === null
              ? ", no capacity data recorded"
              : ", " + formatPercentage(slot.fullness) + "% "
                + (slot.forecast ? "weekday forecast average" : "average capacity today"))
            : ", closed")
          + (current ? ", current hour" : ""));

        var value = document.createElement("em");
        value.textContent = slot.open
          ? (slot.fullness === null ? "N/A" : formatPercentage(slot.fullness) + "%")
          : "Closed";
        var column = document.createElement("i");
        if (slot.open && slot.forecast && slot.fullness !== null) column.classList.add("p");
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

    function updateSlotAverages(averages, atTime) {
      slots.forEach(function (slot) {
        var localHour = ((slot.hour % 24) + 24) % 24;
        slot.forecast = slot.hour > atTime.getHours();
        var averagesForHour = slot.forecast ? averages.weekday : averages.today;
        var hourlyAverage = averagesForHour.find(function (item) {
          return item.hour === localHour;
        });
        slot.fullness = hourlyAverage ? hourlyAverage.average_capacity : null;
      });
    }

    function formatPercentage(value) {
      return String(Math.round(value));
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

    return function (averages, updatedAt) {
      var previousCurrentHour = Math.floor(currentMinute / 60);
      currentMinute = updatedAt.getHours() * 60 + updatedAt.getMinutes();
      updateSlotAverages(averages, updatedAt);
      if (mobileChart.matches && selectedHour === previousCurrentHour) {
        selectHour(updatedAt.getHours());
      }
      renderChart();
    };
  }

  var now = new Date();
  loadCapacity().catch(function () {
    setUnavailable(new Error("Could not load live gym capacity."));
  });
  window.setInterval(function () {
    loadCapacity().catch(function () {
      setUnavailable(new Error("Could not refresh live gym capacity."));
    });
  }, 60 * 1000);

  var localDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  var updateHourlyChart = null;
  Promise.all([
    fetch("/operating-hours?day_of_week=" + now.getDay() + "&date=" + localDate, { credentials: "same-origin" })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.error ? body.error : "Could not load today’s gym schedule.");
          }
          return body;
        });
      }),
    fetchHourlyCapacity(localDate)
  ])
    .then(function (results) {
      var rows = results[0];
      var hourlyAverages = results[1];
      if (!Array.isArray(rows)) throw new Error("The operating-hours response was invalid.");
      updateHourlyChart = renderSchedule(rows, now, hourlyAverages);
    })
    .catch(function (error) {
      console.error("Could not load the schedule or hourly capacity data:", error);
      setUnavailable(error, true);
      summary.textContent = "Today’s schedule or live capacity data is unavailable.";
      setEmptyChart("Could not load live hourly capacity.");
    });
  window.setInterval(function () {
    if (!updateHourlyChart) return;
    fetchHourlyCapacity(localDate).then(function (hourlyAverages) {
      updateHourlyChart(hourlyAverages, new Date());
    }).catch(function (error) {
      console.error("Could not refresh hourly capacity data:", error);
      setUnavailable(error);
      summary.textContent = "Hourly capacity could not be refreshed. Showing the latest loaded data.";
    });
  }, 60 * 1000);
})();
