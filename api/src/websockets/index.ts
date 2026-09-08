import { Server, Socket } from 'socket.io';

export const setupWebSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Novo cliente conectado: ${socket.id}`);

    // Pais e Motoristas se inscrevem na sala do veículo específico
    socket.on('join_vehicle_room', (vehicleId: string) => {
      socket.join(vehicleId);
      console.log(`👤 Cliente ${socket.id} entrou na sala do veículo: ${vehicleId}`);
    });

    // Motorista emite suas coordenadas para a sala do veículo dele
    socket.on('driver_gps_update', (data: { vehicleId: string; lat: number; lng: number }) => {
      // Repassa as coordenadas APENAS para os pais inscritos na sala desse veículo
      io.to(data.vehicleId).emit('gps_update', {
        lat: data.lat,
        lng: data.lng,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      console.log(`❌ Cliente desconectado: ${socket.id}`);
    });
  });
};
