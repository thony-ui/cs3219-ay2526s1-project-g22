import express from 'express';
import matchingRouter from './matching/matching.router';
import config from './config';
import { logger } from './utils/logger';
const app = express();

app.use(express.json()); // Enable JSON body parsing

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('Matching service is running!');
});

// Matching service routes
app.use('/api/matching', matchingRouter);

const startServer = async () => {

    app.listen(config.port, () => {
        logger.info(`Matching service listening on port ${config.port}`);
        logger.info(`Supabase URL: ${config.supabase.url ? 'Configured' : 'Not configured'}`);
        logger.info(`Redis Host: ${config.redis.host}, Port: ${config.redis.port}`);
    });
};

startServer();