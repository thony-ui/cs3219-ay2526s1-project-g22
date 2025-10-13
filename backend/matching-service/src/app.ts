import express from "express";
import cors from "cors";
import matchingRouter from "./matching/matching.router";
import config from "./config";
import { logger } from "./utils/logger";

const app = express();

// CORS: allow your frontend origin
app.use(
    cors({
        origin: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false, // set to true only if client includes credentials
    })
);

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).send("Matching service is running!");
});

// Matching service routes
app.use("/api/matching", matchingRouter);

const startServer = async () => {
    app.listen(config.port, () => {
        logger.info(`Matching service listening on port ${config.port}`);
        logger.info(
            `Supabase URL: ${config.supabase.url ? "Configured" : "Not configured"}`
        );
        logger.info(`Redis Host: ${config.redis.host}, Port: ${config.redis.port}`);
    });
};

startServer();