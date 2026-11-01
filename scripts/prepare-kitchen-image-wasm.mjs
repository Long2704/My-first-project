// Prepare a small, self-contained Edge bundle; no npm package ships to the server.
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const url='https://registry.npmjs.org/@imagemagick/magick-wasm/-/magick-wasm-0.0.45.tgz';
const assets=[["dist/x86/magick.wasm", "magick.wasm.gz", "54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c"], ["dist/index.js", "magick.js", "696370daea26ec9ccb1d53316e49eca464cd841678be0fdd550652cbcc73208e"], ["dist/index.d.ts", "magick.d.ts", "7da006919009e42060b97613cb2d7964e70dfeab879a6406901ce1e28b1bcad4"], ["NOTICE", "magick.NOTICE", "7cb6cf162ba965ed068dbc9e638c9b792b8a1a9f4dae51031e7a21ff1ebefc8d"]];
// Invoke the real npm JavaScript CLI through Node, including on Windows.
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run this script with npm run prepare:kitchen-image-wasm.');
const directory=await mkdtemp(join(tmpdir(),'pos-image-wasm-'));
try{
 execFileSync(process.execPath,[npmCli,'pack',url,'--pack-destination',directory],{stdio:'pipe'});
 execFileSync('tar',['-xzf',join(directory,'imagemagick-magick-wasm-0.0.45.tgz'),'-C',directory,...assets.map(([source])=>'package/'+source)]);
 const prepared=[];
 for(const [source,name,expected] of assets){
  const bytes=await readFile(join(directory,'package',source));
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Image processor checksum differs from reviewed version: '+name);
  const data=name==='magick.wasm.gz'?gzipSync(bytes,{level:9}):name==='magick.d.ts'?Buffer.concat([Buffer.from('// Browser-only canvas APIs are unavailable in the Edge runtime.\ntype HTMLCanvasElement=never;\ntype CanvasRenderingContext2DSettings=never;\n'),bytes]):bytes;
  prepared.push([name,data]);
 }
 const total=prepared.reduce((sum,[,bytes])=>sum+bytes.length,0);
 if(total>6*1024*1024)throw new Error('Image processor exceeds the reviewed 6 MiB package budget.');
 const destination=new URL('../supabase/functions/kitchen-image-upload/',import.meta.url);
 await mkdir(destination,{recursive:true});
 for(const [name,bytes] of prepared)await writeFile(new URL(name,destination),bytes);
 // Remove the previous uncompressed generated asset to prevent accidental oversize uploads.
 await rm(new URL('magick.wasm',destination),{force:true});
 console.log('Prepared pinned kitchen-image WASM asset (not deployed).');
 console.log('Compact image processor: '+(total/1024/1024).toFixed(2)+' MiB; no full npm package in Edge imports.');
}finally{await rm(directory,{recursive:true,force:true});}
