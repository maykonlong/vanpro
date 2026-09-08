import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

export const emailQueue = new Queue('email-queue', { connection });

// Consumer: Processa a fila em background (desacoplado do event loop da API)
const emailWorker = new Worker('email-queue', async (job: Job) => {
  logger.info(`📧 Iniciando envio de email [Job: ${job.id}]: ${job.data.subject} para ${job.data.to}`);
  
  // Simula latência de API de terceiro (ex: SendGrid, Resend)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  logger.info(`✅ Email enviado com sucesso [Job: ${job.id}]`);
}, { connection });

emailWorker.on('failed', (job, err) => {
  logger.error(`❌ Falha no job de email ${job?.id}: ${err.message}`);
});
