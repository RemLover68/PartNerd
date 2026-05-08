/**
 * Parsea el contenido del archivo .txt con bloques de marcas/contactos.
 * Formato esperado:
 *   MARCA : BOSCH / IQSIGHT
 *   CONTACTO : CRISTOBAL CRUCES
 *   CORREO : xxx@yyy.com
 *   TELEFONO : +5698584574
 *   URL : https://...
 *   LINEAS DE PRODUCTOS : CAMARAS Y SISTEMAS VMS
 *
 * Los bloques se separan por líneas en blanco.
 */
function parseTxtContent(content) {
  // Normalizar saltos de línea
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Dividir en bloques por líneas vacías
  const blocks = normalized.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const records = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const record = {
      marca: null,
      contacto: null,
      correo: null,
      telefono: null,
      url: null,
      lineas_producto: null,
    };

    for (const line of lines) {
      // Separar clave : valor (el separador es el primer ":")
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.substring(0, colonIdx).trim().toUpperCase();
      // Para URLs con "https://..." reconstruimos valor completo
      const rawVal = line.substring(colonIdx + 1).trim();

      // Para URL puede haber "URL : https://..." → valor correcto ya
      // Pero si la línea tiene múltiples ":", como URL, lo tomamos completo
      const val = key === 'URL'
        ? line.substring(colonIdx + 1).trim()
        : rawVal;

      if (key === 'MARCA') record.marca = val;
      else if (key === 'CONTACTO') record.contacto = val;
      else if (key === 'CORREO') record.correo = val;
      else if (key === 'TELEFONO' || key === 'TELÉFONO') record.telefono = val;
      else if (key === 'URL') {
        // Reconstruir URL completa (puede tener múltiples ":")
        const urlMatch = line.match(/URL\s*:\s*(.+)/i);
        record.url = urlMatch ? urlMatch[1].trim() : val;
      }
      else if (key === 'LINEAS DE PRODUCTOS' || key === 'LÍNEAS DE PRODUCTOS' || key === 'LINEAS DE PRODUCTO') {
        record.lineas_producto = val;
      }
    }

    // Solo agregar si tiene al menos marca o contacto
    if (record.marca || record.contacto) {
      records.push(record);
    }
  }

  return records;
}

module.exports = { parseTxtContent };
