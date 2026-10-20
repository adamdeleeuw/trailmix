import { Router } from 'express';
import { deleteMe, getMe, getMyTrips, saveGasPrice, saveProfile } from '../controllers/users.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/users

router.get('/me', requireSession, getMe);
router.get('/me/trips', requireSession, getMyTrips);
router.put('/me/profile', requireSession, saveProfile);
// Wrapped so the handler returns void; a rejected promise still reaches the error handler via next.
router.put('/me/gas-price', requireSession, (req, res, next) => {
  saveGasPrice(req, res).catch(next);
});
router.delete('/me', requireSession, (req, res, next) => {
  deleteMe(req, res).catch(next);
});

export default router;
