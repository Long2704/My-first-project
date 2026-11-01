import assert from 'node:assert/strict';
import {loadVerifiedWasm,WASM_URL,WASM_SIZE} from '../supabase/functions/kitchen-image-upload/wasm-loader.ts';
let calls=0;
await assert.rejects(loadVerifiedWasm(async(url,options)=>{
 calls++;assert.equal(url,WASM_URL);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.equal(options.headers,undefined);
 return new Response('private provider details',{status:503});
}),/Không tải được bộ xử lý ảnh/);
await assert.rejects(loadVerifiedWasm(async()=>new Response(new Uint8Array(10))),/tải chưa đủ/);
await assert.rejects(loadVerifiedWasm(async()=>new Response(new Uint8Array(WASM_SIZE))),/không khớp phiên bản/);
let cancelled=false;
const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(WASM_SIZE+1));},cancel(){cancelled=true;}});
await assert.rejects(loadVerifiedWasm(async()=>new Response(oversized)),/dung lượng không hợp lệ/);assert.equal(cancelled,true);assert.equal(calls,1);
console.log('PASS WASM loader: fixed version/host, no credentials/headers, timeout, no redirects, status/length/hash checks, oversized stream cancelled. Real verified CDN bytes are exercised in the Deno decoder integration test.');
