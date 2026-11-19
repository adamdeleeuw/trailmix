import { Router } from 'express';
import { planRoute } from '../controllers/planner.controller';
import { limitPerUser } from '../middleware/rate-limit.middleware';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // Planner endpoints under /api/routes

router.post('/plan', requireSession, limitPerUser('plansPerUserMinute', 'plansPerUserDay'), planRoute); // Express 5 sends a rejected async handler to the error handler

export default router;