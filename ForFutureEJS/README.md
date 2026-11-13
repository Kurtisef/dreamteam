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

You can also run `node server.js` directly. The server loads `.env` from this folder in either case.

Then open [http://localhost:3000](http://localhost:3000) in a browser. The server uses port `3000` by default and honors the `PORT` environment variable if one is provided.

## Supabase profile connection

The server uses Supabase's Data API to read and create rows in the `profiles` table. It does not connect directly to PostgreSQL. Configure these values in a private `.env` file in this folder:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_api_key
GYM_MAX_CAPACITY=135
GYM_TIME_ZONE=America/Denver
```

Copy the project URL and service-role key from the Supabase dashboard. The server uses this key for database access, including profile authentication and admin login. Keep it private in `.env`; never put it in browser JavaScript or commit `.env`. The repository's `.gitignore` excludes `.env`.

Before using profile login, apply [`migrations/20261111_profile_password_and_unique_email.sql`](migrations/20261111_profile_password_and_unique_email.sql) in the Supabase SQL Editor. It adds `profile_password`, normalizes existing email addresses, and enforces case-insensitive email uniqueness. If the migration reports duplicate emails, resolve those rows before applying it again.

To store reservation attendance results and profile metrics, apply [`migrations/20261113_profile_reservation_metrics.sql`](migrations/20261113_profile_reservation_metrics.sql) once in the Supabase SQL Editor. It adds answer fields to planned visits and creates one row per profile with answered and kept reservation counters. The metrics table has row-level security enabled and grants access to the server's `service_role`.

Then apply [`migrations/20261113_add_reservations_total_metric.sql`](migrations/20261113_add_reservations_total_metric.sql) to add `reservations_total`. Apply [`migrations/20261113_expire_planned_visits_update_metrics.sql`](migrations/20261113_expire_planned_visits_update_metrics.sql) to create the atomic cleanup function, then [`migrations/20261113_update_expiration_attendance_metrics.sql`](migrations/20261113_update_expiration_attendance_metrics.sql) to also roll answered/kept outcomes into the profile counters when weekly cleanup deletes reservations. The GitHub Actions job deletes reservations and increments all three counters in the same transaction; user cancellations do not increment them.

Finally, apply [`migrations/20261113_initialize_profile_reservation_metrics.sql`](migrations/20261113_initialize_profile_reservation_metrics.sql). It creates zeroed metrics rows for existing profiles and installs a database trigger so new profiles get a metrics row automatically. It preserves any metrics row that already exists.

The Plan page saves attendance responses through an authenticated server route that updates `planned_visits.did_attend` and `attendance_responded_at`. Users may change an answer until the reservation expires; the weekly cleanup then counts its final answer in the profile metrics.

Profile creation and login use the server-only service-role key. New profiles use the part of the email before `@` as `display_name`; passwords are salted and hashed with scrypt before being written to `profile_password`. Existing profiles without a password can use “Create profile” once to set one. Profile emails are not verified, so this prototype does not prove ownership of an email address. Keep the service-role key private and never expose password hashes to browser code.

Starting the EJS server also starts `capacityAgent.js` in the same Node process. It attempts an estimate immediately and every five minutes, writing results to `capacity_logs`. If Gemini is unavailable or rate-limited, the agent logs the failure and saves a deterministic estimate from the latest snapshot and available traffic events instead. The agent uses `SUPABASE_SERVICE_ROLE_KEY` for database reads and writes, `GEMINI_API_KEY` for estimates, `GEMINI_MODEL` (default `gemini-3.5-flash`) for generation, and `GYM_MAX_CAPACITY` (default `135`) when calculating fullness. The Home page shows a schedule-based closed state when the operating-hours data says the gym is closed, and an unavailable state if capacity/schedule data is missing, invalid, stale (older than 30 minutes), or cannot be loaded. Outside wait is estimated only from wait samples during the latest uninterrupted period at maximum capacity, and the Home page always displays the outside-wait field (typically `0 min` when the gym is below capacity). Equipment wait is calculated by the agent: it is zero below 50% occupancy, rises from 0 to about 2.5 minutes between 50% and 65%, then to about 8.5 minutes at full capacity, with up to 1.5 additional minutes based on active planned visits' equipment selections. The Home page displays this value even when it is zero. The “Rest of today” graph averages `capacity_percentage` values from `capacity_logs` by gym-local hour: past/current hours use today's records, while future hours use the previous 12 months of records for that weekday. It refreshes every minute; hours without records for the relevant source are marked “N/A.” Run `node capacityAgent.js --once` from this folder to execute one update without starting the scheduler. Planned-visit timestamps are stored without a timezone, so `GYM_TIME_ZONE` (default `America/Denver`) must match the gym's local timezone. The Home page reads the latest capacity log through the server and refreshes it once per minute. The operating-hours endpoint applies matching `schedule_exceptions` to each day's schedule, and the admin Close Gym action clears traffic events and writes a zero-capacity baseline for the next agent run.

The server writes 15-minute capacity snapshots into the existing `capacity_logs` table. It uses the admin's entry/exit count for `current_headcount`, derives `capacity_percentage` from the 135-person maximum, and carries forward the latest wait-time values. Sampling runs from 6 AM to 10 PM Mountain time, Monday through Saturday (excluding Tuesday 11 AM–12 PM). A completed hour is averaged only when all four quarter-hour snapshots exist. Future hours use the average hourly values from up to the previous four matching weekdays.

## Profile login behavior

This version uses profile email and password fields rather than Supabase Auth. After a successful password check, Express stores the profile in a temporary in-memory session and sends the browser an HttpOnly session cookie. Sessions are cleared when the Node server restarts.

Admin login uses the email and password entered in the separate admin dialog to check a matching `email` and `desk_password` row in `desk_staff`. The server creates an admin session only after both values match. The `desk_password` column is currently compared as stored, so it should contain a securely hashed password before this is used beyond a prototype.

Home and Week are public. Live and Plan show their sign-in gates to visitors. A profile whose database `role` is `admin` sees the admin-specific Plan message. The session comes from a profile lookup, so this is a prototype flow and must not be treated as verified identity for sensitive information.

## Pages and files

Express renders these EJS templates from `views/`:

- `/` and `/home` — Home
- `/live` — Camera feed
- `/week` — Week view
- `/plan` — Plan visit
- `views/partials/auth-dialog.ejs` — Shared login/create-profile dialog
- `public/` — Browser scripts and stylesheets served by Express
- `server.js` — Express routes, Supabase Data API calls, and temporary profile sessions
