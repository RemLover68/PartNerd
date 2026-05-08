# PartNerd — Guía para Claude Code

## Stack

- **Backend**: Node.js + Express en `backend/`
- **Frontend**: HTML/JS estático en `frontend/public/`
- **Base de datos**: PostgreSQL en Docker (`marcas_db`)
- **ORM/driver**: `pg` (node-postgres) — sin ORM
- **IA**: Anthropic API (`enrichment.js`)

## Setup rápido (dev)

```bash
npm run dev:deploy
```

Requiere Docker Desktop corriendo. Este comando:
1. Levanta el contenedor Docker `partnerd-postgres` (lo crea si no existe)
2. Espera a que PostgreSQL acepte conexiones
3. Crea la base de datos `marcas_db` si no existe
4. Aplica `backend/schema.sql`
5. Genera `backend/.env` automáticamente
6. Lanza el servidor con `nodemon`

Para configurar la `ANTHROPIC_API_KEY` u otros valores personalizados, edita
`backend/.env` después del primer arranque — el script preserva los valores ya
definidos.

## Variables de entorno

Definidas en `backend/.env` (generado por `scripts/setup-db.js`).
El archivo de referencia es `backend/.env.example`.

| Variable           | Por defecto   | Descripción                  |
|--------------------|---------------|------------------------------|
| `DB_HOST`          | `localhost`   | Host de PostgreSQL           |
| `DB_PORT`          | `5432`        | Puerto de PostgreSQL         |
| `DB_NAME`          | `marcas_db`   | Nombre de la base de datos   |
| `DB_USER`          | `postgres`    | Usuario de PostgreSQL        |
| `DB_PASSWORD`      | `postgres`    | Contraseña de PostgreSQL     |
| `PORT`             | `3001`        | Puerto del servidor Express  |
| `ANTHROPIC_API_KEY`| *(vacío)*     | Clave para la API de IA      |

## Directriz global: máximo 2 intentos ante fallos

> **Esta directriz aplica a todas las sesiones y proyectos de Claude Code.**

Cuando Claude detecta un fallo durante la ejecución de una tarea (tests que
no pasan, comandos que fallan, errores de build, etc.):

1. **Primer intento**: intenta corregir el problema.
2. **Segundo intento**: si sigue fallando, intenta una corrección alternativa.
3. **Si falla el segundo intento**: **para inmediatamente** y reporta al usuario:
   - Qué falló exactamente (comando, error, archivo)
   - Qué se intentó en cada intento
   - Qué información necesita el usuario para resolverlo

**No continuar en bucle.** El objetivo es evitar que Claude entre en un loop
de reintentos que consuma contexto, tiempo y créditos sin avanzar. Un fallo
persistente tras 2 intentos es señal de que se necesita intervención humana.
