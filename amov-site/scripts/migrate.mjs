// scripts/migrate.mjs — aplica as migrações de supabase/migrations no banco.
// Uso: POSTGRES_URL_NON_POOLING="postgres://..." npm run db:migrate
//      (ou `vercel env pull .env.local` e `node --env-file=.env.local scripts/migrate.mjs`)
import pg from 'pg';
import { urlBanco, migrar } from '../api/_lib/db.js';

const cs = urlBanco({ semPool: true });
if (!cs) {
  console.error('Defina POSTGRES_URL_NON_POOLING (ou POSTGRES_URL).');
  process.exit(1);
}
const local = process.env.PGSSL === 'off' || /localhost|127\.0\.0\.1|host=\//.test(cs);
const client = new pg.Client({ connectionString: cs, ssl: local ? false : { rejectUnauthorized: false } });
try {
  await client.connect();
  const feitas = await migrar(client, { log: console.log });
  console.log(feitas.length ? `ok — ${feitas.length} migração(ões) aplicada(s)` : 'ok — banco já está atualizado');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
