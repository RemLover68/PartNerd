# MARCAS / CONTACTOS APP

Sistema para importar, gestionar y enriquecer registros de marcas/contactos desde archivos `.txt`.

---

## Stack

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: HTML/CSS/JS puro (sin framework), servido por Express
- **Enriquecimiento**: Scraping con Cheerio + IA con Anthropic Claude

---

## Requisitos previos

- Node.js >= 18
- PostgreSQL >= 14 corriendo localmente
- Cuenta en Anthropic (para enriquecimiento IA)

---

## Instalación

### 1. Instalar dependencias del backend

```bash
cd backend
npm install
```

### 2. Instalar dependencias del frontend (opcional, solo si quieres live-reload)

```bash
cd frontend
npm install
```

---

## Configuración

### 3. Crear base de datos PostgreSQL

```sql
-- Conectado a psql como superusuario:
CREATE DATABASE marcas_db;
```

### 4. Configurar variables de entorno

```bash
cd backend
cp .env.example .env
# Editar .env con tus datos
```

Contenido del `.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=marcas_db
DB_USER=postgres
DB_PASSWORD=tu_contraseña

PORT=3001

ANTHROPIC_API_KEY=sk-ant-...
```

La API key de Anthropic es necesaria para la función de **enriquecimiento con IA**.
Puedes obtenerla en: https://console.anthropic.com/

---

## Ejecutar

```bash
cd backend
npm start
```

El servidor corre en `http://localhost:3001` y sirve también el frontend.

**Para desarrollo con recarga automática:**
```bash
cd backend
npm run dev
```

---

## Formato del archivo .txt

Bloques separados por líneas en blanco:

```
MARCA : BOSCH / IQSIGHT
CONTACTO : CRISTOBAL CRUCES
CORREO : xxxxx@keenfinity.com
TELEFONO : +5698584574
URL : https://www.iqsight.com/en/
LINEAS DE PRODUCTOS : CAMARAS Y SISTEMAS VMS

MARCA : OTRA MARCA
CONTACTO : OTRO CONTACTO
CORREO : otro@email.com
TELEFONO : +56912345678
URL : https://ejemplo.com
LINEAS DE PRODUCTOS : SOFTWARE, HARDWARE
```

---

## Funcionalidades

| Función | Descripción |
|---------|-------------|
| 📤 Importar .txt | Parsea bloques y guarda en PostgreSQL |
| 🔍 Buscar | Filtra por marca, contacto o correo |
| ✕ Eliminar líneas | Borra las líneas de producto originales de uno o varios registros |
| ✦ Enriquecer | Hace scraping de la URL y usa IA para obtener descripción detallada y nuevas líneas de producto |
| ☐ Selección múltiple | Acciones masivas sobre múltiples registros |
| ⌫ Eliminar registro | Borra el registro completo de la base de datos |

---

## API Endpoints

```
GET    /api/health                    Health check
POST   /api/upload                    Subir y parsear archivo .txt
GET    /api/marcas?q=búsqueda         Listar todos los registros
GET    /api/marcas/:id                Obtener un registro
DELETE /api/marcas/:id/lineas         Eliminar líneas de producto
DELETE /api/marcas/lineas/bulk        Eliminar líneas de múltiples registros (body: {ids})
POST   /api/marcas/:id/enrich         Enriquecer con scraping + IA
POST   /api/marcas/enrich/bulk        Enriquecer múltiples (async, body: {ids})
DELETE /api/marcas/:id                Eliminar registro completo
GET    /api/stats                     Estadísticas generales
```

---

## Estructura del proyecto

```
marca-app/
├── backend/
│   ├── server.js          # Servidor Express + rutas API
│   ├── db.js              # Conexión y auto-init de PostgreSQL
│   ├── parser.js          # Parseo del formato .txt
│   ├── enrichment.js      # Scraping (Cheerio) + IA (Anthropic)
│   ├── schema.sql         # Schema SQL (referencia)
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── public/
│   │   └── index.html     # App frontend (HTML/CSS/JS)
│   └── package.json
├── package.json
└── README.md
```
