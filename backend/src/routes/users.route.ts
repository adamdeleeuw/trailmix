import { Router } from 'express';
import { deleteMe, getMe, getMyTrips, saveGasPrice, saveProfile } from '../controllers/users.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/users

router.get('/me', requireSession, getMe);
router.get('/me/trips', requireSession, getMyTrips);
router.put('/me/profile', requireSession, saveProfile);
router.put('/me/gas-price', requireSession, saveGasPrice);
router.delete('/me', requireSession, deleteMe);

export default router;
