(function () {
  "use strict";

  var status = document.getElementById("okr-status");
  var reservationsValue = document.getElementById("okr-reservations-value");
  var reservationsByProfile = document.getElementById("okr-reservations-by-profile");
  var reservationsPagination = document.getElementById("okr-reservations-pagination");
  var opensValue = document.getElementById("okr-opens-value");
  var opensTrend = document.getElementById("okr-opens-trend");
  var opensPagination = document.getElementById("okr-opens-pagination");
  var waitPickerTrigger = document.getElementById("okr-wait-picker-trigger");
  var waitPickerValue = document.getElementById("okr-wait-picker-value");
  var waitPickerOptions = document.getElementById("okr-wait-picker-options");
  var waitTrend = document.getElementById("okr-wait-trend");
  var capacityTrend = document.getElementById("okr-capacity-trend");
  var pageSize = 5;
  var reservations = [];
  var weeklyOpens = [];
  var weeklyWaits = [];
  var selectedWaitType = "outside";
  var reservationsPage = 0;
  var opensPage = 0;

  function formatNumber(value) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
      : "Not available";
  }

  function weekLabel(value) {
    var date = new Date(value + "T12:00:00Z");
    return Number.isNaN(date.getTime())
      ? "Week unavailable"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }

  function renderPagination(nav, total, page, label, onPageChange) {
    nav.replaceChildren();
    var pageCount = Math.ceil(total / pageSize);
    nav.hidden = pageCount <= 1;
    if (nav.hidden) return;

    var previous = document.createElement("button");
    previous.type = "button";
    previous.className = "okr-page-button";
    previous.textContent = "‹";
    previous.setAttribute("aria-label", "Previous " + label);
    previous.disabled = page === 0;
    previous.addEventListener("click", function () {
      onPageChange(page - 1);
    });

    var next = document.createElement("button");
    next.type = "button";
    next.className = "okr-page-button";
    next.textContent = "›";
    next.setAttribute("aria-label", "Next " + label);
    next.disabled = page >= pageCount - 1;
    next.addEventListener("click", function () {
      onPageChange(page + 1);
    });

    var range = document.createElement("span");
    var first = page * pageSize + 1;
    var last = Math.min(first + pageSize - 1, total);
    range.textContent = first + "–" + last + " of " + total + " " + label;
    nav.appendChild(previous);
    nav.appendChild(range);
    nav.appendChild(next);
  }

  function renderTrend(list, entries, valueKey, unit, samplesKey, samplesLabel, page) {
    list.replaceChildren();
    var visibleEntries = page === null
      ? entries
      : entries.slice(page * pageSize, (page + 1) * pageSize);
    visibleEntries.forEach(function (entry) {
      var item = document.createElement("li");
      var week = document.createElement("span");
      week.textContent = weekLabel(entry.week_start);
      var value = document.createElement("strong");
      value.textContent = entry[valueKey] === null || entry[valueKey] === undefined
        ? "No data"
        : formatNumber(Number(entry[valueKey])) + (unit ? unit : "");
      item.appendChild(week);
      item.appendChild(value);
      if (samplesKey) {
        var samples = document.createElement("small");
        samples.textContent = formatNumber(Number(entry[samplesKey])) + " " + samplesLabel;
        item.appendChild(samples);
      }
      list.appendChild(item);
    });
    if (!visibleEntries.length) {
      var empty = document.createElement("li");
      empty.textContent = "No data available yet.";
      list.appendChild(empty);
    }
  }

  function renderReservations() {
    reservationsByProfile.replaceChildren();
    reservations.slice(reservationsPage * pageSize, (reservationsPage + 1) * pageSize)
      .forEach(function (profile) {
        var row = document.createElement("tr");
        var profileCell = document.createElement("td");
        profileCell.textContent = profile.display_name || "Unnamed profile";
        var visitsCell = document.createElement("td");
        visitsCell.textContent = formatNumber(Number(profile.total_planned_visits));
        row.appendChild(profileCell);
        row.appendChild(visitsCell);
        reservationsByProfile.appendChild(row);
      });
    if (!reservations.length) {
      var row = document.createElement("tr");
      var empty = document.createElement("td");
      empty.colSpan = 2;
      empty.textContent = "No profiles found.";
      row.appendChild(empty);
      reservationsByProfile.appendChild(row);
    }
    renderPagination(
      reservationsPagination,
      reservations.length,
      reservationsPage,
      "profiles",
      function (page) {
        reservationsPage = page;
        renderReservations();
      }
    );
  }

  function renderOpens() {
    renderTrend(opensTrend, weeklyOpens, "average_opens_per_profile", " opens/profile", "open_count", "total opens", opensPage);
    renderPagination(opensPagination, weeklyOpens.length, opensPage, "weeks", function (page) {
      opensPage = page;
      renderOpens();
    });
  }

  function renderWaitTrend() {
    var outside = selectedWaitType === "outside";
    waitTrend.setAttribute("aria-label", outside ? "Weekly average outside wait" : "Weekly average equipment wait");
    renderTrend(
      waitTrend,
      weeklyWaits,
      outside ? "average_outside_wait_minutes" : "average_equipment_wait_minutes",
      " min",
      null,
      null,
      null
    );
  }

  function selectWaitType(type) {
    selectedWaitType = type;
    var outside = type === "outside";
    waitPickerValue.textContent = outside ? "Outside wait" : "Equipment wait";
    waitPickerOptions.querySelectorAll('[role="option"]').forEach(function (option) {
      var selected = option.dataset.waitType === type;
      option.setAttribute("aria-selected", String(selected));
      option.classList.toggle("is-selected", selected);
    });
    renderWaitTrend();
  }

  function closeWaitPicker(returnFocus) {
    waitPickerOptions.hidden = true;
    waitPickerTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) waitPickerTrigger.focus();
  }

  function renderWaitPickerOptions() {
    [
      { type: "outside", label: "Outside wait" },
      { type: "equipment", label: "Equipment wait" },
    ].forEach(function (item) {
      var option = document.createElement("div");
      option.className = "hour-picker-option";
      option.setAttribute("role", "option");
      option.setAttribute("tabindex", "-1");
      option.dataset.waitType = item.type;
      option.textContent = item.label;
      option.addEventListener("click", function () {
        selectWaitType(item.type);
        closeWaitPicker(true);
      });
      option.addEventListener("keydown", function (event) {
        var options = Array.from(waitPickerOptions.querySelectorAll('[role="option"]'));
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
          selectWaitType(item.type);
          closeWaitPicker(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeWaitPicker(true);
        } else if (event.key === "Tab") {
          closeWaitPicker(false);
        }
      });
      waitPickerOptions.appendChild(option);
    });
    selectWaitType(selectedWaitType);
  }

  waitPickerTrigger.addEventListener("click", function () {
    var opening = waitPickerOptions.hidden;
    waitPickerOptions.hidden = !opening;
    waitPickerTrigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      var selectedOption = waitPickerOptions.querySelector('[aria-selected="true"]');
      if (selectedOption) selectedOption.focus();
    }
  });
  waitPickerTrigger.addEventListener("keydown", function (event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      waitPickerOptions.hidden = false;
      waitPickerTrigger.setAttribute("aria-expanded", "true");
      var selectedOption = waitPickerOptions.querySelector('[aria-selected="true"]');
      if (selectedOption) selectedOption.focus();
    }
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".okr-wait-picker-control")) closeWaitPicker(false);
  });

  renderWaitPickerOptions();
  fetch("/admin/okr-data", { credentials: "same-origin", cache: "no-store" })
    .then(function (response) {
      return response.json().catch(function () {
        return null;
      }).then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "Could not load OKR metrics.");
        }
        return body;
      });
    })
    .then(function (data) {
      if (!data || !Array.isArray(data.planned_visits_by_profile)
        || !Array.isArray(data.app_opens_weekly)
        || !Array.isArray(data.wait_times_weekly)
        || !Array.isArray(data.capacity_variation_weekly)) {
        throw new Error("The OKR metrics response was invalid.");
      }

      reservations = data.planned_visits_by_profile;
      reservationsValue.textContent = data.profiles_count
        ? formatNumber(Number(data.planned_visits_count) / Number(data.profiles_count))
        : "Not available";
      renderReservations();

      opensValue.textContent = data.app_opens_per_profile === null
        ? "Not available"
        : formatNumber(Number(data.app_opens_per_profile));
      weeklyOpens = data.app_opens_weekly;
      renderOpens();

      weeklyWaits = data.wait_times_weekly;
      renderWaitTrend();
      renderTrend(
        capacityTrend,
        data.capacity_variation_weekly,
        "capacity_percentage_stddev",
        "%",
        null,
        null,
        null
      );
      status.textContent = "OKR metrics updated " + new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      }) + ".";
    })
    .catch(function (error) {
      status.classList.add("err");
      status.textContent = error.message || "Could not load OKR metrics.";
    });
})();
