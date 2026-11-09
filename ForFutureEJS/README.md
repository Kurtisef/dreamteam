# ForFutureEJS

This folder contains the Express/EJS version of the BYU Gym Planner site. It is kept separate from the GitHub Pages version in the project root, so changes here do not replace the current static site.

## Requirements

- Node.js 20.6 or newer
- npm

Node 20.6 or newer is needed because the start script uses Node's `--env-file` option.

## Install and run

From a terminal, move into this folder, install the dependencies, and start the server:

```sh
cd ForFutureEJS
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in a browser. The server uses port `3000` by default and honors the `PORT` environment variable if one is provided.

## Supabase profile connection

The server uses Supabase's Data API to read and create rows in the `profiles` table. It does not connect directly to PostgreSQL. Configure these values in a private `.env` file in this folder:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_api_key
GYM_MAX_CAPACITY=135
GYM_TIME_ZONE=America/Denver
```

Copy the project URL and publishable key from the Supabase dashboard. The admin login reads `email` and `desk_password` from `desk_staff` using the service-role key on the server. Keep that key private in `.env`; never put it in browser JavaScript or commit `.env`. The repository's `.gitignore` excludes `.env`.

The `profiles` table must allow the required `select` and `insert` operations through Supabase's Data API and its Row Level Security policies. The application sends the display name and email to Supabase when creating a profile, and looks for an exact match when logging in.

Starting the EJS server also starts the root `capacityAgent.js` process in the same Node process. It writes estimates to `capacity_logs` immediately and every 15 minutes. The agent uses `SUPABASE_SERVICE_ROLE_KEY` for database reads and writes, `GEMINI_API_KEY` for estimates, `GEMINI_MODEL` (default `gemini-3.5-flash`) for generation, and `GYM_MAX_CAPACITY` (default `135`) when calculating fullness. The Home page shows a schedule-based closed state when the operating-hours data says the gym is closed, and an unavailable state if capacity/schedule data is missing, invalid, stale (older than 30 minutes), or cannot be loaded. Outside wait is estimated only from wait samples during the latest uninterrupted period at maximum capacity, and the Home page always displays the outside-wait field (typically `0 min` when the gym is below capacity). Equipment wait is calculated by the agent: it is zero below 50% occupancy, rises from 0 to about 2.5 minutes between 50% and 65%, then to about 8.5 minutes at full capacity, with up to 1.5 additional minutes based on active planned visits' equipment selections. The Home page displays this value even when it is zero. The “Rest of today” graph averages `capacity_percentage` values from `capacity_logs` by gym-local hour: past/current hours use today's records, while future hours use the previous 12 months of records for that weekday. It refreshes every minute; hours without records for the relevant source are marked “N/A.” Run `node capacityAgent.js --once` from the repository root to execute one update without starting the scheduler. Planned-visit timestamps are stored without a timezone, so `GYM_TIME_ZONE` (default `America/Denver`) must match the gym's local timezone. The Home page reads the latest capacity log through the server and refreshes it once per minute. The operating-hours endpoint applies matching `schedule_exceptions` to each day's schedule, and the admin Close Gym action clears traffic events and writes a zero-capacity baseline for the next agent run.

### Atomic planned-visit reservations

Before the server can save planned visits with the atomic overlap and daily-limit checks, apply [`migrations/20261109_atomic_planned_visit_reservation.sql`](migrations/20261109_atomic_planned_visit_reservation.sql) once in the Supabase SQL Editor. It creates an RPC function that serializes reservation attempts for the same profile and date, checks for overlapping visits and the 120-minute daily limit, and inserts the visit in the same transaction. The function is executable only by Supabase's `service_role`, which the server uses for planned-visit operations.

## Profile login behavior

This version intentionally uses the simple profile lookup from the HTML site, not Supabase Auth. A profile consists of a display name and email; there is no password or email ownership check. After a match, Express stores the profile in a temporary in-memory session and sends the browser an HttpOnly session cookie. Sessions are cleared when the Node server restarts.

Admin login uses the email and password entered in the separate admin dialog to check a matching `email` and `desk_password` row in `desk_staff`. The server creates an admin session only after both values match. The `desk_password` column is currently compared as stored, so it should contain a securely hashed password before this is used beyond a prototype.

Home and Week are public. Live and Plan show their sign-in gates to visitors. A profile whose database `role` is `admin` sees the admin-specific Plan message. The session comes from a profile lookup, so this is a prototype flow and must not be treated as verified identity for sensitive information.

## Pages and files

Express renders these EJS templates from `views/`:

- `/` and `/home` — Home
- `/live` — Camera feed
- `/week` — Week view
- `/plan` — Plan visit
- `views/partials/auth-dialog.ejs` — Shared login/create-profile dialog
- `public/auth.js` — Dialog, login, and logout controls
- `server.js` — Express routes, Supabase Data API calls, and temporary profile sessions
