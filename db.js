const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your_supabase_url_here')) {
    console.warn('⚠️ WARNING: Supabase URL or Anon Key is missing or placeholders are used. Please check your .env file.');
}

const db = createClient(
    supabaseUrl || 'https://placeholder-url.supabase.co', 
    supabaseAnonKey || 'placeholder-key',
    {
        auth: {
            persistSession: false
        },
        realtime: {
            transport: ws
        }
    }
);

module.exports = db;
