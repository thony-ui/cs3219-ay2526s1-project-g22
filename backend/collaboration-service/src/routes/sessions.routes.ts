import { Router, Request, Response } from "express";
import {
  createSession,
  getSessionById,
  updateSessionSnapshot,
  completeSession,
} from "../services/sessions.service";

type CreateSessionBody = {
  interviewer_id: string;
  interviewee_id: string;
  initial_code?: string;
};

type UpdateSnapshotBody = {
  code: string;
};

type SessionParams = {
  id: string;
};
const router = Router();

// Middleware stub: replace with actual JWT validation (talks to User Service)
function authMiddleware(req: Request, res: Response, next: any) {
  // For MVP, simulate user id from header (e.g., "x-user-id")
  const userId = req.header("x-user-id");
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  req.userId = userId;
  next();
}

// create a new session
router.post(
  "/",
  authMiddleware,
  async (req: Request<{}, {}, CreateSessionBody>, res: Response) => {
    try {
      const currentUser = req.userId;
      if (!currentUser) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { interviewer_id, interviewee_id, initial_code = "" } = req.body;
      if (!interviewer_id || !interviewee_id) {
        return res.status(400).json({ error: "Missing Participants" });
      }

      const session = await createSession(
        interviewer_id,
        interviewee_id,
        initial_code
      );
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// get session by ID
router.get("/:id", async (req: Request<SessionParams>, res: Response) => {
  try {
    const { id } = req.params;
    const session = await getSessionById(id);
    res.json(session);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// update the code in the current session
router.patch(
  "/:id/snapshot",
  async (
    req: Request<SessionParams, {}, UpdateSnapshotBody>,
    res: Response
  ) => {
    try {
      const { id } = req.params;
      const { code } = req.body;

      if (typeof code !== "string") {
        return res.status(400).json({ error: "Missing or invalid code" });
      }

      const session = await updateSessionSnapshot(id, code);
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// mark session as completed
router.patch(
  "/:id/complete",
  async (req: Request<SessionParams>, res: Response) => {
    try {
      const { id } = req.params;
      const session = await completeSession(id);
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
