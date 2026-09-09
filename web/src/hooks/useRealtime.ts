import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Incident, VehiclePosition } from '../lib/types';

/**
 * Socket autenticado pelo mesmo cookie httpOnly da API.
 *
 * `withCredentials` e o que faz o cookie viajar no handshake; sem ele o
 * servidor recusa a conexao. `transports: ['websocket']` casa com o servidor,
 * que desligou o polling.
 */
let shared: Socket | null = null;
let refCount = 0;

function acquire(): Socket {
  if (!shared) {
    shared = io({
      withCredentials: true,
      transports: ['websocket'],
      path: '/socket.io',
    });
  }
  refCount += 1;
  return shared;
}

function release(): void {
  refCount -= 1;
  if (refCount <= 0 && shared) {
    shared.disconnect();
    shared = null;
    refCount = 0;
  }
}

export interface RealtimeState {
  connected: boolean;
  positions: Record<string, VehiclePosition>;
  incidents: Incident[];
}

/**
 * Assina a posicao dos veiculos informados e os incidentes da empresa.
 * Uma lista vazia ainda conecta: incidente vale para todo mundo da empresa.
 */
export function useRealtime(vehicleIds: string[]): RealtimeState {
  const [connected, setConnected] = useState(false);
  const [positions, setPositions] = useState<Record<string, VehiclePosition>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const key = vehicleIds.join(',');
  const idsRef = useRef(vehicleIds);
  idsRef.current = vehicleIds;

  useEffect(() => {
    const socket = acquire();

    const subscribe = () => {
      setConnected(true);
      for (const id of idsRef.current) socket.emit('vehicle:subscribe', id);
    };

    const onPosition = (payload: VehiclePosition) => {
      setPositions((prev) => ({ ...prev, [payload.vehicleId]: payload }));
    };
    const onIncident = (payload: Incident) => {
      setIncidents((prev) => [payload, ...prev].slice(0, 20));
    };
    const onDisconnect = () => setConnected(false);

    if (socket.connected) subscribe();
    socket.on('connect', subscribe);
    socket.on('disconnect', onDisconnect);
    socket.on('vehicle:position', onPosition);
    socket.on('incident:new', onIncident);

    return () => {
      socket.off('connect', subscribe);
      socket.off('disconnect', onDisconnect);
      socket.off('vehicle:position', onPosition);
      socket.off('incident:new', onIncident);
      release();
    };
  }, [key]);

  return { connected, positions, incidents };
}
