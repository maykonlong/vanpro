import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Conexao Redis compartilhada (rate limit distribuido + fanout de websocket).
 *
 * `lazyConnect` + retry limitado: a API precisa subir mesmo com o Redis fora do
 * ar. Rate limit sem Redis degrada para contagem em memoria; API que nao sobe
 * porque o Redis piscou e indisponibilidade auto-infligida.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
});

let healthy = false;

redis.on('ready', () => {
  healthy = true;
  logger.info('redis conectado');
});
redis.on('error', (err) => {
  healthy = false;
  logger.warn({ err: err.message }, 'redis indisponível — rate limit cai para memória local');
});
redis.on('end', () => {
  healthy = false;
});

export function redisHealthy(): boolean {
  return healthy;
}

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
  } catch (err) {
    logger.warn({ err }, 'não foi possível conectar ao redis no boot — seguindo degradado');
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
