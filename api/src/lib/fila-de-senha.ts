import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { logger } from './logger';

/**
 * Cálculo de senha fora da fila principal.
 *
 * O problema, medido e não suposto: `bcryptjs` é JavaScript puro e **bloqueia o
 * event loop** enquanto trabalha. Com custo 12 isso é cerca de 0,9 segundo por
 * login — e durante esse tempo o processo inteiro para. Não é o login que fica
 * lento: é todo mundo. A medição contra a pilha no ar mostrou a listagem de
 * alunos indo de 503 ms com uma conexão para 3 segundos de p95 com vinte, numa
 * base de 96 alunos. A conta não era de banco nem de rede; era a senha de
 * outra pessoa sendo embaralhada.
 *
 * A saída errada seria baixar o custo do bcrypt. Ela melhora o número e piora
 * exatamente aquilo que o custo existe para proteger — trocaria segurança por
 * benchmark. A saída certa é tirar o trabalho da fila: os workers rodam em
 * threads próprias, o event loop segue atendendo, e o custo 12 fica intacto.
 *
 * **Por que o worker nasce de uma string em vez de um arquivo.** Um
 * `new Worker('./password.worker.js')` precisaria existir como `.ts` em
 * desenvolvimento e como `.js` em produção, e o caminho muda entre os dois — é
 * a classe de detalhe que funciona na máquina de quem escreveu e quebra na
 * imagem. Como string, o mesmo código roda nos dois, sem passo de build.
 *
 * **Falha para o caminho síncrono, nunca para erro.** Se o worker não subir
 * (ambiente restrito, memória curta), a senha é calculada na própria thread: o
 * produto fica lento como era antes, e continua correto. Um pool que derruba o
 * login porque não conseguiu criar thread troca uma lentidão por um apagão.
 */

const FONTE_DO_WORKER = `
  const { parentPort } = require('node:worker_threads');
  const bcrypt = require('bcryptjs');

  parentPort.on('message', (msg) => {
    try {
      const valor =
        msg.op === 'hash'
          ? bcrypt.hashSync(msg.texto, msg.custo)
          : bcrypt.compareSync(msg.texto, msg.hash);
      parentPort.postMessage({ id: msg.id, valor });
    } catch (err) {
      parentPort.postMessage({ id: msg.id, erro: String(err && err.message ? err.message : err) });
    }
  });
`;

/**
 * Quantas threads. Duas contas se cruzam aqui:
 *
 *   - mais threads que núcleos não acelera nada, só troca de contexto;
 *   - o processo principal precisa de núcleo para atender HTTP.
 *
 * Daí `núcleos - 1`, com teto de 4: além disso o ganho some e a memória (cada
 * worker carrega o próprio `bcryptjs`) começa a pesar num contêiner pequeno.
 */
const TAMANHO = Math.max(1, Math.min(4, os.cpus().length - 1));

interface Pedido {
  resolver: (valor: string | boolean) => void;
  rejeitar: (erro: Error) => void;
}

const pendentes = new Map<number, Pedido>();
let workers: Worker[] = [];
let proximo = 0;
let sequencia = 0;
let iniciado = false;
let indisponivel = false;

function criarWorker(): Worker | null {
  try {
    const w = new Worker(FONTE_DO_WORKER, { eval: true });
    w.unref(); // não segura o processo no encerramento
    w.on('message', (resposta: { id: number; valor?: string | boolean; erro?: string }) => {
      const pedido = pendentes.get(resposta.id);
      if (!pedido) return;
      pendentes.delete(resposta.id);
      if (resposta.erro) pedido.rejeitar(new Error(resposta.erro));
      else pedido.resolver(resposta.valor as string | boolean);
    });
    w.on('error', (err) => {
      logger.error({ err }, 'worker de senha caiu — cálculo volta para a thread principal');
      indisponivel = true;
      // Ninguém fica esperando para sempre por uma thread que morreu.
      for (const [id, pedido] of pendentes) {
        pendentes.delete(id);
        pedido.rejeitar(err);
      }
    });
    return w;
  } catch (err) {
    logger.warn({ err }, 'não foi possível criar worker de senha — seguindo na thread principal');
    return null;
  }
}

function garantirPool(): boolean {
  if (indisponivel) return false;
  if (iniciado) return workers.length > 0;
  iniciado = true;

  workers = Array.from({ length: TAMANHO }, criarWorker).filter((w): w is Worker => w !== null);
  if (workers.length === 0) {
    indisponivel = true;
    return false;
  }
  logger.info({ threads: workers.length }, 'cálculo de senha rodando fora da fila principal');
  return true;
}

function despachar(msg: Record<string, unknown>): Promise<string | boolean> {
  const id = ++sequencia;
  const worker = workers[proximo % workers.length]!;
  proximo += 1;

  return new Promise((resolver, rejeitar) => {
    pendentes.set(id, { resolver, rejeitar });
    worker.postMessage({ ...msg, id });
  });
}

/** Disponível para o teste e para a sonda saber em que modo o processo está. */
export function poolDeSenhaAtivo(): boolean {
  return iniciado && !indisponivel && workers.length > 0;
}

export async function hashEmThread(
  texto: string,
  custo: number,
  reserva: () => Promise<string>,
): Promise<string> {
  if (!garantirPool()) return reserva();
  try {
    return (await despachar({ op: 'hash', texto, custo })) as string;
  } catch {
    return reserva();
  }
}

export async function compareEmThread(
  texto: string,
  hash: string,
  reserva: () => Promise<boolean>,
): Promise<boolean> {
  if (!garantirPool()) return reserva();
  try {
    return (await despachar({ op: 'compare', texto, hash })) as boolean;
  } catch {
    return reserva();
  }
}

/** Encerra as threads no shutdown gracioso. */
export async function encerrarPoolDeSenha(): Promise<void> {
  await Promise.all(workers.map((w) => w.terminate()));
  workers = [];
  iniciado = false;
}
