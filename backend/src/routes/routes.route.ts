import { Router } from 'express';
import { planChainedRoute } from '../controllers/routes.controller';
// import { requireSession } from '../middleware/require-session.middleware'; #DO NOT COMMIT, TEMP

const router = Router(); // routes under /api/routes

router.post('/chained', planChainedRoute); // ADD REQUIRESESSION BACK LATER

export default router;