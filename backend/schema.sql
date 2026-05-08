-- Crear base de datos (ejecutar como superusuario)
-- CREATE DATABASE marcas_db;

-- Tabla principal de marcas/contactos
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

-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_marcas_correo ON marcas(correo);
CREATE INDEX IF NOT EXISTS idx_marcas_marca ON marcas(marca);
CREATE INDEX IF NOT EXISTS idx_marcas_estado ON marcas(estado);
