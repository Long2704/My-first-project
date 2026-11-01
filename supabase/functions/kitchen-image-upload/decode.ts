import {ImageMagick,initializeImageMagick,MagickFormat,MagickReadSettings,ResourceLimits} from '@imagemagick/magick-wasm';
import type {DecodedImage} from './handler.ts';
let ready:Promise<void>|undefined;
// One synchronous decode per isolate. Explicit format prevents SVG/PDF/delegate decoding.
async function initialize(){
 await initializeImageMagick(await Deno.readFile(new URL('./magick.wasm',import.meta.url)));
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
