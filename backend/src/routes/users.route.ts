import { Router } from 'express';
import { getMe } from '../controllers/users.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/users

router.get('/me', requireSession, getMe);

export default router;
