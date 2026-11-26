import { createRequire } from 'node:module';

const require = typeof module !== 'undefined' && module.exports
  ? require
  : createRequire(import.meta.url);

const { Pool } = require('pg');

const globalScope = typeof globalThis !== 'undefined' ? globalThis : global;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta configurar DATABASE_URL en las variables de entorno de Vercel.');
  }
  if (!globalScope.__alfaLeadsPool) {
    globalScope.__alfaLeadsPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return globalScope.__alfaLeadsPool;
}

function normText(v = '') {
  return String(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normPhone(v = '') {
  return String(v).replace(/\D+/g, '').trim();
}

function normEmail(v = '') {
  return String(v).trim().toLowerCase();
}

function isAllowedOrigin(origin = '') {
  if (!origin) return true;
  if (origin === 'https://alfaquimica2.vercel.app') return true;
  if (/^https:\/\/alfaquimica2(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return false;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cotizaciones_leads (
      id BIGSERIAL PRIMARY KEY,
      folio TEXT UNIQUE NOT NULL,
      empresa TEXT NOT NULL,
      empresa_norm TEXT NOT NULL,
      contacto TEXT,
      telefono TEXT NOT NULL,
      telefono_norm TEXT NOT NULL,
      correo TEXT NOT NULL,
      correo_norm TEXT NOT NULL,
      cp TEXT,
      notas TEXT,
      canal TEXT,
      items JSONB DEFAULT '[]'::jsonb,
      subtotal NUMERIC(14,2) DEFAULT 0,
      iva NUMERIC(14,2) DEFAULT 0,
      total NUMERIC(14,2) DEFAULT 0,
      creado_en TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_leads_empresa_norm ON cotizaciones_leads (empresa_norm);
    CREATE INDEX IF NOT EXISTS idx_leads_telefono_norm ON cotizaciones_leads (telefono_norm);
    CREATE INDEX IF NOT EXISTS idx_leads_correo_norm ON cotizaciones_leads (correo_norm);
  `);
}

async function handler(req, res) {
  const reqOrigin = (req.headers && req.headers.origin) || '';
  if (isAllowedOrigin(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin || 'https://alfaquimica2.vercel.app');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const pool = getPool();
    await ensureSchema(pool);

    if (req.method === 'GET') {
      const { rows } = await pool.query(
        `SELECT id, folio, empresa, contacto, telefono, correo, cp, canal, total, creado_en
         FROM cotizaciones_leads
         ORDER BY id DESC
         LIMIT 50`
      );
      return res.status(200).json({ ok: true, leads: rows });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Metodo no permitido.' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      body = body ? JSON.parse(body) : {};
    } else if (!body || typeof body !== 'object') {
      body = {};
    }

    const empresa = String(body.empresa || '').trim();
    const contacto = String(body.contacto || '').trim();
    const telefono = String(body.telefono || '').trim();
    const correo = String(body.correo || '').trim();
    const cp = String(body.cp || '').trim();
    const notas = String(body.notas || '').trim();
    const canal = String(body.canal || 'web').trim();
    const folio = String(body.folio || `COT-${Date.now()}`).trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const subtotal = Number(body.subtotal || 0);
    const iva = Number(body.iva || 0);
    const total = Number(body.total || 0);

    const empresaNorm = normText(empresa);
    const telefonoNorm = normPhone(telefono);
    const correoNorm = normEmail(correo);

    if (!empresaNorm || !telefonoNorm || !correoNorm) {
      return res.status(400).json({
        ok: false,
        error: 'Empresa, telefono y correo son obligatorios.',
      });
    }

    const dup = await pool.query(
      `SELECT id, folio, empresa, telefono, correo
       FROM cotizaciones_leads
       WHERE empresa_norm = $1 OR telefono_norm = $2 OR correo_norm = $3
       LIMIT 1`,
      [empresaNorm, telefonoNorm, correoNorm]
    );

    if (dup.rows.length > 0) {
      const existing = dup.rows[0];
      const campos = [];
      if (normText(existing.empresa) === empresaNorm) campos.push('empresa');
      if (normPhone(existing.telefono) === telefonoNorm) campos.push('telefono');
      if (normEmail(existing.correo) === correoNorm) campos.push('correo');

      return res.status(409).json({
        ok: false,
        duplicate: true,
        fields: campos,
        folioExistente: existing.folio,
        error: `Registro duplicado detectado en: ${campos.join(', ')}.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO cotizaciones_leads (
         folio, empresa, empresa_norm, contacto, telefono, telefono_norm,
         correo, correo_norm, cp, notas, canal, items, subtotal, iva, total
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
       RETURNING id, folio, empresa, telefono, correo, creado_en`,
      [
        folio, empresa, empresaNorm, contacto, telefono, telefonoNorm,
        correo, correoNorm, cp, notas, canal, JSON.stringify(items), subtotal, iva, total
      ]
    );

    return res.status(201).json({
      ok: true,
      lead: rows[0],
    });
  } catch (err) {
    console.error('Error en /api/leads:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error interno al procesar el registro en Neon.',
      detail: err && err.message ? err.message : String(err),
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = handler;
}
export default handler;