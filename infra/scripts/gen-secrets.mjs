#!/usr/bin/env node
/**
 * Gera os segredos do .env em um comando.
 *
 * Existe porque "gere um segredo forte" e a instrucao que mais vira
 * `changeme123` na pratica: se gerar da trabalho, alguem digita qualquer coisa.
 *
 *   node infra/scripts/gen-secrets.mjs            imprime na tela
 *   node infra/scripts/gen-secrets.mjs --write    grava .env da raiz e api/.env
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const write = process.argv.includes('--write');

const secrets = {
  JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('base64url'),
  JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
  PRISMA_FIELD_ENCRYPTION_KEY: `k1.aesgcm256.${crypto.randomBytes(32).toString('base64url')}`,
};

if (!write) {
  console.log('\n# Cole no seu .env (nao versione este arquivo):\n');
  for (const [k, v] of Object.entries(secrets)) console.log(`${k}=${v}`);
  console.log('\n# Para gravar automaticamente: node infra/scripts/gen-secrets.mjs --write\n');
  process.exit(0);
}

/** Atualiza a chave se ela existir, acrescenta se nao existir. */
function upsert(file, values) {
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, `${k}=${v}`) : `${content.trimEnd()}\n${k}=${v}\n`;
  }
  fs.writeFileSync(file, content.startsWith('\n') ? content.slice(1) : content);
  console.log(`atualizado: ${path.relative(root, file)}`);
}

// Os dois arquivos recebem os MESMOS valores: o compose le o da raiz e a API
// local le o de api/. Valores diferentes fariam a sessao emitida no docker ser
// recusada fora dele, com um erro que nao explica nada.
upsert(path.join(root, '.env'), secrets);
upsert(path.join(root, 'api/.env'), secrets);

console.log('\nSegredos gerados. Guarde a PRISMA_FIELD_ENCRYPTION_KEY em cofre:');
console.log('perde-la torna nome, endereco e foto dos alunos ilegiveis para sempre.\n');
