(() => {
  const SUPABASE_URL = "https://buvvmpodmcfcjgzglmsw.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_xMx7SkOGDda30kzYxwrtpA_K6wmmmN6";
  const sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
  window.sb = sb;

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
    
    // --> ADD THIS LINE HERE <--
    if (typeof window.syncPlanAuthState === 'function') window.syncPlanAuthState();
  }

  function logOut() {
    sessionStorage.removeItem("profile");
    $("auth-user").textContent = "";
    $("auth-btn").textContent = "Log out";
    
    // --> AND ADD THIS LINE HERE <--
    if (typeof window.syncPlanAuthState === 'function') window.syncPlanAuthState();
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

// --- PLAN A VISIT LOGIC (Direct sessionStorage profile integration) ---
(() => {
  const getSupabaseClient = () => {
    if (typeof sb !== 'undefined') return sb;
    if (typeof supabaseClient !== 'undefined') return supabaseClient;
    if (typeof db !== 'undefined') return db;
    if (typeof client !== 'undefined') return client;
    if (typeof window !== 'undefined' && window.sb) return window.sb;
    if (typeof window !== 'undefined' && window.supabaseClient) return window.supabaseClient;
    if (typeof supabase !== 'undefined' && typeof supabase.from === 'function') return supabase;
    return null;
  };

  const planGate = document.getElementById('plan-gate');
  const planContent = document.getElementById('plan-content');
  const loginTrigger = document.getElementById('plan-login-trigger');
  const authDialog = document.getElementById('auth-dialog');
  const authBtn = document.getElementById('auth-btn');

  const planForm = document.getElementById('plan-form');
  const dateInput = document.getElementById('plan-date');
  const timeInput = document.getElementById('plan-time');
  const durationInput = document.getElementById('plan-duration');
  const planMsg = document.getElementById('plan-msg');
  const planList = document.getElementById('plan-list');
  const quotaBadge = document.getElementById('daily-quota-badge');
  const submitBtn = document.getElementById('plan-submit');

  let currentProfileId = null;
  let visits = [];

  const EQUIP_MAP = [
    { label: 'Racks', col: 'racks' },
    { label: 'Dumbbells', col: 'dumbbells' },
    { label: 'Cable stacks', col: 'cable_stacks' },
    { label: 'Weight machines', col: 'weight_machines' },
    { label: 'Cardio machines', col: 'cardio_machines' }
  ];

  function toLocalISODate(d) {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  function toLocalTimestampString(d) {
    const datePart = toLocalISODate(d);
    const hr = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    const sc = String(d.getSeconds()).padStart(2, '0');
    return `${datePart}T${hr}:${mn}:${sc}`;
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

  function getVisitDurationMinutes(row) {
    const start = new Date(row.intended_arrival);
    const end = new Date(row.exit_time);
    return Math.round((end - start) / 60000);
  }

  function getVisitDateStr(row) {
    return toLocalISODate(new Date(row.intended_arrival));
  }

  function getMinutesBookedForDate(dateStr) {
    return visits
      .filter(v => getVisitDateStr(v) === dateStr)
      .reduce((sum, v) => sum + getVisitDurationMinutes(v), 0);
  }

  function updateQuotaBadge() {
    const selectedDate = dateInput.value;
    if (!selectedDate) return;
    const used = getMinutesBookedForDate(selectedDate);
    quotaBadge.textContent = `${used} / 120 min booked on ${selectedDate}`;
  }

  function formatTimeRange(startIso, endIso) {
    const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${fmt(new Date(startIso))} – ${fmt(new Date(endIso))}`;
  }

  function renderVisits() {
    updateQuotaBadge();

    const now = new Date();
    const upcoming = visits
      .filter(v => new Date(v.exit_time) >= now)
      .sort((a, b) => new Date(a.intended_arrival) - new Date(b.intended_arrival));

    if (upcoming.length === 0) {
      planList.innerHTML = '<p class="mute">No upcoming visits scheduled.</p>';
      return;
    }

    planList.innerHTML = upcoming.map(v => {
      const dateStr = getVisitDateStr(v);
      const mins = getVisitDurationMinutes(v);
      const activeTags = EQUIP_MAP.filter(eq => v[eq.col]).map(eq => eq.label);

      return `
        <div class="visit-item">
          <div class="visit-info">
            <b>${dateStr} · ${formatTimeRange(v.intended_arrival, v.exit_time)} (${mins} min)</b>
            <div class="visit-tags">
              ${activeTags.map(label => `<span class="visit-tag">${label}</span>`).join('')}
            </div>
          </div>
          <button type="button" class="visit-del" data-id="${v.planned_visit_id}" aria-label="Cancel reservation">Cancel</button>
        </div>
      `;
    }).join('');
  }

  async function resolveProfileId(displayName, email) {
    const client = getSupabaseClient();
    if (!client) return null;

    const { data } = await client
      .from('profiles')
      .select('*')
      .eq('display_name', displayName)
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (data) {
      return data.profile_id || data.id;
    }
    return null;
  }

  async function loadVisits() {
    const client = getSupabaseClient();
    if (!client || !currentProfileId) {
      visits = [];
      renderVisits();
      return;
    }

    const { data, error } = await client
      .from('planned_visits')
      .select('*')
      .eq('profile_id', currentProfileId)
      .order('intended_arrival', { ascending: true });

    if (error) {
      console.error('Error loading planned_visits:', error);
      return;
    }

    visits = data || [];
    renderVisits();
  }

  planForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage('');

    const client = getSupabaseClient();
    if (!client) {
      showMessage('Supabase client not found in app.js.', true);
      return;
    }

    if (!currentProfileId) {
      showMessage('You must be logged in to make a reservation.', true);
      return;
    }

    const dateVal = dateInput.value;
    const timeVal = timeInput.value;
    const durationVal = Number(durationInput.value);
    const checkedValues = Array.from(
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

    if (timeVal === '21:00' && durationVal > 60) {
      showMessage('Reservations starting at 9:00 PM are capped at 1 hour (gym closes at 10 PM).', true);
      return;
    }

    const endDateTime = new Date(startDateTime.getTime() + durationVal * 60000);

    let cursor = new Date(startDateTime);
    while (cursor < endDateTime) {
      const dayOfWeek = cursor.getDay();
      const hour = cursor.getHours();

      if (dayOfWeek === 0) {
        showMessage('The gym is closed all day on Sundays.', true);
        return;
      }
      if (dayOfWeek === 2 && hour === 11) {
        showMessage('Your reservation overlaps with the Tuesday 11 AM to 12 PM devotional closure.', true);
        return;
      }
      if (hour >= 22 || (hour < 6 && hour >= 0)) {
        showMessage('The gym is closed during this time window (Open 6 AM – 10 PM).', true);
        return;
      }
      cursor.setMinutes(cursor.getMinutes() + 15);
    }

    if (checkedValues.length === 0) {
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

    const insertPayload = {
      profile_id: currentProfileId,
      intended_arrival: toLocalTimestampString(startDateTime),
      exit_time: toLocalTimestampString(endDateTime),
      racks: checkedValues.includes('Racks'),
      dumbbells: checkedValues.includes('Dumbbells'),
      cable_stacks: checkedValues.includes('Cable stacks'),
      weight_machines: checkedValues.includes('Weight machines'),
      cardio_machines: checkedValues.includes('Cardio machines')
    };

    submitBtn.disabled = true;
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = "Saving reservation..."; // <-- Line 1 (Set loading text)

    const { data, error } = await client
      .from('planned_visits')
      .insert([insertPayload])
      .select()
      .single();

    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText; // <-- Line 2 (Reset button text)

    if (error) {
      console.error('Supabase insert error:', error);
      showMessage(`Database error: ${error.message}`, true);
      return;
    }

    visits.push(data);
    renderVisits();
    planForm.querySelectorAll('input[name="equipment"]:checked').forEach(cb => (cb.checked = false));
    showMessage('Reservation saved!', false);
  });

  planList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.visit-del');
    if (!btn) return;

    const client = getSupabaseClient();
    const visitId = btn.dataset.id;

    const { error } = await client
      .from('planned_visits')
      .delete()
      .eq('planned_visit_id', visitId);

    if (error) {
      console.error('Supabase delete error:', error);
      showMessage(`Could not cancel: ${error.message}`, true);
      return;
    }

    visits = visits.filter(v => String(v.planned_visit_id) !== String(visitId));
    renderVisits();
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

  // Direct check against sessionStorage profile object
  async function checkAuth() {
    const rawProfile = sessionStorage.getItem("profile");
    if (rawProfile) {
      try {
        const profile = JSON.parse(rawProfile);
        if (profile && profile.display_name && profile.email) {
          currentProfileId = await resolveProfileId(profile.display_name, profile.email);
          if (currentProfileId) {
            planGate.hidden = true;
            planContent.hidden = false;
            await loadVisits();
            return;
          }
        }
      } catch (err) {
        console.error("Auth check error:", err);
      }
    }

    currentProfileId = null;
    visits = [];
    planGate.hidden = false;
    planContent.hidden = true;
  }

  window.syncPlanAuthState = checkAuth;

  configureDateBounds();
  checkAuth();
})();