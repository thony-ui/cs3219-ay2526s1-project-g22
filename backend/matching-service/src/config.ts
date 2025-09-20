import dotenv from 'dotenv';
import path from "node:path";
import fs from 'node:fs';

const expectedEnvPath = path.resolve(__dirname, '../.env'); // Should be .../matching-service/.env

if (fs.existsSync(expectedEnvPath)) {
    console.log('.env file found at:', expectedEnvPath);
    console.log('Port:', process.env.MATCHING_SERVICE_PORT);
} else {
    console.error('ERROR: .env file NOT found at:', expectedEnvPath);
    console.error('Please ensure your .env is in the matching-service root directory.');
}


dotenv.config({ path: expectedEnvPath, debug: true });


const config = {
    port: process.env.MATCHING_SERVICE_PORT ? parseInt(process.env.MATCHING_SERVICE_PORT, 10) : 3001, // Ensure PORT is parsed as number
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379, // Ensure REDIS_PORT is parsed as number
    },
    supabase: {
        url: process.env.SUPABASE_URL || '',
        anonKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '', // Using SERVICE_ROLE_KEY here as per your original code
    },
};

if (!config.supabase.url) { // Simplified check based on actual error
    console.error('CRITICAL ERROR: Supabase URL is still missing in config. Please check .env file.');
}
if (!config.supabase.anonKey) {
    console.warn('WARNING: Supabase Anon Key is missing in config. Ensure it is set if you need it.');
} else {
    // You'll still see this warning if it's the anon key, but it means the key was loaded.
    if (config.supabase.anonKey.includes('"role":"anon"')) {
        console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY appears to be your public "anon" key. If you require service_role privileges, please update this.');
    }
}


export default config;