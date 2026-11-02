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

## Supabase PostgreSQL connection

The server uses Knex and `pg` to connect directly to PostgreSQL when `DATABASE_URL` is set. Create a file named `.env` in this folder with this setting:

```env
DATABASE_URL=postgresql://...
```

Copy the PostgreSQL connection string from the Supabase dashboard's **Connect** panel. For a local network that cannot reach Supabase's direct IPv6 endpoint, use the **Session pooler** connection string. Replace its password placeholder with the database password; percent-encode reserved characters in the password if needed.

Keep `.env` private. The repository's `.gitignore` excludes it from Git. Do not put the database password in an EJS template or browser-side JavaScript. The Supabase project URL and publishable API key are not used for this Knex/PostgreSQL connection.

When a database URL is present, the server runs a small `select 1` query at startup and logs whether it connected. If the URL is missing, the pages still render, but database features are not connected.

## Pages and current status

Express renders these EJS templates from `views/`:

- `/` and `/home` — Home
- `/live` — Camera feed
- `/week` — Week view
- `/plan` — Plan visit

The shared stylesheet is served from the project root. Authentication and page-specific database queries are not wired into this Node version yet; it currently renders each page as a visitor and only checks the database connection at startup.

## Main files

- `server.js` — Express routes, EJS setup, and optional Knex connection
- `views/` — EJS page templates
- `package.json` — Dependencies and the `npm start` script
