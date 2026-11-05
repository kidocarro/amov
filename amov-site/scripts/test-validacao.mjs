// scripts/test-validacao.mjs — confere que navegador e servidor validam igual.  npm test
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as srv from '../api/_lib/documento.js';

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../js/documento.js', import.meta.url), 'utf8'), ctx);
const web = ctx.window.AmovDocumento;

const validos = ['529.982.247-25', '111.444.777-35', '11.222.333/0001-81', '12.ABC.345/01DE-35', '12abc34501de35', '00.000.000/0001-91'];
const invalidos = ['529.982.247-24', '111.111.111-11', '11.222.333/0001-80', '12.ABC.345/01DE-36', '123', '', '1234567890', '123456789012345', 'ABCDEFGHIJKL00'];

for (const v of validos) {
  assert.ok(srv.analisar(v), `servidor deveria aceitar ${v}`);
  assert.ok(web.analisar(v), `navegador deveria aceitar ${v}`);
  assert.deepEqual({ ...web.analisar(v) }, srv.analisar(v));
}
for (const v of invalidos) {
  assert.equal(srv.analisar(v), null, `servidor deveria recusar ${v}`);
  assert.equal(web.analisar(v), null, `navegador deveria recusar ${v}`);
}
// varredura: 5 mil documentos aleatórios, as duas implementações têm que concordar
const abc = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (let n = 0; n < 5000; n++) {
  const len = n % 2 ? 11 : 14;
  let d = '';
  for (let i = 0; i < len; i++) d += (len === 11 || i >= 12) ? String(Math.floor(Math.random() * 10)) : abc[Math.floor(Math.random() * abc.length)];
  assert.equal(!!web.analisar(d), !!srv.analisar(d), `divergência em ${d}`);
}
console.log('ok — validação de CPF/CNPJ igual no navegador e no servidor');
