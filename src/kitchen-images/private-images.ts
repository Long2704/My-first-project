import {supabase} from '../supabase';
type Entry={promise:Promise<string>;url?:string;bytes:number;refs:number;touched:number};
// This cache belongs to one mounted, authorized user. Nothing enters localStorage/SW.
export function createPrivateImages(){
 const entries=new Map<string,Entry>();let disposed=false,generation=0;
 function prune(){
  let bytes=[...entries.values()].reduce((n,e)=>n+e.bytes,0);
  for(const [path,e] of [...entries].sort((a,b)=>a[1].touched-b[1].touched)){
   if(entries.size<=48&&bytes<=32*1024*1024)break;
   if(e.refs||!e.url)continue;URL.revokeObjectURL(e.url);entries.delete(path);bytes-=e.bytes;
  }
 }
 return {
  activate(){disposed=false;},
  acquire(path:string){
   let entry=entries.get(path);
   if(!entry){
    const currentGeneration=generation;
    const next:Entry={promise:Promise.resolve(''),bytes:0,refs:0,touched:Date.now()};
    next.promise=(async()=>{
     if(!supabase)throw new Error();
     const {data,error}=await supabase.storage.from('kitchen-ticket-images').download(path,{}, {cache:'no-store'});
     if(error||!data||disposed||currentGeneration!==generation)throw new Error('Chưa tải được ảnh.');
     next.bytes=data.size;next.url=URL.createObjectURL(data);prune();return next.url;
    })().catch(error=>{if(entries.get(path)===next)entries.delete(path);throw error;});
    entries.set(path,next);entry=next;
   }
   entry.refs++;entry.touched=Date.now();const captured=entry;
   return {promise:entry.promise,release(){captured.refs=Math.max(0,captured.refs-1);prune();}};
  },
  dispose(){disposed=true;generation++;for(const e of entries.values())if(e.url)URL.revokeObjectURL(e.url);entries.clear();},
 };
}
export type PrivateImages=ReturnType<typeof createPrivateImages>;
