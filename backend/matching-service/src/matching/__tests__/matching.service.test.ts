import { redisService } from '../../services/redis.service';
import { supabaseService } from '../../services/supabase.service';
import { logger } from '../../utils/logger';
import { UserPreference } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { MatchingService } from '../matching.service'; // Assuming your class is in matching.service.ts

// Mocking dependencies
jest.mock('../../services/redis.service');
jest.mock('../../services/supabase.service');
jest.mock('../../utils/logger');
jest.mock('uuid', () => ({
    v4: jest.fn(),
}));

describe('MatchingService', () => {
    let matchingService: MatchingService;

    beforeEach(() => {
        matchingService = new MatchingService();
        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    describe('getUserPreference', () => {
        const userId = 'user123';
        const mockPreferences: UserPreference = {
            user_id: userId,
            difficulty: 'easy',
            topics: ['math', 'science'],
        };

        it('should return preferences from cache if available', async () => {
            (redisService.get as jest.Mock).mockResolvedValue(mockPreferences);

            const result = await matchingService.getUserPreference(userId);

            expect(redisService.get).toHaveBeenCalledWith(`user_match_pref:${userId}`);
            expect(supabaseService.getUserPreferences).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith(
                `Cache hit for user preferences: ${userId}`
            );
            expect(result).toEqual(mockPreferences);
        });

        it('should fetch preferences from Supabase and cache them if not in Redis', async () => {
            (redisService.get as jest.Mock).mockResolvedValue(null);
            (supabaseService.getUserPreferences as jest.Mock).mockResolvedValue(
                mockPreferences
            );

            const result = await matchingService.getUserPreference(userId);

            expect(redisService.get).toHaveBeenCalledWith(`user_match_pref:${userId}`);
            expect(supabaseService.getUserPreferences).toHaveBeenCalledWith(userId);
            expect(redisService.set).toHaveBeenCalledWith(
                `user_match_pref:${userId}`,
                mockPreferences
            );
            expect(logger.info).toHaveBeenCalledWith(
                `Cache miss for user preferences: ${userId}, fetching from Supabase.`
            );
            expect(result).toEqual(mockPreferences);
        });

        it('should return null if preferences are not found in Supabase', async () => {
            (redisService.get as jest.Mock).mockResolvedValue(null);
            (supabaseService.getUserPreferences as jest.Mock).mockResolvedValue(null);

            const result = await matchingService.getUserPreference(userId);

            expect(redisService.get).toHaveBeenCalledWith(`user_match_pref:${userId}`);
            expect(supabaseService.getUserPreferences).toHaveBeenCalledWith(userId);
            expect(redisService.set).not.toHaveBeenCalled(); // Should not set null to cache
            expect(result).toBeNull();
        });
    });

    describe('getUserTopics', () => {
        const userId = 'user123';
        const mockPreferencesWithTopics: UserPreference = {
            user_id: userId,
            difficulty: 'medium',
            topics: ['history', 'geography', 'art'],
        };
        const mockPreferencesNoTopics: UserPreference = {
            user_id: userId,
            difficulty: 'easy',
            topics: [],
        };

        it('should return a Set of topics if preferences exist and have topics', async () => {
            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockResolvedValue(mockPreferencesWithTopics);

            const result = await matchingService.getUserTopics(userId);

            expect(matchingService.getUserPreference).toHaveBeenCalledWith(userId);
            expect(result).toEqual(new Set(['history', 'geography', 'art']));
        });

        it('should return an empty Set if no preferences are found', async () => {
            jest.spyOn(matchingService, 'getUserPreference').mockResolvedValue(null);

            const result = await matchingService.getUserTopics(userId);

            expect(matchingService.getUserPreference).toHaveBeenCalledWith(userId);
            expect(logger.info).toHaveBeenCalledWith('No preferences found for user:', userId);
            expect(result).toEqual(new Set());
        });

        it('should return an empty Set if preferences exist but have no topics', async () => {
            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockResolvedValue(mockPreferencesNoTopics);

            const result = await matchingService.getUserTopics(userId);

            expect(matchingService.getUserPreference).toHaveBeenCalledWith(userId);
            expect(logger.info).toHaveBeenCalledWith('User has no topics:', userId);
            expect(result).toEqual(new Set());
        });
    });

    describe('checkDifficultyMatch', () => {
        const sourceUserId = 'userA';
        const candidateUserId = 'userB';

        it('should return true if both users have matching difficulty levels', async () => {
            const userAPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'hard',
                topics: [],
            };
            const userBPrefs: UserPreference = {
                user_id: candidateUserId,
                difficulty: 'hard',
                topics: [],
            };

            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return userAPrefs;
                    if (userId === candidateUserId) return userBPrefs;
                    return null;
                });

            const result = await matchingService.checkDifficultyMatch(
                sourceUserId,
                candidateUserId
            );

            expect(matchingService.getUserPreference).toHaveBeenCalledWith(sourceUserId);
            expect(matchingService.getUserPreference).toHaveBeenCalledWith(candidateUserId);
            expect(result).toBe(true);
        });

        it('should return false if difficulty levels do not match', async () => {
            const userAPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'medium',
                topics: [],
            };
            const userBPrefs: UserPreference = {
                user_id: candidateUserId,
                difficulty: 'easy',
                topics: [],
            };

            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return userAPrefs;
                    if (userId === candidateUserId) return userBPrefs;
                    return null;
                });

            const result = await matchingService.checkDifficultyMatch(
                sourceUserId,
                candidateUserId
            );

            expect(result).toBe(false);
        });

        it('should return false if preferences are not found for source user', async () => {
            const userBPrefs: UserPreference = {
                user_id: candidateUserId,
                difficulty: 'hard',
                topics: [],
            };

            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return null;
                    if (userId === candidateUserId) return userBPrefs;
                    return null;
                });

            const result = await matchingService.checkDifficultyMatch(
                sourceUserId,
                candidateUserId
            );

            expect(logger.warn).toHaveBeenCalledWith(
                `Preferences not found for one of the users: ${sourceUserId}, ${candidateUserId}`
            );
            expect(result).toBe(false);
        });

        it('should return false if preferences are not found for candidate user', async () => {
            const userAPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'hard',
                topics: [],
            };

            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return userAPrefs;
                    if (userId === candidateUserId) return null;
                    return null;
                });

            const result = await matchingService.checkDifficultyMatch(
                sourceUserId,
                candidateUserId
            );

            expect(logger.warn).toHaveBeenCalledWith(
                `Preferences not found for one of the users: ${sourceUserId}, ${candidateUserId}`
            );
            expect(result).toBe(false);
        });
    });

    describe('findFuzzyMatches', () => {
        const sourceUserId = 'sourceUser';
        const mockMatchId = 'mock-uuid-123';
        let checkDifficultyMatchSpy: jest.SpyInstance;


        beforeEach(() => {
            (uuidv4 as jest.Mock).mockReturnValue(mockMatchId);
            jest.spyOn(console, 'log').mockImplementation(() => {}); // Suppress console.log
            jest.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console.error
            // Spy on checkDifficultyMatch before each test in this describe block
            checkDifficultyMatchSpy = jest.spyOn(matchingService, 'checkDifficultyMatch');
        });

        afterEach(() => {
            checkDifficultyMatchSpy.mockRestore(); // Clean up the spy after each test
        });

        it('should return an empty array if the source user has no topics', async () => {
            jest
                .spyOn(matchingService, 'getUserTopics')
                .mockResolvedValue(new Set<string>());

            const result = await matchingService.findFuzzyMatches(sourceUserId);

            expect(matchingService.getUserTopics).toHaveBeenCalledWith(sourceUserId);
            expect(result).toEqual([]);
        });

        it('should find matches based on fuzzy percentage and difficulty, cache and return a single match', async () => {
            const sourceUserTopics = new Set(['topicA', 'topicB', 'topicC']);
            const sourceUserPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'medium',
                topics: Array.from(sourceUserTopics),
            };

            const candidateUser1 = 'user1';
            const candidateUser1Prefs: UserPreference = {
                user_id: candidateUser1,
                difficulty: 'medium',
                topics: ['topicA', 'topicB', 'topicD'],
            }; // 2 shared topics (66%)

            const candidateUser2 = 'user2';
            const candidateUser2Prefs: UserPreference = {
                user_id: candidateUser2,
                difficulty: 'hard',
                topics: ['topicA', 'topicC', 'topicE'],
            }; // 2 shared topics (66%)

            const candidateUser3 = 'user3';
            const candidateUser3Prefs: UserPreference = {
                user_id: candidateUser3,
                difficulty: 'medium',
                topics: ['topicA', 'topicD', 'topicF'],
            }; // 1 shared topic (33%)

            jest
                .spyOn(matchingService, 'getUserTopics')
                .mockResolvedValue(sourceUserTopics);
            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return sourceUserPrefs;
                    if (userId === candidateUser1) return candidateUser1Prefs;
                    if (userId === candidateUser2) return candidateUser2Prefs;
                    if (userId === candidateUser3) return candidateUser3Prefs;
                    return null;
                });

            (redisService.fetchMembers as jest.Mock).mockResolvedValue([
                // Members for 'topicA'
                [sourceUserId, candidateUser1, candidateUser2, candidateUser3],
                // Members for 'topicB'
                [sourceUserId, candidateUser1],
                // Members for 'topicC'
                [sourceUserId, candidateUser2],
            ]);

            // Mock checkDifficultyMatch's behavior for specific users
            checkDifficultyMatchSpy.mockImplementation(async (u1, u2) => {
                if ((u1 === sourceUserId && u2 === candidateUser1) || (u2 === sourceUserId && u1 === candidateUser1)) {
                    return true; // sourceUser and user1 have matching difficulty
                }
                if ((u1 === sourceUserId && u2 === candidateUser2) || (u2 === sourceUserId && u1 === candidateUser2)) {
                    return false; // sourceUser and user2 do not match difficulty
                }
                return (u1 === sourceUserId && u2 === candidateUser3) || (u2 === sourceUserId && u1 === candidateUser3);
            });


            (redisService.removeMatchedUsersFromCache as jest.Mock).mockResolvedValue(
                undefined
            );
            (redisService.addMatchToCache as jest.Mock).mockResolvedValue(undefined);

            const result = await matchingService.findFuzzyMatches(
                sourceUserId,
                0.6 // Requires 0.6 * 3 = 1.8 => 2 matches
            );

            // Expected flow:
            // 1. getUserTopics for sourceUser
            // 2. redisService.fetchMembers for topic keys
            // 3. User counts:
            //    - user1: topicA, topicB (2) -> meets 2 required matches
            //    - user2: topicA, topicC (2) -> meets 2 required matches
            //    - user3: topicA (1) -> does not meet
            // 4. Sorted matches: [user1, user2]
            // 5. Difficulty check:
            //    - user1: medium (source) vs medium (user1) -> Match
            //    - user2: medium (source) vs hard (user2) -> No match
            // 6. Cache match: user1
            expect(redisService.fetchMembers).toHaveBeenCalledWith([
                `topic:topicA`,
                `topic:topicB`,
                `topic:topicC`,
            ]);
            expect(checkDifficultyMatchSpy).toHaveBeenCalledWith(
                sourceUserId,
                candidateUser1
            );
            expect(checkDifficultyMatchSpy).toHaveBeenCalledWith(
                sourceUserId,
                candidateUser2
            );
            expect(redisService.removeMatchedUsersFromCache).toHaveBeenCalledWith(
                sourceUserId,
                candidateUser1
            );
            expect(redisService.addMatchToCache).toHaveBeenCalledWith(
                sourceUserId,
                candidateUser1,
                mockMatchId
            );
            expect(result).toEqual(candidateUser1);
        });

        it('should return null if no matches are found after fuzzy and difficulty checks', async () => {
            const sourceUserTopics = new Set(['topicX', 'topicY']);
            const sourceUserPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'easy',
                topics: Array.from(sourceUserTopics),
            };

            const candidateUser1 = 'user1';
            const candidateUser1Prefs: UserPreference = {
                user_id: candidateUser1,
                difficulty: 'hard',
                topics: ['topicX', 'topicZ'],
            }; // 1 shared topic (50%)

            jest
                .spyOn(matchingService, 'getUserTopics')
                .mockResolvedValue(sourceUserTopics);
            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return sourceUserPrefs;
                    if (userId === candidateUser1) return candidateUser1Prefs;
                    return null;
                });

            (redisService.fetchMembers as jest.Mock).mockResolvedValue([
                // Members for 'topicX'
                [`topic:${sourceUserId}:topicX`, candidateUser1], // Use the correct key format
                // Members for 'topicY'
                [`topic:${sourceUserId}:topicY`], // Use the correct key format
            ]);

            checkDifficultyMatchSpy.mockResolvedValue(true); // Mocking it to return true initially


            const result = await matchingService.findFuzzyMatches(
                sourceUserId,
                0.8 // Requires 0.8 * 2 = 1.6 => 2 matches (user1 only has 1 shared topic)
            );

            expect(result).toEqual([]);
            expect(redisService.removeMatchedUsersFromCache).not.toHaveBeenCalled();
            expect(redisService.addMatchToCache).not.toHaveBeenCalled();
        });

        it('should return null if no difficulty match is found among topic-matching candidates', async () => {
            const sourceUserTopics = new Set(['topicA', 'topicB']);
            const sourceUserPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'medium',
                topics: Array.from(sourceUserTopics),
            };

            const candidateUser1 = 'user1';
            const candidateUser1Prefs: UserPreference = {
                user_id: candidateUser1,
                difficulty: 'easy',
                topics: ['topicA', 'topicB'],
            }; // 2 shared topics, but different difficulty

            const candidateUser2 = 'user2';
            const candidateUser2Prefs: UserPreference = {
                user_id: candidateUser2,
                difficulty: 'hard',
                topics: ['topicA', 'topicB'],
            }; // 2 shared topics, but different difficulty

            jest
                .spyOn(matchingService, 'getUserTopics')
                .mockResolvedValue(sourceUserTopics);
            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return sourceUserPrefs;
                    if (userId === candidateUser1) return candidateUser1Prefs;
                    if (userId === candidateUser2) return candidateUser2Prefs;
                    return null;
                });

            (redisService.fetchMembers as jest.Mock).mockResolvedValue([
                // Members for 'topicA'
                [`topic:${sourceUserId}:topicA`, candidateUser1, candidateUser2],
                // Members for 'topicB'
                [`topic:${sourceUserId}:topicB`, candidateUser1, candidateUser2],
            ]);

            // Mock checkDifficultyMatch to always return false for these candidates
            checkDifficultyMatchSpy.mockResolvedValue(false);

            const result = await matchingService.findFuzzyMatches(sourceUserId); // Default 0.8

            expect(redisService.fetchMembers).toHaveBeenCalled();
            expect(checkDifficultyMatchSpy).toHaveBeenCalledWith(
                sourceUserId,
                candidateUser1
            );
            expect(checkDifficultyMatchSpy).toHaveBeenCalledWith(
                sourceUserId,
                candidateUser2
            );
            expect(redisService.removeMatchedUsersFromCache).not.toHaveBeenCalled();
            expect(redisService.addMatchToCache).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('should return null and log an error if match ID generation fails', async () => {
            const sourceUserTopics = new Set(['topicA', 'topicB', 'topicC']);
            const sourceUserPrefs: UserPreference = {
                user_id: sourceUserId,
                difficulty: 'medium',
                topics: Array.from(sourceUserTopics),
            };

            const candidateUser1 = 'user1';
            const candidateUser1Prefs: UserPreference = {
                user_id: candidateUser1,
                difficulty: 'medium',
                topics: ['topicA', 'topicB', 'topicC'],
            };

            jest
                .spyOn(matchingService, 'getUserTopics')
                .mockResolvedValue(sourceUserTopics);
            jest
                .spyOn(matchingService, 'getUserPreference')
                .mockImplementation(async (userId) => {
                    if (userId === sourceUserId) return sourceUserPrefs;
                    if (userId === candidateUser1) return candidateUser1Prefs;
                    return null;
                });

            (redisService.fetchMembers as jest.Mock).mockResolvedValue([
                [candidateUser1],
                [candidateUser1],
                [candidateUser1]
            ]);

            checkDifficultyMatchSpy.mockResolvedValue(true); // Ensure difficulty match is not the reason for failure

            (uuidv4 as jest.Mock).mockReturnValue(''); // Simulate failure to generate ID

            const result = await matchingService.findFuzzyMatches(sourceUserId);

            expect(console.error).toHaveBeenCalledWith('Failed to generate match ID');
            expect(redisService.removeMatchedUsersFromCache).not.toHaveBeenCalled();
            expect(redisService.addMatchToCache).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });
    });

    describe('updateUserPreferences', () => {
        const userId = 'user456';
        const newPreferences: UserPreference = {
            user_id: userId,
            difficulty: 'hard',
            topics: ['physics', 'chemistry'],
        };

        it('should update preferences in Redis and set topics', async () => {
            (redisService.set as jest.Mock).mockResolvedValue(undefined);
            (redisService.setTopics as jest.Mock).mockResolvedValue(undefined);

            const result = await matchingService.updateUserPreferences(
                userId,
                newPreferences
            );

            expect(redisService.set).toHaveBeenCalledWith(
                `user_match_pref:${userId}`,
                newPreferences
            );
            expect(redisService.setTopics).toHaveBeenCalledWith(
                userId,
                newPreferences.topics
            );
            expect(logger.info).toHaveBeenCalledWith(
                `Updated preferences and invalidated cache for user: ${userId}`
            );
            expect(result).toEqual(newPreferences);
        });
    });
});