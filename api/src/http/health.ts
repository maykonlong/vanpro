import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { redis, redisHealthy } from '../lib/redis';
import { runUnscoped } from '../lib/request-context';
import { env, features } from '../config/env';
import { renderizarPrometheus } from '../lib/metrics';

/**
 * Sondas separadas de proposito.
 *
 *   /live   o processo respondeu. Se falhar, reiniciar resolve.
 *   /ready  as dependencias respondem. Se falhar, TIRE do balanceador mas NAO
 *           reinicie — reiniciar um pod porque o banco piscou transforma uma
 *           indisponibilidade curta em tempestade de reinicios.
 *
 * Nenhuma delas expoe versao de dependencia, host de banco ou stack: sonda e
 * endpoint publico, e publicar o inventario ajuda mais quem esta sondando.
 */
const router = Router();

router.get('/live', (_req, res) => {
  res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

router.get('/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'down'> = {};

  try {
    // GUARDA: sql-cru-auditado — `SELECT 1` nao le tabela nenhuma; nao ha dado de empresa envolvido.
    await runUnscoped('healthcheck', () => prisma.$queryRaw`SELECT 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'down';
  }

  if (redisHealthy()) {
    try {
      await redis.ping();
      checks.cache = 'ok';
    } catch {
      checks.cache = 'down';
    }
  } else {
    checks.cache = 'down';
  }

  // Banco fora = nao pronto. Redis fora = degradado, mas atende: o rate limit
  // cai para memoria local e o resto do produto continua de pe.
  const ready = checks.database === 'ok';
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

/** Compat: o healthcheck do compose e monitores antigos batem aqui. */
router.get('/', (_req, res) => {
  res.json({ status: 'ok', env: env.APP_ENV });
});

/**
 * Quais integracoes estao realmente ligadas. O front usa isso para desabilitar
 * botao com explicacao em vez de deixar o usuario clicar e tomar erro.
 */
router.get('/features', (_req, res) => {
  res.json({
    billing: features.billing,
    whatsapp: features.whatsapp,
  });
});

/**
 * Metricas para o Prometheus.
 *
 * Fica sob `/health` de proposito: o nginx nao repassa esse prefixo para a
 * internet (ver `web/nginx.conf`), entao o endpoint so responde na rede interna,
 * onde o coletor vive. Nao ha rotulo com id de usuario, empresa ou caminho
 * concreto — metrica nao pode virar diretorio de quem esta no sistema.
 */
router.get('/metrics', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderizarPrometheus());
});

/**
 * O carimbo de versao NAO mora aqui.
 *
 * Ele chegou a ser montado neste router e, ao mesmo tempo, em `routes.ts` sob
 * `/interno` — a mesma rota respondendo em dois caminhos, com o nginx negando
 * so um deles. E a classe exata de defeito que originou este projeto (o router
 * de alunos montado duas vezes, publico no primeiro match).
 *
 * Ficou uma montagem so, em `/interno`, negada por prefixo no nginx: dizer qual
 * imagem esta de pe ajuda a operacao e ajuda igualmente quem procura uma versao
 * com falha conhecida.
 */
export default router;
