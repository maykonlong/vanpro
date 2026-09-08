import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

// Queue Configuration: Timeout e Backoff Global
export const emailQueue = new Queue('email-queue', { 
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000 // Tenta em 2s, 4s, 8s...
    },
    removeOnComplete: true, // Mantém o Redis limpo
    removeOnFail: false // Mantém na fila de falhas (DLQ) para análise
  }
});

// Consumer: Processa a fila em background
const emailWorker = new Worker('email-queue', async (job: Job) => {
  logger.info(`📧 Iniciando envio de email [Job: ${job.id}]: ${job.data.subject}`);
  
  // Timeout interno de proteção (Graceful degradation)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s Timeout

  try {
    // Simulação de chamada externa de e-mail (ex: SendGrid)
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Se a chamada real for HTTP: await fetch('...', { signal: controller.signal })
    
    logger.info(`✅ Email enviado com sucesso [Job: ${job.id}]`);
  } finally {
    clearTimeout(timeoutId);
  }
}, { connection, concurrency: 5 }); // Processa até 5 emails em paralelo

emailWorker.on('failed', (job, err) => {
  if (job?.attemptsMade === job?.opts.attempts) {
    logger.error(`💀 DEAD LETTER: Job ${job?.id} esgotou as 3 tentativas. Movendo para revisão manual. Erro: ${err.message}`);
    // Aqui um webhook ou alerta de Slack seria disparado para a equipe de DevOps
  } else {
    logger.warn(`⚠️ Falha temporária no Job ${job?.id} (Tentativa ${job?.attemptsMade}). Retentando... Erro: ${err.message}`);
  }
});
