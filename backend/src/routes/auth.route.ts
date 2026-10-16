import { Router } from 'express';
import { signInWithGoogle, signOut } from '../controllers/auth.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/auth

router.post('/google', signInWithGoogle);
router.post('/sign-out', requireSession, signOut);

export default router;
