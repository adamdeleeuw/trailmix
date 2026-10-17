import { Router } from 'express';
import { getMakes, getModels } from '../controllers/vehicles.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/vehicles

router.get('/makes', requireSession, getMakes);
router.get('/makes/:make/models', requireSession, getModels);

export default router;
