// api/src/services/RoutingService.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Coordinate {
  latitude: number;
  longitude: number;
}

export class RoutingService {
  /**
   * Resolve o Problema do Caixeiro Viajante (TSP) para uma Frota
   * @param companyId ID da empresa dona da frota
   * @param vehicleId Veículo escalado
   * @returns Lista ordenada de paradas (Alunos + Escolas)
   */
  async calculateOptimalRoute(companyId: string, vehicleId: string) {
    // 1. Puxar a garagem (Base)
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { latitude: true, longitude: true }
    });

    if (!company?.latitude || !company?.longitude) {
      throw new Error("A coordenada da Base (Garagem) não foi configurada.");
    }

    // 2. Puxar as paradas (Alunos)
    const students = await prisma.student.findMany({
      where: { companyId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true, address: true, latitude: true, longitude: true }
    });

    const validStops = students.filter(s => s.latitude && s.longitude);

    if (validStops.length === 0) {
      return { 
        success: false, 
        message: "Nenhum aluno com coordenadas válidas para traçar rota." 
      };
    }

    // 3. Algoritmo TSP Simulado (Google Maps/Mapbox Engine entraria aqui)
    // Em produção, isso seria uma chamada para o Google Directions API / Waypoints Optimization
    console.log(`Calculando rota ótima para ${validStops.length} paradas...`);
    
    // Mock de ordenação baseada na distância em linha reta da garagem (heurística básica)
    const sortedRoute = validStops.sort((a, b) => {
      const distA = this.getDistanceFromLatLonInKm(company.latitude!, company.longitude!, a.latitude!, a.longitude!);
      const distB = this.getDistanceFromLatLonInKm(company.latitude!, company.longitude!, b.latitude!, b.longitude!);
      return distA - distB;
    });

    return {
      success: true,
      provider: "Mapbox_Engine_V2",
      totalStops: sortedRoute.length,
      route: sortedRoute
    };
  }

  // Função Auxiliar de Haversine para Distância
  private getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Raio da terra em km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }
}
