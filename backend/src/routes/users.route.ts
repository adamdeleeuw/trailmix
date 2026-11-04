import { Router } from 'express';
import {
  createParkingSpot,
  editParkingSpot,
  getMyParkingSpots,
  removeParkingSpot,
} from '../controllers/parking-spots.controller';
import { changeTripStatus, createTrip, getMyTrips, removeTrip } from '../controllers/trips.controller';
import { deleteMe, getMe, saveGasPrice, savePlanningPreferences, saveProfile } from '../controllers/users.controller';
import { requireSession } from '../middleware/require-session.middleware';

const router = Router(); // routes under /api/users

// Express 5 sends a rejected async handler to the error handler, so handlers need no wrapper
router.get('/me', requireSession, getMe);
router.put('/me/profile', requireSession, saveProfile);
router.put('/me/planning-preferences', requireSession, savePlanningPreferences);
router.put('/me/gas-price', requireSession, saveGasPrice);
router.delete('/me', requireSession, deleteMe);
router.get('/me/trips', requireSession, getMyTrips);
router.post('/me/trips', requireSession, createTrip);
router.patch('/me/trips/:id', requireSession, changeTripStatus);
router.delete('/me/trips/:id', requireSession, removeTrip);
router.get('/me/parking-spots', requireSession, getMyParkingSpots);
router.post('/me/parking-spots', requireSession, createParkingSpot);
router.put('/me/parking-spots/:id', requireSession, editParkingSpot);
router.delete('/me/parking-spots/:id', requireSession, removeParkingSpot);

export default router;
