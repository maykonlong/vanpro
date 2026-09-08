// api/src/services/RoutingService.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Coordinate {
  latitude: number;
  longitude: number;
}

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || null;

export class RoutingService {
  /**
   * Resolve o Problema do Caixeiro Viajante (TSP) para uma Frota
   * utilizando a API oficial do Google Directions (Waypoints Optimization)
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

    if (!GOOGLE_MAPS_KEY) {
      console.warn('⚠️ [GOOGLE_MAPS_MOCK] GOOGLE_MAPS_KEY não encontrada. Simulando otimização via Haversine matemático...');
      
      const sortedRoute = validStops.sort((a, b) => {
        const distA = this.getDistanceFromLatLonInKm(company.latitude!, company.longitude!, a.latitude!, a.longitude!);
        const distB = this.getDistanceFromLatLonInKm(company.latitude!, company.longitude!, b.latitude!, b.longitude!);
        return distA - distB;
      });

      return {
        success: true,
        provider: "Haversine_Math_Mock",
        totalStops: sortedRoute.length,
        route: sortedRoute
      };
    }

    console.log(`📡 Chamando Google Directions API para roteirizar ${validStops.length} paradas com tráfego em tempo real...`);
    
    try {
      // Montando a URL do Google Maps com Optimize Waypoints = true
      const origin = `${company.latitude},${company.longitude}`;
      const destination = origin; // Volta para a garagem
      const waypoints = validStops.map(s => `${s.latitude},${s.longitude}`).join('|');
      
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=optimize:true|${waypoints}&key=${GOOGLE_MAPS_KEY}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK") {
        throw new Error(`Google API Erro: ${data.status}`);
      }

      // O Google retorna o 'waypoint_order' com a sequência exata e mais rápida (TSP Resolvido)
      const optimizedOrder = data.routes[0].waypoint_order;
      const optimizedStops = optimizedOrder.map((index: number) => validStops[index]);

      return {
        success: true,
        provider: "Google_Maps_Directions",
        totalStops: optimizedStops.length,
        route: optimizedStops,
        googleData: data.routes[0] // Contém as polylines para desenhar no mapa do Front
      };
    } catch (error) {
      console.error('Erro na Roteirização Google Maps:', error);
      throw error;
    }
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
