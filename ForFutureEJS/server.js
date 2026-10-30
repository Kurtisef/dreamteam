const express = require('express');
const knexFactory = require('knex');
const path = require('path');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Knex uses the PostgreSQL driver when DATABASE_URL is configured.
// The server can still render the EJS pages before a database is connected.
const db = process.env.DATABASE_URL
  ? knexFactory({
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 0, max: 10 },
    })
  : null;

app.locals.db = db;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// The stylesheet stays at the project root, one level above this server file.
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'styles.css'));
});

// Authentication is not wired yet. Until it is, render each view as a visitor.
function renderPage(view) {
  return (req, res) => res.render(view, { user: null });
}

app.get('/', renderPage('home'));
app.get('/home', renderPage('home'));
app.get('/live', renderPage('live'));
app.get('/week', renderPage('week'));
app.get('/plan', renderPage('plan'));

app.use((req, res) => {
  res.status(404).send('Page not found.');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong while rendering the page.');
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`BYU Gym Planner server listening on http://localhost:${port}`);
    if (!db) {
      console.log('DATABASE_URL is not set; database features are not connected.');
    }
  });
}

module.exports = { app, db };
