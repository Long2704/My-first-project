import { createClient } from '@supabase/supabase-js';
const config = (import.meta as ImportMeta & {env: Record<string,string|undefined>}).env;
const url = config.VITE_SUPABASE_URL;
const key = config.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
