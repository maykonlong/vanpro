import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { runUnscoped } from '../lib/request-context';
import { verifyAccessToken, cookieNames } from '../modules/auth/session.service';
import { setSocketServer } from './emitter';
import { redis, redisHealthy } from '../lib/redis';

/**
 * WebSocket autenticado e isolado por empresa.
 *
 * A versao anterior aceitava qualquer conexao e deixava o cliente escolher a
 * sala (`join_vehicle_room` com o id que quisesse). Na pratica, qualquer pessoa
 * com o endereco do socket acompanhava a van de qualquer empresa e via a
 * posicao das criancas em tempo real.
 *
 * Aqui: handshake valida o cookie de sessao, o socket entra APENAS nas salas da
 * propria empresa, e todo `join` e conferido no servidor.
 */

interface SocketAuth {
  userId: string;
  role: string;
  tenantId: string | null;
}

let io: Server | null = null;

/**
 * Extraido do `io.use` de proposito.
 *
 * Enquanto esta decisao morava dentro do middleware do socket.io, ela so era
 * alcancavel abrindo uma conexao WebSocket de verdade — e o resultado pratico
 * foi que o arquivo inteiro ficou com 0% de cobertura: o handshake que decide
 * quem acompanha a van com a crianca dentro nunca tinha sido exercitado por
 * teste nenhum. Como funcao exportada, cada recusa vira caso de teste
 * (`tests/integration/realtime.test.ts`) sem precisar de cliente de socket.
 */
export async function autenticarHandshake(
  cookieHeader: string | undefined,
): Promise<{ ok: true; auth: SocketAuth } | { ok: false; motivo: string }> {
  try {
    const cookies = parseCookies(cookieHeader);
    const token = cookies[cookieNames.ACCESS_COOKIE];
    if (!token) return { ok: false, motivo: 'não autenticado' };

    const claims = verifyAccessToken(token);

    // Sessao revogada precisa derrubar o socket tambem: um socket aberto
    // sobreviveria ao logout ate o processo reiniciar.
    const session = await runUnscoped('ws-session-check', () =>
      prisma.session.findUnique({
        where: { id: claims.sid },
        select: { revokedAt: true, expiresAt: true },
      }),
    );
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return { ok: false, motivo: 'sessão encerrada' };
    }

    return {
      ok: true,
      auth: { userId: claims.sub, role: claims.role, tenantId: claims.tenantId },
    };
  } catch {
    return { ok: false, motivo: 'não autenticado' };
  }
}

/** Papeis que podem PUBLICAR posicao. Quem so acompanha nao publica. */
export function podePublicarPosicao(role: string): boolean {
  return role === 'DRIVER' || role === 'OWNER' || role === 'MANAGER';
}

/** Coordenada plausivel. Fora disso e cliente quebrado ou cliente hostil. */
export function posicaoValida(payload: unknown): payload is {
  vehicleId: string;
  latitude: number;
  longitude: number;
} {
  const p = payload as { vehicleId?: unknown; latitude?: unknown; longitude?: unknown };
  return (
    typeof p?.vehicleId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(p.vehicleId) &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

/**
 * A van pertence a empresa do socket?
 *
 * Esta e a linha que impede alguem de assinar a sala de um veiculo de outra
 * frota — a falha exata da versao anterior, em que o cliente escolhia a sala.
 */
export async function veiculoDaEmpresa(vehicleId: string, tenantId: string): Promise<boolean> {
  const achado = await runUnscoped('ws-vehicle-check', () =>
    prisma.vehicle.findFirst({ where: { id: vehicleId, companyId: tenantId }, select: { id: true } }),
  );
  return Boolean(achado);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(';')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

export function setupRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.FRONTEND_URL, credentials: true, methods: ['GET', 'POST'] },
    // Sem polling: o upgrade duplica a superficie e o front nao precisa dele.
    transports: ['websocket'],
    maxHttpBufferSize: 64 * 1024,
    pingTimeout: 20_000,
  });

  /*
   * Adaptador de Redis: o tempo real atravessa replicas.
   *
   * Sem ele, cada processo so conhece os proprios sockets. Com duas replicas
   * atras do balanceador, a mae conectada na replica A simplesmente NAO recebe
   * a posicao que o motorista publicou na B — metade dos responsaveis perde o
   * mapa da van, de forma intermitente e praticamente impossivel de
   * diagnosticar pelo suporte ("na minha funciona").
   *
   * Nao e melhoria: e pre-requisito da segunda replica. Ligado agora, com uma
   * replica, ele nao muda nada — e e exatamente por isso que este e o momento
   * de ligar, em vez do dia em que alguem duplicar o servico.
   *
   * Duas conexoes proprias, e nao a compartilhada: o modo de inscricao do Redis
   * bloqueia a conexao para comandos normais, entao reusar `redis` aqui mataria
   * o rate limit. `duplicate()` herda a configuracao — inclusive o teto de
   * tempo por comando.
   */
  if (redisHealthy()) {
    const publicador = redis.duplicate();
    const assinante = redis.duplicate();
    io.adapter(createAdapter(publicador, assinante));
    logger.info('tempo real usando Redis — eventos atravessam replicas');
  } else {
    // Degradacao explicita, nao silenciosa: com uma replica o produto funciona
    // igual; com duas, esta linha e o aviso de que metade dos clientes nao
    // recebera evento nenhum.
    logger.warn('Redis indisponível no boot do tempo real — eventos NÃO atravessam réplicas');
  }

  io.use(async (socket, next) => {
    const resultado = await autenticarHandshake(socket.handshake.headers.cookie);
    if (!resultado.ok) return next(new Error(resultado.motivo));
    (socket.data as SocketAuth) = resultado.auth;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const auth = socket.data as SocketAuth;
    if (!auth.tenantId) {
      socket.disconnect(true);
      return;
    }

    void socket.join(`company:${auth.tenantId}`);
    logger.debug({ role: auth.role }, 'socket conectado');

    // Sala de veiculo: o servidor confere que a van e da empresa do socket.
    socket.on('vehicle:subscribe', async (vehicleId: unknown) => {
      if (typeof vehicleId !== 'string' || !/^[0-9a-f-]{36}$/i.test(vehicleId)) return;
      if (!(await veiculoDaEmpresa(vehicleId, auth.tenantId!))) return;

      void socket.join(`company:${auth.tenantId}:vehicle:${vehicleId}`);
    });

    // Posicao de GPS: so quem dirige publica, e sempre na sala da propria empresa.
    socket.on('vehicle:position', async (payload: unknown) => {
      if (!podePublicarPosicao(auth.role)) return;
      if (!posicaoValida(payload)) return;
      if (!(await veiculoDaEmpresa(payload.vehicleId, auth.tenantId!))) return;

      io?.to(`company:${auth.tenantId}:vehicle:${payload.vehicleId}`).emit('vehicle:position', {
        vehicleId: payload.vehicleId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        at: new Date().toISOString(),
      });
    });
  });

  setSocketServer(io);
  return io;
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = null;
}
