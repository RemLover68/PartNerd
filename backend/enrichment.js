const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

/**
 * Hace scraping de una URL y extrae texto útil de la página.
 */
async function scrapePage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarcaBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const $ = cheerio.load(response.data);

    // Remover scripts, estilos, navegación
    $('script, style, nav, footer, header, iframe, noscript').remove();

    // Extraer texto de secciones relevantes
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const metaKeywords = $('meta[name="keywords"]').attr('content') || '';

    // Texto principal (primeros 3000 chars para no saturar IA)
    const bodyText = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3000);

    // Listas y headings para capturar productos
    const headings = [];
    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 2 && text.length < 200) headings.push(text);
    });

    const lists = [];
    $('li').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 2 && text.length < 200) lists.push(text);
    });

    return {
      title,
      metaDesc,
      metaKeywords,
      bodyText,
      headings: headings.slice(0, 30),
      lists: lists.slice(0, 50),
    };
  } catch (err) {
    throw new Error(`Error scraping ${url}: ${err.message}`);
  }
}

/**
 * Usa la API de Anthropic para generar descripción y líneas de producto
 * a partir del contenido scrapeado.
 */
async function enrichWithAI(marca, url, scrapedData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada en .env');
  }

  const prompt = `Analiza el siguiente contenido de la página web de la empresa "${marca}" (URL: ${url}).

TÍTULO: ${scrapedData.title}
META DESCRIPCIÓN: ${scrapedData.metaDesc}
META KEYWORDS: ${scrapedData.metaKeywords}
HEADINGS: ${scrapedData.headings.join(' | ')}
CONTENIDO: ${scrapedData.bodyText.substring(0, 2000)}

Responde ÚNICAMENTE en JSON válido con esta estructura exacta (sin markdown, sin backticks):
{
  "descripcion": "Descripción detallada de la empresa y sus productos en 2-3 oraciones en español",
  "lineas_producto": "Lista de líneas de productos separadas por coma, en mayúsculas, ej: CÁMARAS IP, SISTEMAS VMS, SOFTWARE DE SEGURIDAD"
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 30000,
    }
  );

  const textContent = response.data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Limpiar posibles backticks
  const cleaned = textContent.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    descripcion: parsed.descripcion || '',
    lineas_enriquecidas: parsed.lineas_producto || '',
  };
}

/**
 * Función principal: scraping + IA
 */
async function enrichRecord(marca, url) {
  const scrapedData = await scrapePage(url);
  const aiResult = await enrichWithAI(marca, url, scrapedData);
  return aiResult;
}

module.exports = { enrichRecord, scrapePage };
