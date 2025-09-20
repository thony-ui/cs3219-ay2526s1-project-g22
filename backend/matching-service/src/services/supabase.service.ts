import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '../config';
import { logger } from '../utils/logger';

class SupabaseService {
    public client: SupabaseClient;

    constructor() {
        if (!config.supabase.url || !config.supabase.anonKey) {
            logger.error('Supabase URL or Anon Key is not provided. Cannot initialize Supabase client.');
            // You might want to throw an error here to prevent the app from starting if Supabase is critical.
            // throw new Error('Supabase configuration missing.');
        }
        this.client = createClient(config.supabase.url, config.supabase.anonKey);
        logger.info('Supabase client initialized.');
    }

    // Example: Fetch a user's matching preferences
    async getUserPreferences(userId: string) {
        const { data, error } = await this.client
            .from('user_preferences') // Replace with your actual table name
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) {
            logger.error(`Error fetching user preferences for ${userId}:`, error.message);
            return null;
        }
        return data;
    }
}

export const supabaseService = new SupabaseService();