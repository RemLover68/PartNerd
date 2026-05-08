const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'marcas_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

pool.on('connect', () => {
  console.log('✅ Conectado a PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Error en pool de PostgreSQL:', err);
});

// Auto-crear tabla si no existe
async function initDB() {
  const createTable = `
    CREATE TABLE IF NOT EXISTS marcas (
      id SERIAL PRIMARY KEY,
      marca VARCHAR(500),
      contacto VARCHAR(255),
      correo VARCHAR(255),
      telefono VARCHAR(100),
      url VARCHAR(500),
      lineas_producto TEXT,
      descripcion_enriquecida TEXT,
      lineas_enriquecidas TEXT,
      estado VARCHAR(50) DEFAULT 'pendiente',
      creado_en TIMESTAMP DEFAULT NOW(),
      actualizado_en TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_marcas_correo ON marcas(correo);
    CREATE INDEX IF NOT EXISTS idx_marcas_marca ON marcas(marca);
  `;
  try {
    await pool.query(createTable);
    console.log('✅ Tabla marcas lista');
  } catch (err) {
    console.error('❌ Error inicializando DB:', err.message);
  }
}

module.exports = { pool, initDB };
