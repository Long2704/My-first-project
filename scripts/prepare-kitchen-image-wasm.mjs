// Run before local Edge serving or an explicitly approved deployment.
// Resolves exactly the pinned npm asset; verifies hash before copying.
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
const url='https://registry.npmjs.org/@imagemagick/magick-wasm/-/magick-wasm-0.0.45.tgz';
// npm performs registry integrity checking; the generated wasm hash is pinned below.
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// npm run supplies the real JavaScript CLI path on Windows, macOS and Linux.
// Spawn Node directly: Windows npm.cmd is a shell shim, not an executable.
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run this script with npm run prepare:kitchen-image-wasm.');
const directory=await mkdtemp(join(tmpdir(),'pos-image-wasm-'));
try{
 execFileSync(process.execPath,[npmCli,'pack',url,'--pack-destination',directory],{stdio:'pipe'});
 execFileSync('tar',['-xzf',join(directory,'imagemagick-magick-wasm-0.0.45.tgz'),'-C',directory,'package/dist/x86/magick.wasm','package/NOTICE']);
 const bytes=await readFile(join(directory,'package/dist/x86/magick.wasm'));
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(hash!=='54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c')throw new Error('WASM checksum differs from reviewed version.');
 const destination=new URL('../supabase/functions/kitchen-image-upload/magick.wasm',import.meta.url);
 await mkdir(new URL('.',destination),{recursive:true});await writeFile(destination,bytes);
 await writeFile(new URL('../supabase/functions/kitchen-image-upload/magick.NOTICE',import.meta.url),await readFile(join(directory,'package/NOTICE')));
 console.log('Prepared pinned kitchen-image WASM asset (not deployed).');
}finally{await rm(directory,{recursive:true,force:true});}
