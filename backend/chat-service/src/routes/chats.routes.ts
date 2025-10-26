import { Router, Request, Response } from "express";
import { authenticateUser } from "./authorization";
import { fetchChats, postChat, isParticipant } from "../services/chats.service";

const router = Router();

// GET /sessions/:sessionId/chats?since=...
router.get(
  "/:sessionId/chats",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { since } = req.query as { since?: string };
      const currentUser = (req as any).user?.id;
      if (!currentUser) return res.status(401).json({ error: "Unauthorized" });

      const participant = await isParticipant(sessionId, currentUser);
      if (!participant) return res.status(403).json({ error: "Forbidden" });

      const chats = await fetchChats(sessionId, since);
      res.json(chats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /sessions/:sessionId/chats
router.post(
  "/:sessionId/chats",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { content, role, metadata } = req.body as {
        content?: string;
        role?: string;
        metadata?: any;
      };
      const currentUser = (req as any).user?.id;
      if (!currentUser) return res.status(401).json({ error: "Unauthorized" });

      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Invalid content" });
      }

      const participant = await isParticipant(sessionId, currentUser);
      if (!participant) return res.status(403).json({ error: "Forbidden" });

      const chat = await postChat(
        sessionId,
        currentUser,
        content,
        role,
        metadata
      );
      res.json(chat);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
