import { Router } from 'express';
import { planLegacyChainedRoute, planRoute } from '../controllers/planner.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // Planner endpoints under /api/routes

router.post('/chained', requireSession, planLegacyChainedRoute);
router.post('/plan', requireSession, (req, res, next) => {
  planRoute(req, res).catch(next);
});

export default router;