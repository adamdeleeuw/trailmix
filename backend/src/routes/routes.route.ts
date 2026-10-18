import { Router } from 'express';
import { planChainedRoute } from '../controllers/routes.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/routes

router.post('/chained', requireSession, planChainedRoute);

export default router;