import { prisma } from '../../config/database';

export class FleetService {
  static async getVehiclesOverview(tenantId: string) {
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId, active: true },
      include: {
        driver: { select: { id: true, name: true, phone: true } },
        maintenances: { orderBy: { performedAt: 'desc' }, take: 1 },
        fuelLogs: { orderBy: { filledAt: 'desc' }, take: 3 },
      },
    });

    return vehicles.map((v) => {
      const lastMaintenance = v.maintenances[0];
      const kmUntilNextService = lastMaintenance?.nextDueKm
        ? lastMaintenance.nextDueKm - v.currentKm
        : null;

      const needsService = kmUntilNextService !== null && kmUntilNextService <= 1000;

      return {
        id: v.id,
        name: v.name,
        plate: v.plate,
        model: v.model,
        capacity: v.capacity,
        currentKm: v.currentKm,
        avgKmPerLiter: v.avgKmPerLiter,
        driver: v.driver,
        lastMaintenance: lastMaintenance ? {
          description: lastMaintenance.description,
          cost: Number(lastMaintenance.cost),
          date: lastMaintenance.performedAt,
        } : null,
        kmUntilNextService,
        alerts: {
          needsService,
          warningMessage: needsService ? `Revisão necessária em ${kmUntilNextService} km!` : null,
        },
      };
    });
  }

  static async logFuel(tenantId: string, vehicleId: string, data: { kmAtFill: number; liters: number; pricePerLiter: number; stationName?: string }) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId } });
    if (!vehicle) throw new Error('Veículo não encontrado');

    const totalCost = data.liters * data.pricePerLiter;
    const distanceTraveled = data.kmAtFill - vehicle.currentKm;
    const calculatedKmPerLiter = distanceTraveled > 0 ? Number((distanceTraveled / data.liters).toFixed(2)) : vehicle.avgKmPerLiter;

    // Atualizar odômetro e média da van
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        currentKm: data.kmAtFill,
        avgKmPerLiter: calculatedKmPerLiter,
      },
    });

    // Registrar abastecimento
    const fuelLog = await prisma.fuelLog.create({
      data: {
        tenantId,
        vehicleId,
        kmAtFill: data.kmAtFill,
        liters: data.liters,
        pricePerLiter: data.pricePerLiter,
        totalCost,
        stationName: data.stationName,
        calculatedKmPerLiter,
      },
    });

    // Lançar despesa no financeiro
    await prisma.financialTransaction.create({
      data: {
        tenantId,
        vehicleId,
        type: 'EXPENSE',
        category: 'FUEL',
        description: `Abastecimento Diesel - ${data.liters}L (${vehicle.plate})`,
        amount: totalCost,
        dueDate: new Date(),
        paymentDate: new Date(),
        paid: true,
        referenceMonth: new Date().toISOString().substring(0, 7),
      },
    });

    return fuelLog;
  }
}
