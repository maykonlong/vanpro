import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Conexao Redis compartilhada (rate limit distribuido + fanout de websocket).
 *
 * `lazyConnect` + retry limitado: a API precisa subir mesmo com o Redis fora do
 * ar. Rate limit sem Redis degrada para contagem em memoria; API que nao sobe
 * porque o Redis piscou e indisponibilidade auto-infligida.
 *
 * `commandTimeout` e a parte que faltava, e a ausencia dela foi medida:
 * congelando o container (`docker pause`), `/health/ready` e `/students`
 * deixaram de responder em 3 de 3 tentativas com 20s de espera, enquanto a
 * pagina estatica seguia em 200. A degradacao graciosa que o comentario acima
 * promete valia para Redis CAIDO — a recusa de conexao dispara `error` na hora
 * e `healthy` vira falso. Nao valia para Redis LENTO ou particionado: sem
 * timeout de comando, a promessa nunca resolve, o `await` fica pendurado e a
 * requisicao HTTP inteira morre esperando.
 *
 * Rede lenta e o modo de falha MAIS comum dos dois, e era o unico nao coberto.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  // 2s: o rate limit e caminho quente. Se o Redis nao respondeu nesse tempo, a
  // resposta certa e seguir sem ele — nao esperar mais.
  commandTimeout: 2_000,
  connectTimeout: 3_000,
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

/**
 * `PING` com teto proprio de tempo.
 *
 * `commandTimeout` ja cobre o caso geral, mas a sonda de prontidao e consultada
 * por orquestrador com paciencia curta: deixar que ela dependa do teto global
 * significaria a sonda demorar o dobro do que o orquestrador espera e o
 * conteiner ser reiniciado por causa do cache. O teto daqui e menor de
 * proposito.
 */
export async function redisPingRapido(timeoutMs = 1_000): Promise<boolean> {
  if (!healthy) return false;
  try {
    const resposta = await Promise.race([
      redis.ping(),
      new Promise<never>((_, rejeitar) =>
        setTimeout(() => rejeitar(new Error('ping do redis excedeu o tempo')), timeoutMs).unref(),
      ),
    ]);
    return resposta === 'PONG';
  } catch (err) {
    logger.warn({ err }, 'redis não respondeu ao ping dentro do tempo');
    return false;
  }
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
