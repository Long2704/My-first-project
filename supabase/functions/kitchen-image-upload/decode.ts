// @deno-types="./magick.d.ts"
import {ImageMagick,initializeImageMagick,MagickFormat,MagickReadSettings,ResourceLimits} from './magick.js';
import type {DecodedImage} from './handler.ts';
let ready:Promise<void>|undefined;
// One synchronous decode per isolate. Explicit format prevents SVG/PDF/delegate decoding.
async function initialize(){
 const compressed=await Deno.readFile(new URL('./magick.wasm.gz',import.meta.url));
 const stream=new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'));
 const wasm=new Uint8Array(await new Response(stream).arrayBuffer());
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wasm)),n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!=='54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c')throw new Error('Image processor checksum mismatch.');
 await initializeImageMagick(wasm);
 ResourceLimits.width=4096n;ResourceLimits.height=4096n;ResourceLimits.area=8000000n;
 ResourceLimits.memory=96n*1024n*1024n;ResourceLimits.maxMemoryRequest=96n*1024n*1024n;
 ResourceLimits.disk=0n;ResourceLimits.listLength=4n;ResourceLimits.maxProfileSize=1024n*1024n;ResourceLimits.time=10n;
}
export async function decodeImage(bytes:Uint8Array,mime:string):Promise<DecodedImage>{
 await (ready??=initialize());
 const format=mime==='image/jpeg'?MagickFormat.Jpeg:mime==='image/png'?MagickFormat.Png:MagickFormat.WebP;
 const settings=new MagickReadSettings();settings.format=format;settings.frameIndex=0;settings.frameCount=1;
 try{return ImageMagick.read(bytes,settings,image=>{
  if(image.width*image.height>8000000||image.width>4096||image.height>4096)throw new Error('size');
  image.autoOrient();image.strip();image.quality=88;
  const width=image.width,height=image.height;
  const output=image.write(MagickFormat.WebP,data=>new Uint8Array(data));
  const scale=Math.min(1,640/Math.max(width,height));
  if(scale<1)image.resize(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
  image.quality=78;
  const preview=image.write(MagickFormat.WebP,data=>new Uint8Array(data));
  return {image:output,preview,width,height};
 });}catch{throw new Error('Ảnh không đọc được hoặc quá lớn (tối đa 4096 px mỗi chiều, 8 triệu điểm ảnh).');}
}
