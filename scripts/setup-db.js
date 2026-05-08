#!/usr/bin/env node
/**
 * Cross-platform DB setup: starts PostgreSQL if needed, creates the database,
 * applies schema.sql, and generates backend/.env.
 */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT        = path.join(__dirname, '..');
const ENV_FILE    = path.join(ROOT, 'backend', '.env');
const SCHEMA_FILE = path.join(ROOT, 'backend', 'schema.sql');
const IS_WINDOWS  = os.platform() === 'win32';

// ── Helpers ───────────────────────────────────────────────────────────────────

const log  = (msg) => console.log(`▶ ${msg}`);
const ok   = (msg) => console.log(`✅ ${msg}`);
const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, stdio: 'pipe', ...opts });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── Load existing .env values (preserved on re-runs) ─────────────────────────

let env = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'marcas_db',
  DB_USER: 'postgres',
  DB_PASSWORD: '',
  PORT: '3001',
  ANTHROPIC_API_KEY: '',
};

if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

// ── psql execution strategy ───────────────────────────────────────────────────
// On Linux/macOS without a DB password, peer auth via Unix socket is used.
// runuser/su lets us connect as the postgres OS user from root.
// On Windows, TCP + PGPASSWORD is the standard path.

function buildPsqlCmd({ sql, file, db }) {
  const dbFlag = db ? `-d "${db}"` : '';
  const cmd    = sql  ? `-tAc "${sql}"` : `-f "${file}"`;

  if (!IS_WINDOWS && !env.DB_PASSWORD) {
    // Unix socket peer auth: delegate to the postgres OS user
    const inner = `psql -U ${env.DB_USER} ${dbFlag} ${cmd}`;
    if (process.getuid && process.getuid() === 0) {
      // Already root — use runuser
      return { cmd: `runuser -u postgres -- ${inner}`, env: process.env };
    }
    // Non-root: try direct connection (will work if current user is postgres)
    return { cmd: inner, env: process.env };
  }

  // Windows or password-protected: TCP connection
  const pwEnv = env.DB_PASSWORD
    ? { ...process.env, PGPASSWORD: env.DB_PASSWORD }
    : process.env;
  return {
    cmd: `psql -h ${env.DB_HOST} -p ${env.DB_PORT} -U ${env.DB_USER} ${dbFlag} ${cmd}`,
    env: pwEnv,
  };
}

function psqlQuery(sql, db) {
  const { cmd, env: e } = buildPsqlCmd({ sql, db });
  return run(cmd, { env: e });
}

function psqlFile(file) {
  const { cmd, env: e } = buildPsqlCmd({ file, db: env.DB_NAME });
  return run(cmd, { env: e, stdio: 'inherit' });
}

// ── 1. Start PostgreSQL if not running ───────────────────────────────────────

log('Verificando PostgreSQL...');

function pgReady() {
  const r = run(`pg_isready -h ${env.DB_HOST} -p ${env.DB_PORT} -q`);
  return r.status === 0;
}

if (!pgReady()) {
  log('PostgreSQL no está corriendo, intentando iniciarlo...');

  if (IS_WINDOWS) {
    const services = [
      'postgresql-x64-17', 'postgresql-x64-16', 'postgresql-x64-15',
      'postgresql-x64-14', 'postgresql-x64-13', 'postgresql',
    ];
    for (const svc of services) {
      if (run(`net start "${svc}" 2>nul`).status === 0) break;
    }
  } else {
    const cmds = [
      'pg_ctlcluster $(pg_lsclusters -h | head -1 | awk \'{print $1, $2}\') start',
      'service postgresql start',
      'brew services start postgresql',
    ];
    for (const cmd of cmds) {
      if (run(cmd).status === 0) break;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (pgReady()) break;
    sleep(1000);
  }

  if (!pgReady()) {
    fail(
      'PostgreSQL no responde.\n' +
      '  • Windows: asegúrate de que el servicio PostgreSQL esté instalado.\n' +
      '  • Linux:   ejecuta manualmente: sudo service postgresql start\n' +
      '  • macOS:   ejecuta: brew services start postgresql'
    );
  }
}

ok('PostgreSQL listo');

// ── 2. Create database if needed ─────────────────────────────────────────────

log(`Verificando base de datos '${env.DB_NAME}'...`);

const dbCheck  = psqlQuery(`SELECT 1 FROM pg_database WHERE datname='${env.DB_NAME}'`);
const dbExists = dbCheck.status === 0 && dbCheck.stdout.toString().trim() === '1';

if (!dbExists) {
  log(`Creando base de datos '${env.DB_NAME}'...`);
  const r = psqlQuery(`CREATE DATABASE ${env.DB_NAME}`);
  if (r.status !== 0) {
    fail(
      `No se pudo crear la base de datos '${env.DB_NAME}'.\n` +
      `  Error: ${r.stderr.toString().trim() || r.stdout.toString().trim()}\n` +
      `  Crea la DB manualmente y vuelve a ejecutar:\n` +
      `    psql -U postgres -c "CREATE DATABASE ${env.DB_NAME};"`
    );
  }
  ok(`Base de datos '${env.DB_NAME}' creada`);
} else {
  ok(`Base de datos '${env.DB_NAME}' ya existe`);
}

// ── 3. Apply schema ───────────────────────────────────────────────────────────

log('Aplicando schema...');
if (psqlFile(SCHEMA_FILE).status !== 0) {
  fail(
    `Error aplicando schema.sql.\n` +
    `  Revisa que el usuario '${env.DB_USER}' tenga permisos en '${env.DB_NAME}'.`
  );
}
ok('Schema aplicado');

// ── 4. Write .env ─────────────────────────────────────────────────────────────

log('Generando backend/.env...');

fs.writeFileSync(ENV_FILE, [
  '# PostgreSQL connection — generado por setup-db.js',
  `DB_HOST=${env.DB_HOST}`,
  `DB_PORT=${env.DB_PORT}`,
  `DB_NAME=${env.DB_NAME}`,
  `DB_USER=${env.DB_USER}`,
  `DB_PASSWORD=${env.DB_PASSWORD}`,
  '',
  '# Server',
  `PORT=${env.PORT}`,
  '',
  '# Anthropic API (para enriquecimiento con IA)',
  `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}`,
  '',
].join('\n'));

ok('backend/.env listo');

// ── Done ──────────────────────────────────────────────────────────────────────

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Setup completado — arrancando dev server');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
