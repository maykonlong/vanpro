#!/usr/bin/env node
/**
 * Gera os segredos da stack em um comando.
 *
 * Existe porque "gere um segredo forte" e a instrucao que mais vira
 * `changeme123` na pratica: se gerar da trabalho, alguem digita qualquer coisa.
 *
 *   node infra/scripts/gen-secrets.mjs                imprime na tela
 *   node infra/scripts/gen-secrets.mjs --write        grava os .env
 *   node infra/scripts/gen-secrets.mjs --write --rotacionar-banco
 *
 * ─── Por que a senha do banco NAO e regerada por padrao ───────────────────
 *
 * Os papeis do PostgreSQL nascem UMA vez, no primeiro `up`, pelo script de
 * init — que so roda com o volume vazio. Gerar senha nova depois disso troca o
 * arquivo e nao troca o banco: a API passa a apresentar uma senha que o
 * servidor nunca viu, e o sintoma ("password authentication failed") aponta
 * para o lugar errado. Por isso a senha existente e PRESERVADA, e trocar de
 * verdade e um pedido explicito (`--rotacionar-banco`) que vem com o passo do
 * ALTER ROLE escrito na saida.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const write = process.argv.includes('--write');
const rotacionarBanco = process.argv.includes('--rotacionar-banco');

/**
 * Senha de banco em hexadecimal, e nao base64url.
 *
 * A senha vive dentro de uma URL (`postgresql://user:SENHA@host/db`). Em
 * base64url o `-` e o `_` sao inofensivos, mas basta um dia alguem trocar por
 * base64 comum para `+` e `/` entrarem — e `/` numa URL de conexao corta o
 * nome do banco. Hexadecimal nao tem esse problema em URL nenhuma, e 32 bytes
 * continuam sendo 256 bits de entropia.
 */
const senhaBanco = () => crypto.randomBytes(32).toString('hex');

const segredosApp = {
  JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
  PRISMA_FIELD_ENCRYPTION_KEY: `k1.aesgcm256.${crypto.randomBytes(32).toString('base64url')}`,
};

const segredosBanco = {
  POSTGRES_SUPER_PASSWORD: senhaBanco(),
  POSTGRES_OWNER_PASSWORD: senhaBanco(),
  POSTGRES_APP_PASSWORD: senhaBanco(),
};

if (!write) {
  console.log('\n# Cole no .env da RAIZ (nao versione este arquivo):\n');
  for (const [k, v] of Object.entries({ ...segredosApp, ...segredosBanco })) console.log(`${k}=${v}`);
  console.log('\n# Para gravar automaticamente: node infra/scripts/gen-secrets.mjs --write\n');
  process.exit(0);
}

function ler(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Le o valor de uma chave num conteudo de .env, ou null. */
function valorAtual(content, chave) {
  const m = content.match(new RegExp(`^${chave}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

/** Atualiza a chave se ela existir, acrescenta se nao existir. */
function upsert(file, values) {
  let content = ler(file);
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, `${k}=${v}`) : `${content.trimEnd()}\n${k}=${v}\n`;
  }
  fs.writeFileSync(file, content.startsWith('\n') ? content.slice(1) : content, { mode: 0o600 });
  console.log(`atualizado: ${path.relative(root, file)}`);
}

const envRaiz = path.join(root, '.env');
const conteudoRaiz = ler(envRaiz);

// Senha de banco ja existente e mantida, a menos que o operador peca a troca.
const bancoFinal = {};
const preservadas = [];
for (const [k, novo] of Object.entries(segredosBanco)) {
  const atual = valorAtual(conteudoRaiz, k);
  if (atual && !rotacionarBanco) {
    bancoFinal[k] = atual;
    preservadas.push(k);
  } else {
    bancoFinal[k] = novo;
  }
}

// Os valores de APP vao para os DOIS arquivos: o compose le o da raiz e a API
// local le o de api/. Valores diferentes fariam a sessao emitida no docker ser
// recusada fora dele, com um erro que nao explica nada.
//
// A DATABASE_URL da raiz e SO das ferramentas do host (backup.sh). Ela usa a
// grafia do libpq (`sslmode=verify-full` + `sslrootcert`), que e outra da que o
// Prisma entende — o compose monta a dele, com `sslaccept=strict`, sem passar
// por aqui.
upsert(envRaiz, {
  ...segredosApp,
  ...bancoFinal,
  // Entre ASPAS, e nao solta: o `backup.sh` carrega este arquivo com
  // `set -a; . .env`, e ai o `&` de `...verify-full&sslrootcert=...` vira
  // operador de segundo plano do shell. A variavel chega cortada no meio e o
  // erro que aparece e "sem DATABASE_URL" — que nao sugere aspas em lugar
  // nenhum. O parser do docker compose entende as aspas e as remove.
  DATABASE_URL:
    `"postgresql://vanpro_owner:${bancoFinal.POSTGRES_OWNER_PASSWORD}@localhost:5433/vanpro` +
    `?sslmode=verify-full&sslrootcert=infra/certs/db/ca.crt"`,
});

// `../../infra/...` e nao `../infra/...`: o Prisma resolve caminho de
// certificado relativo ao diretorio do schema (api/prisma/), e nao ao diretorio
// de onde o comando foi chamado. O sintoma do caminho errado e um "cert file
// not found" que nao diz qual base ele usou.
const urlLocal = (usuario, senha, banco) =>
  `postgresql://${usuario}:${senha}@localhost:5433/${banco}` +
  `?schema=public&sslmode=require&sslcert=../../infra/certs/db/ca.crt&sslaccept=strict`;

// api/.env e api/.env.test falam com o banco como `vanpro_owner`: os dois
// caminhos rodam migration (`prisma migrate dev` e o `migrate deploy` do
// setup da suite), e migration e DDL — que o papel de runtime nao tem.
upsert(path.join(root, 'api/.env'), {
  ...segredosApp,
  DATABASE_URL: urlLocal('vanpro_owner', bancoFinal.POSTGRES_OWNER_PASSWORD, 'vanpro'),
});
upsert(path.join(root, 'api/.env.test'), {
  ...segredosApp,
  DATABASE_URL: urlLocal('vanpro_owner', bancoFinal.POSTGRES_OWNER_PASSWORD, 'vanpro_test'),
});

if (preservadas.length > 0) {
  console.log(`\npreservadas (ja existiam no .env): ${preservadas.join(', ')}`);
  console.log('para trocar de verdade: --rotacionar-banco (e leia o aviso abaixo).');
}

if (rotacionarBanco) {
  console.log(`
ATENCAO — a senha nova so vale depois de o SERVIDOR conhecer:

  docker compose exec postgres psql -U postgres -c \\
    "ALTER ROLE vanpro_owner PASSWORD '${bancoFinal.POSTGRES_OWNER_PASSWORD}';"
  docker compose exec postgres psql -U postgres -c \\
    "ALTER ROLE vanpro_app PASSWORD '${bancoFinal.POSTGRES_APP_PASSWORD}';"

Sem isso a API sobe e falha em "password authentication failed".`);
}

console.log(`
Segredos gerados. Guarde a PRISMA_FIELD_ENCRYPTION_KEY em cofre:
perde-la torna nome, endereco e foto dos alunos ilegiveis para sempre
(docs/CRIPTOGRAFIA.md explica por que nao ha recuperacao).

Falta ainda o material de TLS:
  bash infra/scripts/gerar-certificados.sh
`);
