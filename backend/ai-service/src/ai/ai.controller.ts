import openrouter from '../services/openRouter.service';
import { Request, Response } from "express";

class AiController {
  async handleChat(req: Request, res: Response) {
      try {
          const {message} = req.body;

          if (!message) {
              return res.status(400).json({error: 'Message is required'});
          }

          // TODO: rate limit based on userId

          const response = await openrouter.getChatResponse(message);

          res.json({response});
      } catch (error) {
          console.error('Error handling chat:', error);
          res.status(500).json({error: 'Internal Server Error'});
      }
  }
}

export const aiController = new AiController();