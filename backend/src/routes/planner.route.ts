import { Router } from 'express';
import { planRoute } from '../controllers/planner.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // Planner endpoints under /api/routes

router.post('/plan', requireSession, planRoute); // Express 5 sends a rejected async handler to the error handler

export default router;