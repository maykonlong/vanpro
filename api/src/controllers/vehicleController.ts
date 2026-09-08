import { Request, Response } from 'express';
import { prisma } from '../prisma';

export const getVehicles = async (req: Request, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany();
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar veículos' });
  }
};

export const createVehicle = async (req: Request, res: Response) => {
  try {
    const { plate, capacity } = req.body;
    const vehicle = await prisma.vehicle.create({
      data: { plate, capacity },
    });
    res.status(201).json(vehicle);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar veículo' });
  }
};

export const updateVehicleKm = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { km } = req.body;
    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: { km },
    });
    res.json(vehicle);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar KM' });
  }
};
