(() => {
  const SUPABASE_URL = "https://buvvmpodmcfcjgzglmsw.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_xMx7SkOGDda30kzYxwrtpA_K6wmmmN6";
  const sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  const $ = (id) => document.getElementById(id);
  const dialog = $("auth-dialog");
  const form = $("auth-form");
  const msg = $("auth-msg");
  let mode = "login";

  function showMsg(text, isError = true) {
    msg.textContent = text;
    msg.className = isError ? "err" : "ok";
  }

  function setMode(newMode) {
    mode = newMode;
    const creating = newMode === "create";
    $("auth-title").textContent = creating ? "Create profile" : "Log in";
    $("auth-submit").textContent = creating ? "Save profile" : "Log in";
    $("auth-toggle").textContent = creating
      ? "Already have a profile? Log in"
      : "New here? Create a profile";
    msg.textContent = "";
    msg.className = "";
  }

  function setLoggedIn(profile) {
    sessionStorage.setItem("profile", JSON.stringify(profile));
    $("auth-user").textContent = `Logged in as ${profile.display_name}`;
    $("auth-btn").textContent = "Log out";
  }

  function logOut() {
    sessionStorage.removeItem("profile");
    $("auth-user").textContent = "";
    $("auth-btn").textContent = "Log in";
  }

  $("auth-toggle").addEventListener("click", () =>
    setMode(mode === "login" ? "create" : "login")
  );

  $("auth-btn").addEventListener("click", () => {
    if (sessionStorage.getItem("profile")) {
      logOut();
      return;
    }
    setMode("login");
    dialog.showModal();
  });

  $("auth-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    form.reset();
    msg.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = $("auth-display-name").value.trim();
    const email = $("auth-email").value.trim();
    const submitButton = $("auth-submit");

    if (!displayName || !email) {
      showMsg("Enter a username and email address.");
      return;
    }

    submitButton.disabled = true;
    try {
      let profile;

      if (mode === "create") {
        const { data, error } = await sb
          .from("profiles")
          .insert({ display_name: displayName, email })
          .select("display_name, email")
          .single();
        if (error) throw error;
        profile = data;
      } else {
        const { data, error } = await sb
          .from("profiles")
          .select("display_name, email")
          .eq("display_name", displayName)
          .eq("email", email)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          throw new Error("No profile matches that username and email.");
        }
        profile = data;
      }

      setLoggedIn(profile);
      dialog.close();
    } catch (error) {
      showMsg(error.message || "The profile could not be saved or found.");
    } finally {
      submitButton.disabled = false;
    }
  });

  if (sessionStorage.getItem("profile")) {
    const profile = JSON.parse(sessionStorage.getItem("profile"));
    setLoggedIn(profile);
  }
})();

// --- PLAN A VISIT LOGIC (Auto-detects login state) ---
(() => {
  const planGate = document.getElementById('plan-gate');
  const planContent = document.getElementById('plan-content');
  const loginTrigger = document.getElementById('plan-login-trigger');
  const authDialog = document.getElementById('auth-dialog');
  const authUserSpan = document.getElementById('auth-user');
  const authBtn = document.getElementById('auth-btn');

  const planForm = document.getElementById('plan-form');
  const dateInput = document.getElementById('plan-date');
  const timeInput = document.getElementById('plan-time');
  const durationInput = document.getElementById('plan-duration');
  const planMsg = document.getElementById('plan-msg');
  const planList = document.getElementById('plan-list');
  const quotaBadge = document.getElementById('daily-quota-badge');

  let currentUser = null;
  let visits = [];

  function toLocalISODate(d) {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  function configureDateBounds() {
    const now = new Date();
    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 7);

    const minStr = toLocalISODate(now);
    const maxStr = toLocalISODate(maxDate);

    dateInput.min = minStr;
    dateInput.max = maxStr;
    if (!dateInput.value || dateInput.value < minStr || dateInput.value > maxStr) {
      dateInput.value = minStr;
    }
  }

  function showMessage(text, isError = false) {
    planMsg.textContent = text;
    planMsg.className = isError ? 'err' : 'ok';
  }

  function getMinutesBookedForDate(dateStr) {
    return visits
      .filter(v => v.date === dateStr)
      .reduce((sum, v) => sum + Number(v.duration), 0);
  }

  function updateQuotaBadge() {
    const selectedDate = dateInput.value;
    if (!selectedDate) return;
    const used = getMinutesBookedForDate(selectedDate);
    quotaBadge.textContent = `${used} / 120 min booked on ${selectedDate}`;
  }

  function formatTimeLabel(time24) {
    const [hStr, mStr] = time24.split(':');
    const h = Number(hStr);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${mStr} ${suffix}`;
  }

  function renderVisits() {
    updateQuotaBadge();

    const now = new Date();
    const upcoming = visits
      .filter(v => new Date(`${v.date}T${v.time}:00`) >= now)
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

    if (upcoming.length === 0) {
      planList.innerHTML = '<p class="mute">No upcoming visits scheduled.</p>';
      return;
    }

    planList.innerHTML = upcoming.map(v => `
      <div class="visit-item">
        <div class="visit-info">
          <b>${v.date} at ${formatTimeLabel(v.time)} (${v.duration} min)</b>
          <div class="visit-tags">
            ${v.equipment.map(eq => `<span class="visit-tag">${eq}</span>`).join('')}
          </div>
        </div>
        <button type="button" class="visit-del" data-id="${v.id}" aria-label="Cancel reservation">Cancel</button>
      </div>
    `).join('');
  }

  function loadVisits() {
    if (!currentUser) {
      visits = [];
      return;
    }
    const key = `byu_gym_visits_${currentUser.id}`;
    try {
      visits = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      visits = [];
    }
    renderVisits();
  }

  function saveVisits() {
    if (!currentUser) return;
    const key = `byu_gym_visits_${currentUser.id}`;
    localStorage.setItem(key, JSON.stringify(visits));
    renderVisits();
  }

  planForm.addEventListener('submit', (e) => {
    e.preventDefault();
    showMessage('');

    if (!currentUser) {
      showMessage('You must be logged in to make a reservation.', true);
      return;
    }

    const dateVal = dateInput.value;
    const timeVal = timeInput.value;
    const durationVal = Number(durationInput.value);
    const checkedEquip = Array.from(
      planForm.querySelectorAll('input[name="equipment"]:checked')
    ).map(cb => cb.value);

    if (!dateVal || !timeVal) {
      showMessage('Please select a valid date and start time.', true);
      return;
    }

    const now = new Date();
    const startDateTime = new Date(`${dateVal}T${timeVal}:00`);
    if (startDateTime < now) {
      showMessage('You cannot book a reservation in the past.', true);
      return;
    }

    const maxDate = new Date(now);
    maxDate.setDate(now.getDate() + 7);
    maxDate.setHours(23, 59, 59, 999);
    if (startDateTime > maxDate) {
      showMessage('Reservations can only be made up to 7 days in advance.', true);
      return;
    }

    const dayOfWeek = startDateTime.getDay();
    if (dayOfWeek === 0) {
      showMessage('The gym is closed all day on Sundays.', true);
      return;
    }
    if (dayOfWeek === 2 && timeVal === '11:00') {
      showMessage('The gym is closed Tuesdays from 11 AM to 12 PM.', true);
      return;
    }

    if (checkedEquip.length === 0) {
      showMessage('Select at least one type of equipment you plan to use.', true);
      return;
    }

    const existingMinutes = getMinutesBookedForDate(dateVal);
    if (existingMinutes + durationVal > 120) {
      const remaining = Math.max(0, 120 - existingMinutes);
      showMessage(
        `Daily limit is 2 hours (120 min). You have ${remaining} min remaining for ${dateVal}.`,
        true
      );
      return;
    }

    visits.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date: dateVal,
      time: timeVal,
      duration: durationVal,
      equipment: checkedEquip
    });

    saveVisits();
    planForm.querySelectorAll('input[name="equipment"]:checked').forEach(cb => (cb.checked = false));
    showMessage('Reservation confirmed!', false);
  });

  planList.addEventListener('click', (e) => {
    const btn = e.target.closest('.visit-del');
    if (!btn) return;
    visits = visits.filter(v => v.id !== btn.dataset.id);
    saveVisits();
    showMessage('Reservation canceled.', false);
  });

  dateInput.addEventListener('change', () => {
    showMessage('');
    updateQuotaBadge();
  });

  loginTrigger.addEventListener('click', () => {
    if (authDialog && typeof authDialog.showModal === 'function') {
      authDialog.showModal();
    } else if (authBtn) {
      authBtn.click();
    }
  });

  function syncPlanAuthState(user) {
    currentUser = user || null;
    configureDateBounds();
    if (currentUser) {
      planGate.hidden = true;
      planContent.hidden = false;
      loadVisits();
    } else {
      planGate.hidden = false;
      planContent.hidden = true;
      visits = [];
    }
  }

  // Automatically check if user is logged in by reading the header UI or localStorage
  function checkExistingAuthUI() {
    const userText = authUserSpan ? authUserSpan.textContent.trim() : '';
    const btnText = authBtn ? authBtn.textContent.trim().toLowerCase() : '';
    const isLoggedIn = userText.length > 0 || btnText === 'log out' || btnText === 'logout';

    if (isLoggedIn) {
      syncPlanAuthState({ id: userText || 'active_user' });
    } else {
      syncPlanAuthState(null);
    }
  }

  // Watch #auth-user and #auth-btn for changes whenever you log in or log out
  const observer = new MutationObserver(checkExistingAuthUI);
  if (authUserSpan) observer.observe(authUserSpan, { childList: true, characterData: true, subtree: true });
  if (authBtn) observer.observe(authBtn, { childList: true, characterData: true, subtree: true });

  window.syncPlanAuthState = syncPlanAuthState;
  configureDateBounds();
  checkExistingAuthUI();
})();