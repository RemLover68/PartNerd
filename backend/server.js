const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { pool, initDB } = require('./db');
const { parseTxtContent } = require('./parser');
const { enrichRecord } = require('./enrichment');

const app = express();
const PORT = process.env.PORT || 3001;

// Multer: almacenamiento en memoria para archivos .txt
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos .txt'));
    }
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// =====================
// RUTAS API
// =====================

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/upload
 * Recibe archivo .txt, parsea e inserta en DB
 */
app.post('/api/upload', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const content = req.file.buffer.toString('utf-8');
    const records = parseTxtContent(content);

    if (records.length === 0) {
      return res.status(400).json({ error: 'No se encontraron registros válidos en el archivo' });
    }

    // Insertar todos los registros en DB
    const insertedIds = [];
    for (const r of records) {
      const result = await pool.query(
        `INSERT INTO marcas (marca, contacto, correo, telefono, url, lineas_producto, estado)
         VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')
         RETURNING id`,
        [r.marca, r.contacto, r.correo, r.telefono, r.url, r.lineas_producto]
      );
      insertedIds.push(result.rows[0].id);
    }

    res.json({
      success: true,
      message: `${records.length} registro(s) importado(s) correctamente`,
      ids: insertedIds,
      count: records.length,
    });
  } catch (err) {
    console.error('Error en /api/upload:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/marcas
 * Lista todos los registros, con filtro opcional por búsqueda
 */
app.get('/api/marcas', async (req, res) => {
  try {
    const { q } = req.query;
    let query = 'SELECT * FROM marcas';
    const params = [];

    if (q) {
      query += ` WHERE marca ILIKE $1 OR contacto ILIKE $1 OR correo ILIKE $1 OR lineas_enriquecidas ILIKE $1`;
      params.push(`%${q}%`);
    }

    query += ' ORDER BY creado_en DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en /api/marcas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/marcas/:id
 * Obtener un registro por ID
 */
app.get('/api/marcas/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM marcas WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/marcas/:id/lineas
 * Eliminar líneas de producto (original) de un registro
 */
app.delete('/api/marcas/:id/lineas', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE marcas SET lineas_producto = NULL, actualizado_en = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    res.json({ success: true, record: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/marcas/lineas/bulk
 * Eliminar líneas de producto de múltiples registros
 */
app.delete('/api/marcas/lineas/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere array de ids' });
    }
    const result = await pool.query(
      `UPDATE marcas SET lineas_producto = NULL, actualizado_en = NOW()
       WHERE id = ANY($1::int[]) RETURNING id`,
      [ids]
    );
    res.json({ success: true, updated: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/marcas/:id/enrich
 * Enriquece un registro con scraping + IA usando su URL
 */
app.post('/api/marcas/:id/enrich', async (req, res) => {
  try {
    // Marcar como procesando
    await pool.query(
      `UPDATE marcas SET estado = 'procesando', actualizado_en = NOW() WHERE id = $1`,
      [req.params.id]
    );

    const record = await pool.query('SELECT * FROM marcas WHERE id = $1', [req.params.id]);
    if (record.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    const r = record.rows[0];
    if (!r.url) {
      await pool.query(`UPDATE marcas SET estado = 'pendiente' WHERE id = $1`, [req.params.id]);
      return res.status(400).json({ error: 'El registro no tiene URL' });
    }

    const enriched = await enrichRecord(r.marca, r.url);

    const updated = await pool.query(
      `UPDATE marcas
       SET descripcion_enriquecida = $1,
           lineas_enriquecidas = $2,
           estado = 'enriquecido',
           actualizado_en = NOW()
       WHERE id = $3
       RETURNING *`,
      [enriched.descripcion, enriched.lineas_enriquecidas, req.params.id]
    );

    res.json({ success: true, record: updated.rows[0] });
  } catch (err) {
    console.error('Error en /api/marcas/:id/enrich:', err);
    // Revertir estado
    await pool.query(
      `UPDATE marcas SET estado = 'error', actualizado_en = NOW() WHERE id = $1`,
      [req.params.id]
    ).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/marcas/enrich/bulk
 * Enriquecer múltiples registros
 */
app.post('/api/marcas/enrich/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere array de ids' });
    }

    // Responder inmediatamente y procesar en background
    res.json({
      success: true,
      message: `Enriquecimiento iniciado para ${ids.length} registro(s)`,
      processing: ids,
    });

    // Procesar en background
    (async () => {
      for (const id of ids) {
        try {
          await pool.query(
            `UPDATE marcas SET estado = 'procesando', actualizado_en = NOW() WHERE id = $1`,
            [id]
          );
          const record = await pool.query('SELECT * FROM marcas WHERE id = $1', [id]);
          if (record.rows.length === 0) continue;
          const r = record.rows[0];
          if (!r.url) continue;

          const enriched = await enrichRecord(r.marca, r.url);
          await pool.query(
            `UPDATE marcas
             SET descripcion_enriquecida = $1,
                 lineas_enriquecidas = $2,
                 estado = 'enriquecido',
                 actualizado_en = NOW()
             WHERE id = $3`,
            [enriched.descripcion, enriched.lineas_enriquecidas, id]
          );
          console.log(`✅ Enriquecido ID ${id}`);
        } catch (err) {
          console.error(`❌ Error enriqueciendo ID ${id}:`, err.message);
          await pool.query(
            `UPDATE marcas SET estado = 'error', actualizado_en = NOW() WHERE id = $1`,
            [id]
          ).catch(() => {});
        }
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/marcas/:id
 * Eliminar un registro completo
 */
app.delete('/api/marcas/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM marcas WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Estadísticas generales
 */
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE estado = 'enriquecido') as enriquecidos,
        COUNT(*) FILTER (WHERE estado = 'pendiente') as pendientes,
        COUNT(*) FILTER (WHERE estado = 'procesando') as procesando,
        COUNT(*) FILTER (WHERE estado = 'error') as errores,
        COUNT(*) FILTER (WHERE lineas_producto IS NULL) as sin_lineas
      FROM marcas
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback: servir frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📊 API disponible en http://localhost:${PORT}/api`);
  });
});
