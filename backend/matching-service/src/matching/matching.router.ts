import { Router } from 'express';
import { matchingController } from './matching.controller';

const router = Router();

// Get matches for a user
router.get('/matches/:userId', matchingController.getMatches);

// Get user preferences
router.get('/preferences/:userId', matchingController.getUserPreferences);

// Set or update user preferences
// The body should contain { topics: string[], difficulty: "easy" | "medium" | "hard" }
// e.g., { topics: ["algorithms", "data-structures"], difficulty: "medium" }
router.post('/preferences/:userId', matchingController.setUserPreferences);

export default router;