import {decodeImage} from '../supabase/functions/kitchen-image-upload/decode.ts';
// @deno-types="../supabase/functions/kitchen-image-upload/magick.d.ts"
import {ImageMagick,MagickFormat,MagickColors} from '../supabase/functions/kitchen-image-upload/magick.js';
function assert(ok:boolean,message:string){if(!ok)throw new Error(message);}
Deno.test('real WASM decode JPEG/PNG/WebP, re-encode, thumbnail, corruption and pixel limits',async()=>{
 const compressed=await Deno.stat(new URL('../supabase/functions/kitchen-image-upload/magick.wasm.gz',import.meta.url));assert(compressed.size<6*1024*1024,'compact WASM asset');
 const config=JSON.parse(await Deno.readTextFile(new URL('../supabase/functions/kitchen-image-upload/deno.json',import.meta.url)));assert(Object.keys(config.imports).length===0,'no full npm dependency in Edge graph');
 const original=await Deno.readFile(new URL('../public/brand/goc-pho-logo.webp',import.meta.url));
 const first=await decodeImage(original,'image/webp');assert(first.width===256&&first.height===256,'webp dimensions');
 for(const [format,mime] of [[MagickFormat.Jpeg,'image/jpeg'],[MagickFormat.Png,'image/png']] as const){
  const source=ImageMagick.read(original,image=>image.write(format,data=>new Uint8Array(data)));
  const decoded=await decodeImage(source,mime);assert(decoded.width===256,'decoded width');assert(new TextDecoder().decode(decoded.image.slice(8,12))==='WEBP','sanitized webp');
 }
 const large=ImageMagick.read(MagickColors.White,1200,800,image=>image.write(MagickFormat.Png,data=>new Uint8Array(data)));
 const decoded=await decodeImage(large,'image/png');assert(decoded.width===1200&&decoded.height===800,'preserve ratio/dimensions');
 ImageMagick.read(decoded.preview,image=>{assert(image.width===640&&image.height===427,'bounded proportional preview');});
 for(const bytes of [new Uint8Array([137,80,78,71,13,10,26,10,0]),original.slice(0,20)]){
  let rejected=false;try{await decodeImage(bytes,'image/webp');}catch{rejected=true;}assert(rejected,'corrupt files rejected');
 }
 const oversized=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAEAEAAAABCAIAAAA+gZcVAAAAJUlEQVR4nO3BMQEAAAjAIO0fetbwALYaAAAAAAAAAAAAAADgvQPeYwL/NGPDYwAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
 let blocked=false;try{await decodeImage(oversized,'image/png');}catch{blocked=true;}assert(blocked,'oversized dimensions rejected before acceptance');
 console.log('Real decoder WebP/JPEG/PNG and 1200×800 thumbnail passed.');
});
