(() => {
  const form = document.getElementById('plan-form');
  if (!form) return;

  const dateInput = document.getElementById('plan-date');
  const timeInput = document.getElementById('plan-time');
  const durationInput = document.getElementById('plan-duration');
  const message = document.getElementById('plan-msg');
  const list = document.getElementById('plan-list');
  const quotaBadge = document.getElementById('daily-quota-badge');
  const submitButton = document.getElementById('plan-submit');
  const visits = [];
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
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 7);
    dateInput.min = localDateString(now);
    dateInput.max = localDateString(maxDate);
    if (!dateInput.value || dateInput.value < dateInput.min || dateInput.value > dateInput.max) {
      dateInput.value = dateInput.min;
    }
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
      submitButton.disabled = false;
      submitButton.textContent = originalText;
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
  });

  setDateBounds();
  loadVisits();
})();
