/**
 * Um router, um lugar.
 *
 * O guarda 15 pega prefixo repetido DENTRO da tabela `MONTAGENS`. Ele nao pega
 * o caso que aconteceu aqui: o router de versao foi montado na tabela e,
 * simultaneamente, com `router.use(versionRouter)` dentro de outro router. A
 * mesma rota passou a responder em dois caminhos, e o nginx negava so um deles.
 *
 * E a mesma classe do defeito que originou o projeto — o router de alunos
 * montado uma vez com autenticacao e outra sem, publico pelo primeiro match. A
 * diferenca e que naquele caso os dois caminhos eram iguais e aqui eram
 * diferentes; o efeito, exposicao nao pretendida, e o mesmo.
 *
 * Regra: um router que aparece em `MONTAGENS` nao pode ser montado em nenhum
 * outro lugar de `src/`.
 */
import fs from 'node:fs';
import path from 'node:path';

const API_SRC = path.resolve('api/src');
const ROUTES = path.join(API_SRC, 'http/routes.ts');

if (!fs.existsSync(ROUTES)) {
  console.log('ok     routes.ts nao encontrado — nada a conferir');
  process.exit(0);
}

const origem = fs.readFileSync(ROUTES, 'utf8');

/** Identificadores usados como `router:` na tabela de montagens. */
const naTabela = new Set(
  [...origem.matchAll(/router:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
);

if (naTabela.size === 0) {
  console.log('ok     nenhuma montagem declarada');
  process.exit(0);
}

/**
 * Do identificador para o modulo de origem. Dois arquivos podem chamar o mesmo
 * router de nomes diferentes, entao a comparacao e pelo CAMINHO importado, e
 * nao pelo nome da variavel.
 */
const moduloDe = new Map();
for (const m of origem.matchAll(/import\s+([A-Za-z_$][\w$]*)[^;]*?from\s+'([^']+)'/g)) {
  if (naTabela.has(m[1])) moduloDe.set(m[1], path.resolve(path.dirname(ROUTES), m[2]));
}

function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) return arquivos(p);
    return f.name.endsWith('.ts') ? [p] : [];
  });
}

const montadosFora = [];

for (const arquivo of arquivos(API_SRC)) {
  if (path.resolve(arquivo) === ROUTES) continue;
  const src = fs.readFileSync(arquivo, 'utf8');

  // Quais routers da tabela este arquivo importa, e com que nome local.
  const locais = new Map();
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)[^;]*?from\s+'([^']+)'/g)) {
    const alvo = path.resolve(path.dirname(arquivo), m[2]);
    for (const [, modulo] of moduloDe) {
      if (modulo === alvo) locais.set(m[1], path.relative(process.cwd(), alvo).replace(/\\/g, '/'));
    }
  }
  if (locais.size === 0) continue;

  src.split('\n').forEach((linha, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;
    for (const [nome, modulo] of locais) {
      if (new RegExp(`\\.use\\(\\s*(['"][^'"]*['"]\\s*,\\s*)?${nome}\\b`).test(linha)) {
        montadosFora.push(
          `${path.relative(process.cwd(), arquivo).replace(/\\/g, '/')}:${i + 1}: ${nome} (${modulo}) ja esta em MONTAGENS`,
        );
      }
    }
  });
}

if (montadosFora.length) {
  console.log(montadosFora.join('\n'));
  console.log('\nUm router montado em dois lugares responde em dois caminhos, e a defesa');
  console.log('de borda costuma cobrir so um deles. Escolha UM ponto de montagem.');
  process.exit(1);
}

console.log(`ok     ${naTabela.size} routers, cada um montado em um lugar so`);
