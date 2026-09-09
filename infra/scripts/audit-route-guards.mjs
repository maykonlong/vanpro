/**
 * Auditoria de guarda de papel, ROTA A ROTA.
 *
 * O guarda 9 do `guards.sh` pergunta "este controller cita requireRole em algum
 * lugar?". Isso pega o caso grosseiro — controller inteiro sem guarda — mas nao
 * pega o caso perigoso: um arquivo com dez rotas protegidas e uma esquecida.
 *
 * Aqui a unidade e a ROTA. Saida legivel, e exit 1 se sobrar alguma sem guarda
 * em controller que nao se declarou publico.
 */
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(process.argv[2] ?? 'api/src/modules');
const MARCADOR = 'GUARDA: rota-publica-intencional';

/** As 6 linhas imediatamente anteriores a chamada — onde o marcador de rota mora. */
function trechoAntes(src, indice) {
  return src.slice(0, indice).split('\n').slice(-6).join('\n');
}

function controllers(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) return controllers(p);
    return f.name.endsWith('.controller.ts') ? [p] : [];
  });
}

let comGuarda = 0;
let publicas = 0;
const semGuarda = [];

for (const arquivo of controllers(RAIZ)) {
  const src = fs.readFileSync(arquivo, 'utf8');
  const declaradoPublico = src.includes(MARCADOR);
  const rel = path.relative(process.cwd(), arquivo).replace(/\\/g, '/');

  // Casa a chamada inteira, do `router.get(` ate o `);` que a fecha na coluna 0
  // ou apos o handler. Cobre tanto o formato de uma linha quanto o multilinha.
  const re = /\b(?:router|publicRouter)\.(get|post|patch|put|delete)\(\s*'([^']*)'([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, metodo, rota, resto] = m;
    // O marcador vale por ARQUIVO (controller inteiramente publico) ou por ROTA
    // (arquivo misto, como o de empresa: quase tudo autenticado, so o aceite de
    // convite e publico). Sem o segundo caso, marcar o arquivo desculparia
    // tambem as rotas que deveriam estar protegidas.
    const marcadaAqui = resto.includes(MARCADOR) || trechoAntes(src, m.index).includes(MARCADOR);
    if (/requireRole|requireSuperAdmin/.test(resto)) comGuarda += 1;
    else if (declaradoPublico || marcadaAqui) publicas += 1;
    else semGuarda.push(`${rel} :: ${metodo.toUpperCase()} ${rota}`);
  }
}

console.log(`rotas com requireRole/requireSuperAdmin : ${comGuarda}`);
console.log(`rotas em controller declarado publico   : ${publicas}`);
console.log(`rotas SEM guarda e sem declaracao       : ${semGuarda.length}`);

if (semGuarda.length) {
  console.log('\n' + semGuarda.join('\n'));
  console.log('\nCada uma precisa de requireRole(...), ou o controller precisa declarar');
  console.log(`o comentario "${MARCADOR}" explicando por que e publico.`);
  process.exit(1);
}
