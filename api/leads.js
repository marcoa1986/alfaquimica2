// api/leads.js
// import { neon } from '@neondatabase/serverless';

const memoriaRegistros = [];

const normalizarTexto = (v = '') =>
  String(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizarTelefono = (v = '') => String(v).replace(/\D/g, '');

const normalizarCorreo = (v = '') => String(v).trim().toLowerCase();

async function buscarDuplicados({ empresaNorm, telefonoNorm, correoNorm }) {
  // --- Opción con Neon Postgres (descomentar cuando configures DATABASE_URL) ---
  // const sql = neon(process.env.DATABASE_URL);
  // await sql`
  //   CREATE TABLE IF NOT EXISTS leads (
  //     id SERIAL PRIMARY KEY,
  //     folio TEXT,
  //     empresa TEXT NOT NULL,
  //     empresa_norm TEXT NOT NULL,
  //     contacto TEXT,
  //     telefono TEXT NOT NULL,
  //     telefono_norm TEXT NOT NULL,
  //     correo TEXT NOT NULL,
  //     correo_norm TEXT NOT NULL,
  //     payload JSONB,
  //     created_at TIMESTAMPTZ DEFAULT NOW()
  //   )
  // `;
  // const rows = await sql`
  //   SELECT empresa_norm, telefono_norm, correo_norm
  //   FROM leads
  //   WHERE empresa_norm = ${empresaNorm}
  //      OR telefono_norm = ${telefonoNorm}
  //      OR correo_norm = ${correoNorm}
  // `;
  // return {
  //   empresa: rows.some((r) => r.empresa_norm === empresaNorm),
  //   telefono: rows.some((r) => r.telefono_norm === telefonoNorm),
  //   correo: rows.some((r) => r.correo_norm === correoNorm),
  // };

  return {
    empresa: Boolean(empresaNorm) && memoriaRegistros.some((r) => r.empresaNorm === empresaNorm),
    telefono: Boolean(telefonoNorm) && memoriaRegistros.some((r) => r.telefonoNorm === telefonoNorm),
    correo: Boolean(correoNorm) && memoriaRegistros.some((r) => r.correoNorm === correoNorm),
  };
}

async function guardarLead(lead) {
  // --- Opción con Neon Postgres ---
  // const sql = neon(process.env.DATABASE_URL);
  // await sql`
  //   INSERT INTO leads (folio, empresa, empresa_norm, contacto, telefono, telefono_norm, correo, correo_norm, payload)
  //   VALUES (
  //     ${lead.folio}, ${lead.empresa}, ${lead.empresaNorm}, ${lead.contacto || ''},
  //     ${lead.telefono}, ${lead.telefonoNorm}, ${lead.correo}, ${lead.correoNorm},
  //     ${JSON.stringify(lead)}
  //   )
  // `;

  memoriaRegistros.push(lead);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const cliente = body.cliente || body;

    const empresa = String(cliente.empresa || '').trim();
    const contacto = String(cliente.contacto || '').trim();
    const telefono = String(cliente.telefono || '').trim();
    const correo = String(cliente.correo || '').trim();
    const folio = String(body.folio || '').trim();

    const empresaNorm = normalizarTexto(empresa);
    const telefonoNorm = normalizarTelefono(telefono);
    const correoNorm = normalizarCorreo(correo);

    if (!empresaNorm || telefonoNorm.length < 10 || !correoNorm.includes('@')) {
      return res.status(400).json({
        ok: false,
        error: 'Completa empresa, teléfono válido (10 dígitos) y correo válido.',
      });
    }

    const dup = await buscarDuplicados({ empresaNorm, telefonoNorm, correoNorm });
    const duplicados = [];
    if (dup.empresa) duplicados.push('empresa');
    if (dup.telefono) duplicados.push('telefono');
    if (dup.correo) duplicados.push('correo');

    if (duplicados.length > 0) {
      const etiquetas = {
        empresa: 'la empresa',
        telefono: 'el teléfono',
        correo: 'el correo',
      };
      const listaTxt = duplicados.map((k) => etiquetas[k]).join(', ');
      return res.status(409).json({
        ok: false,
        duplicate: true,
        fields: duplicados,
        error: `Ya existe un registro con ${listaTxt}. Deben ser distintos a los ya registrados.`,
      });
    }

    const nuevoLead = {
      folio,
      empresa,
      empresaNorm,
      contacto,
      telefono,
      telefonoNorm,
      correo,
      correoNorm,
      items: Array.isArray(body.items) ? body.items : [],
      fecha: new Date().toISOString(),
    };

    await guardarLead(nuevoLead);

    return res.status(201).json({
      ok: true,
      message: 'Cotización registrada y datos limpiados.',
      folio,
    });
  } catch (err) {
    console.error('Error en /api/leads:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error interno al validar o registrar los datos.',
    });
  }
}