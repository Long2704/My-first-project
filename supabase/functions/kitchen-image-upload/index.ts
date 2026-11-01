import {createKitchenImageHandler} from './handler.ts';
import {decodeImage} from './decode.ts';
Deno.serve(createKitchenImageHandler({
 supabaseUrl:Deno.env.get('SUPABASE_URL')??'',
 publicKey:Deno.env.get('SUPABASE_ANON_KEY')??'',
 serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',
 decode:decodeImage,
}));
