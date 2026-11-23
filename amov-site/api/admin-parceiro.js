// api/admin-parceiro.js — PATCH /api/admin-parceiro (exige sessão do painel)
// Corpo: { id, status?, notas? } — muda o status do parceiro e/ou as anotações internas.
import { getPool, garantirSchema } from './_lib/db.js';
import { responder } from './_lib/seguranca.js';
import { barrarAdmin } from './_lib/admin.js';

const STATUS = ['novo', 'em_revisao', 'aprovado', 'recusado', 'inativo'];

export default async function handler(req, res) {
  if (barrarAdmin(req, res, { metodos: ['PATCH'] })) return;

  let b;
  try { b = req.body; } catch { b = null; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return responder(res, 400, { error: 'envio inválido' });

  const id = Number(b.id);
  if (!Number.isSafeInteger(id) || id <= 0) return responder(res, 400, { error: 'id inválido' });
  const temStatus = b.status !== undefined, temNotas = b.notas !== undefined;
  if (!temStatus && !temNotas) return responder(res, 400, { error: 'nada para alterar' });
  if (temStatus && !STATUS.includes(b.status)) return responder(res, 400, { error: 'status inválido' });
  const notas = temNotas ? (String(b.notas ?? '').trim().slice(0, 8000) || null) : null;

  let client;
  try {
    await garantirSchema();
    client = await getPool().connect();
    // atualizado_em não muda aqui (o gatilho só olha as colunas do formulário):
    // ele marca o último envio do parceiro, não a edição da equipe
    const r = await client.query(
      `update public.parceiros set
         status             = case when $2 then $3 else status end,
         status_alterado_em = case when $2 and status is distinct from $3 then now() else status_alterado_em end,
         notas_internas     = case when $4 then $5 else notas_internas end
       where id = $1
       returning id::int as id, status, notas_internas, status_alterado_em`,
      [id, temStatus, temStatus ? b.status : null, temNotas, notas]
    );
    if (!r.rowCount) return responder(res, 404, { error: 'parceiro não encontrado' });
    return responder(res, 200, { ok: true, parceiro: r.rows[0] });
  } catch (e) {
    console.error('admin-parceiro error:', e);
    return responder(res, 500, { error: 'internal' });
  } finally {
    if (client) client.release();
  }
}
