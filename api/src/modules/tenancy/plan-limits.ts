import { prisma } from '../../lib/prisma';
import { runUnscoped } from '../../lib/request-context';
import { Errors } from '../../lib/errors';

/**
 * Limites do plano.
 *
 * Checagem feita no servidor, na hora da escrita. Esconder o botao no front e
 * UX; o limite so existe de verdade quando o POST e recusado.
 */

export type LimitedResource = 'vehicles' | 'drivers' | 'students';

const FIELD: Record<LimitedResource, 'maxVehicles' | 'maxDrivers' | 'maxStudents'> = {
  vehicles: 'maxVehicles',
  drivers: 'maxDrivers',
  students: 'maxStudents',
};

const LABEL: Record<LimitedResource, string> = {
  vehicles: 'veículos',
  drivers: 'motoristas',
  students: 'alunos',
};

export async function assertPlanLimit(companyId: string, resource: LimitedResource): Promise<void> {
  const company = await runUnscoped('plan-limit', () =>
    prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: { select: { maxVehicles: true, maxDrivers: true, maxStudents: true } } },
    }),
  );
  if (!company) throw Errors.notFound('Empresa');

  const limit = company.plan[FIELD[resource]];

  const current = await runUnscoped('plan-limit-count', async () => {
    switch (resource) {
      case 'vehicles':
        return prisma.vehicle.count({ where: { companyId, deletedAt: null } });
      case 'drivers':
        return prisma.driver.count({ where: { companyId, status: 'ACTIVE' } });
      case 'students':
        return prisma.student.count({ where: { companyId, deletedAt: null } });
    }
  });

  if (current >= limit) throw Errors.planLimit(LABEL[resource], limit);
}

export async function planUsage(companyId: string) {
  return runUnscoped('plan-usage', async () => {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        tenantStatus: true,
        trialEndsAt: true,
        plan: { select: { name: true, maxVehicles: true, maxDrivers: true, maxStudents: true, priceCents: true } },
      },
    });
    if (!company) throw Errors.notFound('Empresa');

    const [vehicles, drivers, students] = await Promise.all([
      prisma.vehicle.count({ where: { companyId, deletedAt: null } }),
      prisma.driver.count({ where: { companyId, status: 'ACTIVE' } }),
      prisma.student.count({ where: { companyId, deletedAt: null } }),
    ]);

    return {
      plan: company.plan.name,
      status: company.tenantStatus,
      trialEndsAt: company.trialEndsAt,
      usage: {
        vehicles: { used: vehicles, limit: company.plan.maxVehicles },
        drivers: { used: drivers, limit: company.plan.maxDrivers },
        students: { used: students, limit: company.plan.maxStudents },
      },
    };
  });
}
