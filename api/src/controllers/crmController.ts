import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

// 1. Criar Nota Interna (Post-it Oculto)
export const createNote = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { studentId, content, isSecret } = req.body;

    if (user.role === 'PARENT') {
      return res.status(403).json({ error: 'Pais não podem criar notas.' });
    }

    const note = await prisma.note.create({
      data: {
        content,
        isSecret: isSecret ?? true,
        studentId,
        authorId: user.id,
        companyId: user.tenantId
      },
      include: { author: { select: { name: true } } }
    });

    res.status(201).json(note);
  } catch (error) {
    logger.error(`Create Note Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao criar nota.' });
  }
};

// 2. Buscar Notas de um Aluno
export const getStudentNotes = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { studentId } = req.params;

    // Se for PAI, só pode ver notas públicas (isSecret = false)
    const secretFilter = user.role === 'PARENT' ? { isSecret: false } : {};

    const notes = await prisma.note.findMany({
      where: {
        studentId,
        companyId: user.tenantId,
        ...secretFilter
      },
      include: { author: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' }
    });

    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar notas.' });
  }
};

// 3. Disparar Incidente / Push Alert
export const broadcastIncident = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { title, description, severity } = req.body;

    if (user.role === 'PARENT') return res.status(403).json({ error: 'Acesso negado' });

    const incident = await prisma.incidentAlert.create({
      data: {
        title,
        description,
        severity: severity || 'MEDIUM',
        companyId: user.tenantId
      }
    });

    logger.info(`[URGENTE] Incidente "${title}" emitido na empresa ${user.tenantId}`);
    
    // AQUI: Integração Futura com FCM (Firebase) ou Socket.io para apitar no celular dos pais.

    res.status(201).json({ message: 'Alerta disparado para todos os pais com sucesso!', incident });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar incidente.' });
  }
};

// 4. Histórico de Mensagens da Equipe (Chat)
export const getTeamMessages = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    if (user.role === 'PARENT') return res.status(403).json({ error: 'Pais não participam deste chat.' });

    const messages = await prisma.teamMessage.findMany({
      where: { companyId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar histórico do chat.' });
  }
};

// 5. Enviar Mensagem no Chat
export const sendTeamMessage = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { content } = req.body;

    if (user.role === 'PARENT') return res.status(403).json({ error: 'Proibido' });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });

    const message = await prisma.teamMessage.create({
      data: {
        content,
        senderId: user.id,
        senderName: dbUser?.name || 'Membro da Equipe',
        companyId: user.tenantId
      }
    });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
};
