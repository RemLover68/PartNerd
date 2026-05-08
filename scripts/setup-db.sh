#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$(dirname "$0")/../backend/.env"
EXAMPLE_FILE="$(dirname "$0")/../backend/.env.example"

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo "▶ $*"; }
ok()   { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Run a command up to 2 attempts; stop and report on second failure.
try2() {
  local desc="$1"; shift
  local attempt=1
  while [ $attempt -le 2 ]; do
    if "$@"; then
      return 0
    fi
    echo "  ⚠️  Intento $attempt fallido: $desc"
    attempt=$((attempt + 1))
  done
  fail "Fallo tras 2 intentos: $desc — revisa el error arriba y corrígelo antes de continuar."
}

# ── 1. Start PostgreSQL ───────────────────────────────────────────────────────

log "Verificando PostgreSQL..."

if ! pg_isready -q 2>/dev/null; then
  log "PostgreSQL no está corriendo, intentando iniciarlo..."
  try2 "iniciar PostgreSQL" pg_ctlcluster 16 main start
  # Brief wait for pg to accept connections
  for i in 1 2 3 4 5; do
    pg_isready -q 2>/dev/null && break
    sleep 1
  done
  pg_isready -q 2>/dev/null || fail "PostgreSQL arrancó pero no acepta conexiones — revisa los logs: /var/log/postgresql/"
fi

ok "PostgreSQL listo"

# ── 2. Load existing .env values (if any) ────────────────────────────────────

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-marcas_db}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
PORT="${PORT:-3001}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

# If .env already exists, source it so we preserve user-set values
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -o allexport; source "$ENV_FILE"; set +o allexport
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-marcas_db}"
  DB_USER="${DB_USER:-postgres}"
  DB_PASSWORD="${DB_PASSWORD:-}"
  PORT="${PORT:-3001}"
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
fi

# ── psql wrapper: run as postgres OS user if needed ───────────────────────────

# Peer auth requires the OS user to match the DB user.
# If we are root (or any non-postgres user), delegate via runuser/su.
pgrun() {
  if [ "$(id -un)" = "postgres" ]; then
    psql "$@"
  elif command -v runuser &>/dev/null; then
    runuser -u postgres -- psql "$@"
  else
    su -c "psql $(printf '%q ' "$@")" postgres
  fi
}

# ── 3. Create DB if it doesn't exist ─────────────────────────────────────────

log "Verificando base de datos '$DB_NAME'..."

DB_EXISTS=$(pgrun -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")

if [ "$DB_EXISTS" != "1" ]; then
  log "Creando base de datos '$DB_NAME'..."
  try2 "crear base de datos" pgrun -c "CREATE DATABASE $DB_NAME;"
  ok "Base de datos '$DB_NAME' creada"
else
  ok "Base de datos '$DB_NAME' ya existe"
fi

# ── 4. Apply schema ───────────────────────────────────────────────────────────

SCHEMA_FILE="$(dirname "$0")/../backend/schema.sql"
log "Aplicando schema..."
try2 "aplicar schema" pgrun -d "$DB_NAME" -f "$SCHEMA_FILE"
ok "Schema aplicado"

# ── 5. Write .env ─────────────────────────────────────────────────────────────

log "Generando backend/.env..."

cat > "$ENV_FILE" <<EOF
# PostgreSQL connection — generado por setup-db.sh
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Server
PORT=$PORT

# Anthropic API (para enriquecimiento con IA)
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
EOF

ok "backend/.env listo"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup completado — arrancando dev server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
