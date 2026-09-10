import type { Server } from 'socket.io';
import { logger } from '../lib/logger';

/**
 * Ponte entre o mundo HTTP e o Socket.io.
 *
 * O `Server` e injetado no boot em vez de importado: o controller nao pode
 * depender do arquivo que sobe o servidor (ciclo de import) nem falhar em
 * teste, onde nao ha socket algum.
 *
 * Toda sala e prefixada pelo companyId. Sala global (`vehicle:<id>`, como na
 * versao anterior) entregava posicao de van e alerta de incidente para
 * qualquer cliente que adivinhasse o id — vazamento entre empresas por
 * omissao de prefixo.
 */

let io: Server | null = null;

export function setSocketServer(server: Server): void {
  io = server;
}

/** Exposto para teste e para health-check saber se o realtime esta de pe. */
export function isRealtimeReady(): boolean {
  return io !== null;
}

export function companyRoom(companyId: string): string {
  return `company:${companyId}`;
}

export function vehicleRoom(companyId: string, vehicleId: string): string {
  return `company:${companyId}:vehicle:${vehicleId}`;
}

function emit(room: string, event: string, payload: unknown): void {
  if (!io) {
    // Broadcast e efeito colateral, nunca requisito da requisicao: derrubar um
    // POST porque o websocket nao subiu troca uma degradacao por uma falha.
    logger.debug({ room, event }, 'socket não inicializado; evento descartado');
    return;
  }
  io.to(room).emit(event, payload);
}

export function emitToCompany(companyId: string, event: string, payload: unknown): void {
  emit(companyRoom(companyId), event, payload);
}

export function emitToVehicle(
  companyId: string,
  vehicleId: string,
  event: string,
  payload: unknown,
): void {
  emit(vehicleRoom(companyId, vehicleId), event, payload);
}
