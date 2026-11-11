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

## Week capacity snapshots

The server writes 15-minute capacity snapshots into the existing `capacity_logs` table. It uses the admin's entry/exit count for `current_headcount`, derives `capacity_percentage` from the 135-person maximum, and carries forward the latest wait-time values. Sampling runs from 6 AM to 10 PM Mountain time, Monday through Saturday (excluding Tuesday 11 AM–12 PM). A completed hour is averaged only when all four quarter-hour snapshots exist. Future hours use the average hourly values from up to the previous four matching weekdays.

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
