import { Router } from 'express';
import { getStudents, createStudent, checkinStudent } from '../controllers/studentController';

const router = Router();

router.get('/', getStudents);
router.post('/', createStudent);
router.patch('/:id/checkin', checkinStudent);

export default router;
