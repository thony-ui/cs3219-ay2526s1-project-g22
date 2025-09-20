import {redisService} from '../services/redis.service';
import {supabaseService} from '../services/supabase.service';
import {logger} from '../utils/logger';
import {UserPreference} from '../types';
import { v4 as uuidv4 } from 'uuid';

export class MatchingService {
    private readonly CACHE_KEY_PREFIX = 'user_match_pref:';
    private readonly TOPIC_KEY_PREFIX = 'topic:';

    // --- Get User Preferences with Caching ---
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

        // 1. Get all Redis keys for the source user's topics
        const topicKeys = Array.from(sourceUserTopics).map(
            (topic) => `${this.TOPIC_KEY_PREFIX}${topic}`
        );

        // 2. Fetch all members from these topic sets concurrently
        // We use `pipeline` or `multi` for efficiency to send multiple commands in one round trip.
        const results = await redisService.fetchMembers(topicKeys)

        // 'results' will be an array like [['userA', 'userB'], ['userB', 'userC']]
        const userCounts = new Map(); // Map<userId, count>

        for (const result of results) {
            for (const userId of result) {
                if (userId !== String(sourceUserId)) {
                    // Don't count the source user themselves
                    userCounts.set(userId, (userCounts.get(userId) || 0) + 1);
                }
            }
        }

        // 3. Filter candidates based on required match count
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

        //4. Filter matches by difficulty level, returns the first match found with the same difficulty
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
        // In a real application, you'd update Supabase here first, then update/delete cache
        // For this example, let's just update cache for simplicity, assuming Supabase is updated elsewhere.
        const cacheKey = `${this.CACHE_KEY_PREFIX}${userId}`;
        await redisService.set(cacheKey, newPreferences);
        await redisService.setTopics(userId, newPreferences.topics);
        logger.info(`Updated preferences and invalidated cache for user: ${userId}`);
        return newPreferences; // Return the updated preferences
    }
}

export const matchingService = new MatchingService();