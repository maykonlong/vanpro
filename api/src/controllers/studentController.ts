import { Request, Response } from 'express';
import { prisma } from '../prisma';

export const getStudents = async (req: Request, res: Response) => {
  try {
    const { shift } = req.query;
    const filter = shift ? { shift: String(shift) } : {};
    
    const students = await prisma.student.findMany({ where: filter });
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar alunos' });
  }
};

export const createStudent = async (req: Request, res: Response) => {
  try {
    const { name, school, shift, monthlyFee, parentId } = req.body;
    const student = await prisma.student.create({
      data: { name, school, shift, monthlyFee, parentId },
    });
    res.status(201).json(student);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar aluno' });
  }
};

export const checkinStudent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // BOARDED, DELIVERED, ABSENT
    
    const student = await prisma.student.update({
      where: { id },
      data: { status },
    });
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao realizar checkin' });
  }
};
