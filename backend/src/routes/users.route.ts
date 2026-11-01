import { Router } from 'express';
import {
  createParkingSpot,
  editParkingSpot,
  getMyParkingSpots,
  removeParkingSpot,
} from '../controllers/parking-spots.controller';
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
router.get('/me/parking-spots', requireSession, (req, res, next) => {
  getMyParkingSpots(req, res).catch((err: unknown) => {
    next(err);
  });
});
router.post('/me/parking-spots', requireSession, (req, res, next) => {
  createParkingSpot(req, res).catch((err: unknown) => {
    next(err);
  });
});
router.put('/me/parking-spots/:id', requireSession, (req, res, next) => {
  editParkingSpot(req, res).catch((err: unknown) => {
    next(err);
  });
});
router.delete('/me/parking-spots/:id', requireSession, (req, res, next) => {
  removeParkingSpot(req, res).catch((err: unknown) => {
    next(err);
  });
});

export default router;
