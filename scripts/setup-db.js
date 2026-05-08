#!/usr/bin/env node
/**
 * Cross-platform DB setup using Docker.
 * - Starts the postgres container if it isn't running
 * - Creates the database if it doesn't exist
 * - Applies schema.sql
 * - Writes backend/.env
 */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const ENV_FILE      = path.join(ROOT, 'backend', '.env');
const SCHEMA_FILE   = path.join(ROOT, 'backend', 'schema.sql');
const CONTAINER     = 'partnerd-postgres';
const PG_IMAGE      = 'postgres:16';

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

// ── Load / default .env values ────────────────────────────────────────────────

let env = {
  DB_HOST:          'localhost',
  DB_PORT:          '5432',
  DB_NAME:          'marcas_db',
  DB_USER:          'postgres',
  DB_PASSWORD:      'postgres',
  PORT:             '3001',
  ANTHROPIC_API_KEY: '',
};

if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[2] !== '') env[m[1]] = m[2];
  }
}

// ── 1. Check Docker is available ──────────────────────────────────────────────

log('Verificando Docker...');
if (run('docker info -f "{{.ServerVersion}}"').status !== 0) {
  fail(
    'Docker no está disponible o no está corriendo.\n' +
    '  Inicia Docker Desktop y vuelve a ejecutar npm run dev:deploy.'
  );
}
ok('Docker listo');

// ── 2. Start the postgres container ──────────────────────────────────────────

log(`Verificando contenedor '${CONTAINER}'...`);

const containerState = run(`docker inspect -f "{{.State.Status}}" ${CONTAINER} 2>/dev/null`);

if (containerState.status !== 0) {
  // Container doesn't exist — create it
  log(`Creando contenedor '${CONTAINER}'...`);
  const r = run(
    `docker run -d --name ${CONTAINER} ` +
    `  -e POSTGRES_USER=${env.DB_USER} ` +
    `  -e POSTGRES_PASSWORD=${env.DB_PASSWORD} ` +
    `  -e POSTGRES_DB=${env.DB_NAME} ` +
    `  -p ${env.DB_PORT}:5432 ` +
    `  ${PG_IMAGE}`,
    { stdio: 'inherit' }
  );
  if (r.status !== 0) fail(`No se pudo crear el contenedor. Revisa Docker y vuelve a intentarlo.`);
  ok(`Contenedor '${CONTAINER}' creado`);
} else {
  const state = containerState.stdout.toString().trim();
  if (state !== 'running') {
    log(`Iniciando contenedor '${CONTAINER}' (estaba ${state})...`);
    const r = run(`docker start ${CONTAINER}`, { stdio: 'inherit' });
    if (r.status !== 0) fail(`No se pudo iniciar el contenedor '${CONTAINER}'.`);
  }
  ok(`Contenedor '${CONTAINER}' corriendo`);
}

// ── 3. Wait for PostgreSQL to accept connections ──────────────────────────────

log('Esperando a que PostgreSQL esté listo...');
let ready = false;
for (let i = 0; i < 20; i++) {
  const r = run(`docker exec ${CONTAINER} pg_isready -U ${env.DB_USER} -q`);
  if (r.status === 0) { ready = true; break; }
  sleep(1000);
}
if (!ready) fail('PostgreSQL no respondió tras 20 s. Revisa los logs con: docker logs ' + CONTAINER);
ok('PostgreSQL listo');

// ── 4. Create database if it doesn't exist ────────────────────────────────────

log(`Verificando base de datos '${env.DB_NAME}'...`);

function pgExec(sql, db) {
  const dbFlag = db ? `-d ${db}` : '';
  return run(`docker exec ${CONTAINER} psql -U ${env.DB_USER} ${dbFlag} -tAc "${sql}"`);
}

const dbCheck  = pgExec(`SELECT 1 FROM pg_database WHERE datname='${env.DB_NAME}'`);
const dbExists = dbCheck.status === 0 && dbCheck.stdout.toString().trim() === '1';

if (!dbExists) {
  log(`Creando base de datos '${env.DB_NAME}'...`);
  const r = pgExec(`CREATE DATABASE ${env.DB_NAME}`);
  if (r.status !== 0) {
    fail(
      `No se pudo crear la base de datos.\n` +
      `  ${r.stderr.toString().trim() || r.stdout.toString().trim()}`
    );
  }
  ok(`Base de datos '${env.DB_NAME}' creada`);
} else {
  ok(`Base de datos '${env.DB_NAME}' ya existe`);
}

// ── 5. Apply schema ───────────────────────────────────────────────────────────

log('Aplicando schema...');

// Copy schema into container and execute it
const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8')
  .replace(/"/g, '\\"')  // escape for shell
  .replace(/\n/g, ' ');  // single line for docker exec

const schemaResult = run(
  `docker exec ${CONTAINER} psql -U ${env.DB_USER} -d ${env.DB_NAME} -c "${schemaSql}"`,
  { stdio: 'inherit' }
);
if (schemaResult.status !== 0) fail('Error aplicando schema.sql. Revisa el output arriba.');
ok('Schema aplicado');

// ── 6. Write .env ─────────────────────────────────────────────────────────────

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
