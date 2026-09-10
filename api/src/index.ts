import { createServer } from 'node:http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { connectRedis, disconnectRedis } from './lib/redis';
import { encerrarPoolDeSenha } from './lib/fila-de-senha';
import { runUnscoped } from './lib/request-context';
import { createApp } from './http/app';
import { setupRealtime, closeRealtime } from './realtime/server';
import { startJobs, stopJobs } from './jobs';

// Instalados antes de main(): uma dependencia que rejeita durante o boot
// (o store do rate limit ja fez isso) derrubaria o processo antes de o
// tratamento existir, e o log sairia sem contexto nenhum.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'promise rejeitada sem tratamento');
});

async function main() {
  // Falha aqui e falha de boot, nao de request: melhor nao subir do que subir
  // sem banco e devolver 500 para todo mundo ate alguem perceber.
  // GUARDA: sql-cru-auditado — `SELECT 1` nao le tabela nenhuma; roda antes de existir requisicao, e nao ha tenant a isolar.
  await runUnscoped('boot-db-check', () => prisma.$queryRaw`SELECT 1`);
  logger.info('banco de dados acessível');

  await connectRedis();

  const app = createApp();
  const httpServer = createServer(app);

  setupRealtime(httpServer);
  if (env.ENABLE_CRON) startJobs();

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, appEnv: env.APP_ENV }, 'api no ar');
  });

  // Encerramento gracioso: sem isso, um deploy corta requisicao em voo e o
  // cliente ve erro de rede num POST que talvez tenha sido gravado.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'encerrando');

    const forced = setTimeout(() => {
      logger.error('encerramento demorou demais — saindo a força');
      process.exit(1);
    }, 15_000);
    forced.unref();

    stopJobs();
    await closeRealtime();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await disconnectRedis();
    await encerrarPoolDeSenha();
    await prisma.$disconnect();

    logger.info('encerrado');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    // Estado do processo e desconhecido depois disso. Registra e sai: seguir
    // rodando um processo possivelmente corrompido e como servir dado errado.
    logger.fatal({ err }, 'exceção não capturada — encerrando');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'falha ao iniciar a API');
  process.exit(1);
});
