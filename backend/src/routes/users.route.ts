import { Router } from 'express';
import { getMe, saveProfile } from '../controllers/users.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/users

router.get('/me', requireSession, getMe);
router.put('/me/profile', requireSession, saveProfile);

export default router;
