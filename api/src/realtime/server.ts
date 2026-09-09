import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { runUnscoped } from '../lib/request-context';
import { verifyAccessToken, cookieNames } from '../modules/auth/session.service';
import { setSocketServer } from './emitter';

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

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token = cookies[cookieNames.ACCESS_COOKIE];
      if (!token) return next(new Error('não autenticado'));

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
        return next(new Error('sessão encerrada'));
      }

      (socket.data as SocketAuth) = {
        userId: claims.sub,
        role: claims.role,
        tenantId: claims.tenantId,
      };
      next();
    } catch {
      next(new Error('não autenticado'));
    }
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

      const belongs = await runUnscoped('ws-vehicle-check', () =>
        prisma.vehicle.findFirst({
          where: { id: vehicleId, companyId: auth.tenantId! },
          select: { id: true },
        }),
      );
      if (!belongs) return;

      void socket.join(`company:${auth.tenantId}:vehicle:${vehicleId}`);
    });

    // Posicao de GPS: so quem dirige publica, e sempre na sala da propria empresa.
    socket.on('vehicle:position', async (payload: unknown) => {
      if (auth.role !== 'DRIVER' && auth.role !== 'OWNER' && auth.role !== 'MANAGER') return;
      const p = payload as { vehicleId?: string; latitude?: number; longitude?: number };
      if (
        typeof p?.vehicleId !== 'string' ||
        typeof p.latitude !== 'number' ||
        typeof p.longitude !== 'number' ||
        Math.abs(p.latitude) > 90 ||
        Math.abs(p.longitude) > 180
      ) {
        return;
      }

      const belongs = await runUnscoped('ws-vehicle-check', () =>
        prisma.vehicle.findFirst({
          where: { id: p.vehicleId, companyId: auth.tenantId! },
          select: { id: true },
        }),
      );
      if (!belongs) return;

      io?.to(`company:${auth.tenantId}:vehicle:${p.vehicleId}`).emit('vehicle:position', {
        vehicleId: p.vehicleId,
        latitude: p.latitude,
        longitude: p.longitude,
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
