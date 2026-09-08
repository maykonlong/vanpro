import { Router } from 'express';
import { getVehicles, createVehicle, updateVehicleKm } from '../controllers/vehicleController';

const router = Router();

router.get('/', getVehicles);
router.post('/', createVehicle);
router.patch('/:id/km', updateVehicleKm);

export default router;
