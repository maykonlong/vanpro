/**
 * Codemod pontual: acrescenta `companyId: tenantId()` nas chamadas de create
 * dos modelos multi-tenant, e garante o import.
 *
 * Os alvos vem do proprio tsc (arquivo:linha do TS2322), entao nao ha
 * adivinhacao sobre qual `create` e de modelo tenant-scoped.
 *
 * Uso: node scripts/add-tenant-to-creates.mjs "src/a.ts:10" "src/a.ts:20" ...
 */
import fs from 'node:fs';
import path from 'node:path';

const alvos = new Map();
for (const arg of process.argv.slice(2)) {
  const i = arg.lastIndexOf(':');
  const file = arg.slice(0, i);
  const line = Number(arg.slice(i + 1));
  if (!alvos.has(file)) alvos.set(file, []);
  alvos.get(file).push(line);
}

for (const [arquivo, linhas] of alvos) {
  const lines = fs.readFileSync(arquivo, 'utf8').split('\n');

  // De baixo para cima: inserir linha nao desloca os alvos ainda pendentes.
  for (const ln of [...linhas].sort((a, b) => b - a)) {
    const idx = ln - 1;
    const alvo = lines[idx];
    if (alvo === undefined) {
      console.error(`  ! ${arquivo}:${ln} fora do arquivo`);
      continue;
    }

    if (/data:\s*\{\s*$/.test(alvo)) {
      const indent = (alvo.match(/^\s*/) ?? [''])[0] + '  ';
      lines.splice(idx + 1, 0, `${indent}companyId: tenantId(),`);
    } else if (/data:\s*\{/.test(alvo)) {
      lines[idx] = alvo.replace(/data:\s*\{/, 'data: { companyId: tenantId(),');
    } else {
      console.error(`  ! ${arquivo}:${ln} nao parece um "data: {" -> ${JSON.stringify(alvo)}`);
    }
  }

  let src = lines.join('\n');
  if (!/from '[^']*lib\/tenant'/.test(src)) {
    const rel = path
      .relative(path.dirname(arquivo), 'src/lib/tenant')
      .replace(/\\/g, '/')
      .replace(/^(?!\.)/, './');
    const fim = src.indexOf('\n', src.indexOf('import '));
    src = `${src.slice(0, fim + 1)}import { tenantId } from '${rel}';\n${src.slice(fim + 1)}`;
  }

  fs.writeFileSync(arquivo, src);
  console.log(`  ok ${arquivo} (${linhas.length} create)`);
}
