import Redis from 'ioredis';
import config from '../config';
import { logger } from '../utils/logger'; // We'll create this later

class RedisService {
    public client: Redis;
    private readonly CACHE_TTL_SECONDS = 3600; // Cache for 1 hour
    private readonly MATCHES_KEY_PREFIX = 'matches';

    constructor() {
        this.client = new Redis({
            host: config.redis.host,
            port: config.redis.port,
        });

        this.client.on('connect', () => {
            logger.info('Connected to Redis');
        });

        this.client.on('error', (err) => {
            logger.error('Redis Error:', err);
        });

        logger.info(`Redis client initialized for ${config.redis.host}:${config.redis.port}`);
    }

    // Generic get method with JSON parsing
    async get<T>(key: string): Promise<T | null> {
        try {
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error(`Error getting from Redis for key ${key}:`, error);
            return null;
        }
    }

    // Fetch all members of a set for a given key
    async getTopics(key: string): Promise<Set<string>> {
        try {
            const members = await this.client.smembers(key);
            return new Set(members);
        } catch (error) {
            logger.error(`Error getting set members from Redis for key ${key}:`, error);
            return new Set();
        }
    }

    // Add user ID to multiple topic sets with TTL
    async setTopics(userId: string, topics: string[], ttlSeconds: number = this.CACHE_TTL_SECONDS): Promise<void> {
        for (const topic of topics) {
            const topicKey = `topic:${topic}`;
            try {
                await this.client.sadd(topicKey, userId);
                await this.client.expire(topicKey, ttlSeconds);
            } catch (error) {
                logger.error(`Error adding user ${userId} to topic set ${topicKey}:`, error);
            }
        }
    }

    // Batch fetch set members for multiple keys using pipeline
    async fetchMembers(keys: string[]): Promise<string[][]> {
        try {
            const pipeline = this.client.pipeline();
            keys.forEach(key => pipeline.smembers(key));
            const results = await pipeline.exec();
            if (!results) {
                logger.warn('Pipeline execution returned no results. Defaulting to empty arrays.');
                return keys.map(() => []);
            }
            return results.map(([err, members]) => {
                if (err) {
                    logger.error(`Error fetching members for key:`, err);
                    return [];
                }
                return members as string[];
            });
        } catch (error) {
            logger.error(`Error executing pipeline for keys ${keys}:`, error);
            return keys.map(() => []);
        }
    }

    // Generic set method with JSON stringification
    async set<T>(key: string, value: T, ttlSeconds: number = this.CACHE_TTL_SECONDS): Promise<void> {
        try {
            await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        } catch (error) {
            logger.error(`Error setting to Redis for key ${key}:`, error);
        }
    }

    // Generic delete method
    async del(key: string): Promise<void> {
        try {
            await this.client.del(key);
        } catch (error) {
            logger.error(`Error deleting from Redis for key ${key}:`, error);
        }
    }

    // --- New Method to Remove Matched Users from Topic Sets ---
    // This does not delete user preferences, only removes them from topic sets
    async removeMatchedUsersFromCache(sourceUserId: string, match: any) {
        try {
            const sourceUserPreferencesKey = `user_preferences:${sourceUserId}`;
            const matchUserPreferencesKey = `user_preferences:${match.userId}`;

            const sourcePreferences = await this.get<{ user_id: string; topics: string[]; difficulty: string }>(sourceUserPreferencesKey);
            const matchPreferences = await this.get<{ user_id: string; topics: string[]; difficulty: string }>(matchUserPreferencesKey);

            if (sourcePreferences) {
                for (const topic of sourcePreferences.topics) {
                    const topicKey = `topic:${topic}`;
                    await this.client.srem(topicKey, match.userId);
                }
            }
            if (matchPreferences) {
                for (const topic of matchPreferences.topics) {
                    const topicKey = `topic:${topic}`;
                    await this.client.srem(topicKey, sourceUserId);
                }
            }
            logger.info(`Removed matched users from cache for ${sourceUserId} and ${match.userId}`);
        } catch (error) {
            logger.error(`Error removing matched users from cache for ${sourceUserId} and ${match.userId}:`, error);
        }
    }

    // --- Method to Add a Match Record ---
    async addMatchToCache(sourceUserId: string, targetUserId: string, matchId: string) {
        try {
            const matchRecord = {
                matchId,
                users: [sourceUserId, targetUserId],
                timestamp: Date.now(),
            };
            const matchKey = `${this.MATCHES_KEY_PREFIX}:${matchId}`;

            // Use a transaction to ensure atomicity
            const transaction = this.client.multi();

            transaction.set(matchKey, JSON.stringify(matchRecord));
            transaction.sadd(`all_match_ids`, matchId);
            transaction.expire(matchKey, this.CACHE_TTL_SECONDS);
            transaction.sadd(`user_matches:${sourceUserId}`, matchId);
            transaction.sadd(`user_matches:${targetUserId}`, matchId);
            transaction.expire(`user_matches:${sourceUserId}`, this.CACHE_TTL_SECONDS);
            transaction.expire(`user_matches:${targetUserId}`, this.CACHE_TTL_SECONDS);
            await transaction.exec();

            logger.info(`Added match record to cache for user ${sourceUserId}`);
        } catch (error) {
            logger.error(`Error adding match record to cache for user ${sourceUserId}:`, error);
        }
    }

    // --- Method to Remove a Match Record ---
    async removeMatchFromCache(matchId: string) {
        try {
            const matchKey = `${this.MATCHES_KEY_PREFIX}:${matchId}`;
            const matchData = await this.get<{ matchId: string; users: string[]; timestamp: number }>(matchKey);
            if (matchData) {
                const transaction = this.client.multi();
                transaction.del(matchKey);
                transaction.srem(`all_match_ids`, matchId);
                for (const userId of matchData.users) {
                    transaction.srem(`user_matches:${userId}`, matchId);
                }
                await transaction.exec();
                logger.info(`Removed match record from cache for match ID ${matchId}`);
            } else {
                logger.warn(`No match data found in cache for match ID ${matchId}`);
            }
        } catch (error) {
            logger.error(`Error removing match record from cache for match ID ${matchId}:`, error);
        }
    }

}

export const redisService = new RedisService();