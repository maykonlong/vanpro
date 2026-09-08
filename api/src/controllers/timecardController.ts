import { Request, Response } from 'express';
import { prisma } from '../prisma';

export const getTimecards = async (req: Request, res: Response) => {
  try {
    const timecards = await prisma.timecard.findMany({ include: { punches: true, driver: true } });
    res.json(timecards);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar cartões de ponto' });
  }
};

export const punchTimecard = async (req: Request, res: Response) => {
  try {
    const { driverId, vehicleId, type, km } = req.body;
    
    // Find active timecard or create one
    let timecard = await prisma.timecard.findFirst({
      where: { driverId, status: 'IN_PROGRESS' }
    });

    if (!timecard) {
      timecard = await prisma.timecard.create({
        data: { driverId, vehicleId }
      });
    }

    // Add punch
    await prisma.punch.create({
      data: { timecardId: timecard.id, type, km }
    });

    if (type === 'CLOCK_OUT') {
      await prisma.timecard.update({
        where: { id: timecard.id },
        data: { status: 'COMPLETED' }
      });
    }

    res.json(timecard);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar ponto' });
  }
};
