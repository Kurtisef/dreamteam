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
