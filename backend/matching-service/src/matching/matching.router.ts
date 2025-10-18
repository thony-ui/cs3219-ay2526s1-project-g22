import { Router } from 'express';
import { matchingController } from './matching.controller';

const router = Router();

// Get user preferences
router.get('/preferences/:userId', matchingController.getUserPreferences);

// Set or update user preferences
// The body should contain { topics: string[], difficulty: "easy" | "medium" | "hard" }
// e.g., { topics: ["algorithms", "data-structures"], difficulty: "medium" }
router.post('/preferences/:userId', matchingController.setUserPreferences);

// Add user to matching queue
router.post('/queue/:userId', matchingController.addToQueue);

// Remove user from matching queue
router.delete('/queue/:userId', matchingController.removeFromQueue);

// Remove matches for all user involved (e.g., after a session ends)
router.delete('/matches/:matchId', matchingController.clearMatches);

export default router;