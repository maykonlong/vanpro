import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  createNote,
  getStudentNotes,
  broadcastIncident,
  getTeamMessages,
  sendTeamMessage
} from '../controllers/crmController';

const router = Router();

// --- Notas Ocultas ---
router.post('/students/:studentId/notes', createNote);
router.get('/students/:studentId/notes', getStudentNotes);

// --- Incidentes & Alertas Push ---
router.post('/incidents/broadcast', broadcastIncident);

// --- Chat da Equipe B2B ---
router.get('/chat/messages', getTeamMessages);
router.post('/chat/messages', sendTeamMessage);

export default router;
