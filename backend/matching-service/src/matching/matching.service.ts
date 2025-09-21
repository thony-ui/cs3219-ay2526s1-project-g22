import {redisService} from '../services/redis.service';
import {supabaseService} from '../services/supabase.service';
import {logger} from '../utils/logger';
import {UserPreference} from '../types';
import { v4 as uuidv4 } from 'uuid';

export class MatchingService {
    private readonly CACHE_KEY_PREFIX = 'user_match_pref:';

    // --- Get User Preferences with Caching ---
    // First checks Redis cache, if not found, fetches from Supabase and caches it
    // Returns null if user preferences are not found
    async getUserPreference(userId: string): Promise<UserPreference | null> {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${userId}`;
        let preferences: UserPreference | null = await redisService.get(cacheKey);

        if (preferences) {
            logger.info(`Cache hit for user preferences: ${userId}`);
            return preferences;
        }

        logger.info(`Cache miss for user preferences: ${userId}, fetching from Supabase.`);
        preferences = await supabaseService.getUserPreferences(userId);

        if (preferences) {
            await redisService.set(cacheKey, preferences);
        }
        return preferences;
    }

    // --- Helper Function to Get a User's Topics ---
    // Returns a Set of topics for the user
    async getUserTopics(userId: string) {
        let preferences = await this.getUserPreference(userId);
        if (!preferences) {
            logger.info('No preferences found for user:', userId);
            return new Set<string>();
        }

        if (preferences.topics.length === 0) {
            logger.info('User has no topics:', userId);
            return new Set<string>();
        }

        // convert to Set to ensure uniqueness
        return new Set(preferences.topics);
    }

    // --- Fetch Members for Multiple topics ---
    // This function fetches user_ids for multiple topics from Redis.
    // If not found in Redis, it falls back to Supabase and caches the results.
    // Returns an array of arrays, where each inner array contains user_ids for the corresponding topic.
    // If a topic has no members or an error occurs, returns an empty array for that topic.
    async fetchMembers(user_ids: string[]): Promise<string[][]> {
        let queryResult = await redisService.fetchMembers(user_ids);

        if (!queryResult) {
            logger.error('Failed to fetch members for topic keys in cache, trying to find in supabase:', user_ids);
            queryResult = await supabaseService.fetchMembers(user_ids);
            if (!queryResult) {
                logger.error('Failed to fetch members for topic keys in supabase:', user_ids);
                return user_ids.map(() => []); // Return empty arrays on error
            }

            // Cache the results in Redis for future use
            await redisService.saveFetchedMembersToCache(user_ids, queryResult);
        }

        return queryResult
    }

    // --- Queue Management ---
    // These functions manage adding/removing users from the matchmaking queue in Supabase.
    // The function only fetches from Supabase, no caching is done here.
    // This is because the queue state is dynamic and should always be current, and Supabase should be the only source
    // of truth.
    async addToQueue(userId: string) {
        try {
            await supabaseService.addUserToQueue(userId);
        } catch (error) {
            logger.error(`Failed to add user ${userId} to Supabase queue:`, error);
            throw error; // rethrow the error after logging
        }
    }

    async removeFromQueue(userId: string) {
        try {
            await supabaseService.removeUserFromQueue(userId);
        } catch (error) {
            logger.error(`Failed to remove user ${userId} from Supabase queue:`, error);
            throw error; // rethrow the error after logging
        }
    }

    // --- Main Fuzzy Matchmaking Function ---
    // fuzzyPercentage is the minimum percentage of topics that must match, this is calculated based on the source user's topics
    // It counts how many topics the source user has, and then calculates how many topics a match must have in common to be considered a match
    // e.g. if user A has topics [A, B, C, D] and fuzzyPercentage is 0.75, then a match must have at least 3 of these topics
    async findFuzzyMatches(sourceUserId: string, fuzzyPercentage = 0.8) {
        const sourceUserTopics = await this.getUserTopics(sourceUserId);

        if (sourceUserTopics.size === 0) {
            console.log(`User ${sourceUserId} has no topics.`);
            return [];
        }

        const numSourceTopics = sourceUserTopics.size;
        const requiredMatches = Math.ceil(fuzzyPercentage * numSourceTopics);

        console.log(
            `User ${sourceUserId} has ${numSourceTopics} topics. ` +
            `Requires at least ${requiredMatches} matching topics ` +
            `(${fuzzyPercentage * 100}%).`
        );

        // Fetch all users from queue
        const queueMembers: string[] = await this.getQueueMembers();
        if (!queueMembers || queueMembers.length === 0) {
            console.log('No users in the matching queue.');
            return [];
        }

        if (queueMembers.find(id => id === sourceUserId) == undefined) {
            console.log(`User ${sourceUserId} is not in the matching queue.`);
            return [];
        }

        // Fetch members for each topic the source user has
        const results = await this.fetchMembers(Array.from(sourceUserTopics));

        // 'results' will be an array like [['userA', 'userB'], ['userB', 'userC']]
        const userCounts = new Map(); // Map<userId, count>

        for (const result of results) {
            for (const userId of result) {
                if (userId !== String(sourceUserId) && queueMembers.includes(userId)) {
                    // Don't count the source user themselves and only count users in the queue
                    userCounts.set(userId, (userCounts.get(userId) || 0) + 1);
                }
            }
        }

        // Filter candidates based on required match count
        const matches = [];
        for (const [userId, count] of userCounts.entries()) {
            if (count >= requiredMatches) {
                matches.push(userId);
                console.log(
                    `  Candidate ${userId}: Shared ${count} topics. Is a match!`
                );
            } else {
                console.log(
                    `  Candidate ${userId}: Shared ${count} topics. Not enough for a match.`
                );
            }
        }

        if (matches.length === 0) {
            console.log('No matches found based on topics.');
            return [];
        }

        // sort matches by number of shared topics, descending
        matches.sort((a, b) => (userCounts.get(b) || 0) - (userCounts.get(a) || 0));

        // Filter matches by difficulty level, returns the first match found with the same difficulty
        let match:string = '';
        for (const matchTemp of matches) {
            const isDifficultyMatch = await this.checkDifficultyMatch(sourceUserId, matchTemp);
            if (!isDifficultyMatch) {
                console.log(`  Candidate ${matchTemp}: Difficulty level does not match.`);
            } else {
                console.log(`  Candidate ${matchTemp}: Difficulty level matches.`);
                match = matchTemp;
            }
        }

        // if there is a match with the same difficulty, cache the matched users and return the match
        if (match) {
            console.log('Found matches with the same difficulties for user:', sourceUserId);
            // generate match ID
            const matchId = uuidv4();

            console.log('Generated match ID:', matchId);
            if (matchId == '' || matchId == null) {
                console.error('Failed to generate match ID');
                return null;
            }
            // update Supabase with the match ID
            try {
                const res = await supabaseService.handleNewMatch(sourceUserId, match, matchId);
                if (!res.success) {
                    console.error('Failed to handle new match in Supabase:', res.message);
                    return null;
                }
                console.log('Successfully handled new match in Supabase:', res.message);
            } catch (error) {
                console.error('Failed to handle new match in Supabase:', error);
                return null;
            }
            // do not cache users when Supabase update fails
            await redisService.removeMatchedUsersFromCache(sourceUserId, match);
            await redisService.addMatchToCache(sourceUserId, match, matchId);
            return match
        }

        console.log('Matches with the same difficulties not found for user:', sourceUserId);
        return null
    }

    // --- Helper Function to Check Difficulty Match ---
    // Returns true if both users have the same difficulty level
    async checkDifficultyMatch(sourceUserId: string, candidateUserId: string): Promise<boolean> {
        const sourcePrefs = await this.getUserPreference(sourceUserId);
        const candidatePrefs = await this.getUserPreference(candidateUserId);

        if (!sourcePrefs || !candidatePrefs) {
            logger.warn(`Preferences not found for one of the users: ${sourceUserId}, ${candidateUserId}`);
            return false;
        }

        return sourcePrefs.difficulty === candidatePrefs.difficulty;
    }

    // --- Update User Preferences and Invalidate Cache ---
    async updateUserPreferences(userId: string, newPreferences: UserPreference): Promise<UserPreference | null> {
        // Update in Supabase
        try {
            await supabaseService.updateUserPreferences(newPreferences);
            logger.info(`Updated preferences in Supabase for user: ${userId}`);
        } catch (error) {
            // stop update to redis if supabase update fails
            logger.error(`Failed to update user preferences in Supabase for user: ${userId}, Redis cache not updated: `, error);
            return null;
        }

        // Update in Redis Cache
        const cacheKey = `${this.CACHE_KEY_PREFIX}${userId}`;
        await redisService.set(cacheKey, newPreferences);
        await redisService.setTopics(userId, newPreferences.topics);
        logger.info(`Updated preferences and invalidated cache for user: ${userId}`);
        return newPreferences; // Return the updated preferences
    }

    // retrieve all members currently in the queue from supabase
    // returns an array of user IDs
    private async getQueueMembers() {
        return await supabaseService.getQueueMembers();
    }

    // --- Clear Matches for a Given Match ID ---
    async clearMatches(matchId: string) {
        try {
            await supabaseService.clearMatches(matchId);
            await redisService.removeUserMatchesFromCache(matchId);
            logger.info(`Cleared matches for match: ${matchId}`);
        } catch (error) {
            logger.error(`Failed to clear matches for match: ${matchId}`, error);
            throw error; // rethrow the error after logging
        }
    }
}

export const matchingService = new MatchingService();