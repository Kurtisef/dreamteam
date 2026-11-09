(() => {
  const form = document.getElementById('plan-form');
  if (!form) return;

  const dateInput = document.getElementById('plan-date');
  const timeInput = document.getElementById('plan-time');
  const durationInput = document.getElementById('plan-duration');
  const message = document.getElementById('plan-msg');
  const scheduleMessage = document.getElementById('plan-schedule');
  const list = document.getElementById('plan-list');
  const quotaBadge = document.getElementById('daily-quota-badge');
  const submitButton = document.getElementById('plan-submit');
  const visits = [];
  let scheduleIntervals = [];
  let scheduleReady = false;
  let scheduleLoading = false;
  let scheduleRequest = 0;
  const equipmentColumns = [
    ['Racks', 'racks'],
    ['Dumbbells', 'dumbbells'],
    ['Cable stacks', 'cable_stacks'],
    ['Weight machines', 'weight_machines'],
    ['Cardio machines', 'cardio_machines'],
  ];

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setDateBounds() {
    const gymNow = getGymClockParts();
    const today = gymNow.date;
    const tomorrow = addCalendarDays(today, 1);
    const maxDate = addCalendarDays(today, 7);
    const firstBookableDate = gymNow.hour >= 22 ? tomorrow : today;
    dateInput.min = firstBookableDate;
    dateInput.max = maxDate;
    if (!dateInput.value || dateInput.value < dateInput.min || dateInput.value > dateInput.max) {
      dateInput.value = firstBookableDate;
    }
  }

  function getGymClockParts(now = new Date()) {
    const timeZone = dateInput.dataset.gymTimeZone || 'America/Denver';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      hour: Number(values.hour),
      minute: Number(values.minute),
    };
  }

  function addCalendarDays(date, days) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  }

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.className = isError ? 'err' : 'ok';
  }

  function timestampDatePart(value) {
    return String(value || '').slice(0, 10);
  }

  function timestampMinutes(value) {
    const match = String(value || '').match(/T(\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  }

  function visitDuration(visit) {
    return timestampMinutes(visit.exit_time) - timestampMinutes(visit.intended_arrival);
  }

  function bookedMinutes(date) {
    return visits
      .filter((visit) => timestampDatePart(visit.intended_arrival) === date)
      .reduce((total, visit) => total + visitDuration(visit), 0);
  }

  function formatTime(value) {
    const match = String(value || '').match(/T(\d{2}):(\d{2})/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const date = new Date(2000, 0, 1, hour, minute);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function updateQuota() {
    const selectedDate = dateInput.value;
    if (!selectedDate) return;
    quotaBadge.textContent = `${bookedMinutes(selectedDate)} / 120 min booked on ${selectedDate}`;
  }

  function parseScheduleTime(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function scheduleIntervalsFromRows(rows) {
    const intervals = rows.flatMap((row) => {
      if (row.is_closed_all_day === true) return [];
      const start = parseScheduleTime(row.open_time);
      let end = parseScheduleTime(row.close_time);
      if (start === null || end === null) return [];
      if (end === 0 && start > 0) end = 1440;
      else if (end <= start) end += 1440;
      return [{ start, end }];
    }).sort((a, b) => a.start - b.start);

    const merged = [];
    intervals.forEach((interval) => {
      const previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    });
    return merged;
  }

  function formatScheduleTime(minutes) {
    const date = new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function updateAvailableTimes() {
    const duration = Number(durationInput.value);
    const previousValue = timeInput.value;
    const gymNow = getGymClockParts();
    const availableStarts = [];
    scheduleIntervals.forEach((interval) => {
      for (let start = 0; start < 1440; start += 30) {
        if (dateInput.value === gymNow.date && start <= gymNow.hour * 60 + gymNow.minute) continue;
        if (start >= interval.start && start + duration <= interval.end && start + duration <= 1440) {
          availableStarts.push(start);
        }
      }
    });

    const uniqueStarts = [...new Set(availableStarts)].sort((a, b) => a - b);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = !scheduleReady && scheduleLoading
      ? 'Loading schedule…'
      : uniqueStarts.length ? 'Choose a start time' : 'No times available';
    timeInput.replaceChildren(placeholder);
    uniqueStarts.forEach((minutes) => {
      const option = document.createElement('option');
      option.value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      option.textContent = formatScheduleTime(minutes);
      timeInput.append(option);
    });
    if (uniqueStarts.some((minutes) => {
      const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      return value === previousValue;
    })) {
      timeInput.value = previousValue;
    }
    submitButton.disabled = !scheduleReady || uniqueStarts.length === 0;
  }

  async function loadSchedule() {
    const requestId = ++scheduleRequest;
    const date = dateInput.value;
    scheduleReady = false;
    scheduleLoading = true;
    scheduleIntervals = [];
    scheduleMessage.textContent = 'Loading this date’s schedule…';
    updateAvailableTimes();

    const dateParts = date.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2])).getUTCDay();
    try {
      const rows = await readResponse(await fetch(
        `/operating-hours?day_of_week=${dayOfWeek}&date=${encodeURIComponent(date)}`,
        { credentials: 'same-origin', cache: 'no-store' }
      ));
      if (requestId !== scheduleRequest) return;
      if (!Array.isArray(rows)) throw new Error('The schedule response was invalid.');

      scheduleIntervals = scheduleIntervalsFromRows(rows);
      scheduleReady = true;
      scheduleLoading = false;
      const reasons = [...new Set(rows.map((row) => String(row.reason || '').trim()).filter(Boolean))];
      if (!scheduleIntervals.length) {
        if (rows.length && rows.every((row) => row.is_closed_all_day === true)) {
          scheduleMessage.textContent = `The gym is closed all day${reasons.length ? `: ${reasons.join('; ')}` : ''}.`;
        } else if (!rows.length) {
          scheduleMessage.textContent = 'No operating hours are configured for this date.';
        } else {
          scheduleMessage.textContent = 'The schedule for this date is unavailable.';
        }
      } else if (reasons.length) {
        scheduleMessage.textContent = `Schedule exception: ${reasons.join('; ')}. Available start times are shown below.`;
      } else {
        scheduleMessage.textContent = `Gym hours: ${scheduleIntervals.map((interval) => `${formatScheduleTime(interval.start)}–${formatScheduleTime(interval.end)}`).join(', ')}.`;
      }
      updateAvailableTimes();
    } catch (error) {
      if (requestId !== scheduleRequest) return;
      scheduleMessage.textContent = error.message || 'Could not load this date’s schedule.';
      scheduleReady = false;
      scheduleLoading = false;
      updateAvailableTimes();
    }
  }

  function makeVisitElement(visit) {
    const item = document.createElement('div');
    item.className = 'visit-item';

    const info = document.createElement('div');
    info.className = 'visit-info';
    const title = document.createElement('b');
    title.textContent = `${timestampDatePart(visit.intended_arrival)} · ${formatTime(visit.intended_arrival)} – ${formatTime(visit.exit_time)} (${visitDuration(visit)} min)`;
    info.append(title);

    const tags = document.createElement('div');
    tags.className = 'visit-tags';
    equipmentColumns
      .filter(([, column]) => visit[column])
      .forEach(([label]) => {
        const tag = document.createElement('span');
        tag.className = 'visit-tag';
        tag.textContent = label;
        tags.append(tag);
      });
    info.append(tags);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'visit-del';
    cancelButton.dataset.id = visit.planned_visit_id;
    cancelButton.setAttribute('aria-label', 'Cancel reservation');
    cancelButton.textContent = 'Cancel';

    item.append(info, cancelButton);
    return item;
  }

  function renderVisits() {
    updateQuota();
    const now = new Date();
    const nowLocal = `${localDateString(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    const upcoming = visits
      .filter((visit) => String(visit.exit_time).replace(' ', 'T') >= nowLocal)
      .sort((a, b) => String(a.intended_arrival).localeCompare(String(b.intended_arrival)));

    list.replaceChildren();
    if (!upcoming.length) {
      const empty = document.createElement('p');
      empty.className = 'mute';
      empty.textContent = 'No upcoming visits scheduled.';
      list.append(empty);
      return;
    }
    upcoming.forEach((visit) => list.append(makeVisitElement(visit)));
  }

  async function readResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
    return payload;
  }

  async function loadVisits() {
    try {
      const payload = await readResponse(await fetch('/plan/visits', { cache: 'no-store' }));
      visits.splice(0, visits.length, ...(Array.isArray(payload.visits) ? payload.visits : []));
      renderVisits();
    } catch (error) {
      showMessage(error.message || 'Could not load your upcoming visits.', true);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');

    if (!scheduleReady || !timeInput.value) {
      showMessage('Choose a start time from the available times for this date.', true);
      return;
    }

    const equipment = Array.from(form.querySelectorAll('input[name="equipment"]:checked'))
      .map((checkbox) => checkbox.value);
    if (!equipment.length) {
      showMessage('Select at least one type of equipment you plan to use.', true);
      return;
    }

    submitButton.disabled = true;
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Saving reservation...';
    try {
      const payload = await readResponse(await fetch('/plan/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateInput.value,
          time: timeInput.value,
          duration: Number(durationInput.value),
          equipment,
        }),
      }));
      visits.push(payload.visit);
      renderVisits();
      form.querySelectorAll('input[name="equipment"]:checked')
        .forEach((checkbox) => { checkbox.checked = false; });
      showMessage('Reservation saved.');
    } catch (error) {
      showMessage(error.message || 'Could not save your reservation.', true);
    } finally {
      submitButton.textContent = originalText;
      updateAvailableTimes();
    }
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('.visit-del');
    if (!button) return;
    button.disabled = true;
    try {
      await readResponse(await fetch(`/plan/visits/${encodeURIComponent(button.dataset.id)}`, {
        method: 'DELETE',
      }));
      const index = visits.findIndex((visit) => String(visit.planned_visit_id) === button.dataset.id);
      if (index >= 0) visits.splice(index, 1);
      renderVisits();
      showMessage('Reservation canceled.');
    } catch (error) {
      button.disabled = false;
      showMessage(error.message || 'Could not cancel the reservation.', true);
    }
  });

  dateInput.addEventListener('change', () => {
    showMessage('');
    updateQuota();
    loadSchedule();
  });

  durationInput.addEventListener('change', updateAvailableTimes);

  setDateBounds();
  loadSchedule();
  loadVisits();
  window.setInterval(() => {
    const previousDate = dateInput.value;
    setDateBounds();
    if (dateInput.value !== previousDate) {
      updateQuota();
      loadSchedule();
    } else {
      updateAvailableTimes();
    }
  }, 60 * 1000);
})();
