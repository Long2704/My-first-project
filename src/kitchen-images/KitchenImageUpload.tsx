import {useEffect,useRef,useState} from 'react';
import {supabase} from '../supabase';
type Upload={id:string;hash:string;file:File};
type Failure={id:string;name:string;message:string;upload?:Upload};
const maxBytes=5*1024*1024;
export default function KitchenImageUpload({userId,online,onUploaded}:{userId:string;online:boolean;onUploaded:()=>void}){
 const [failures,setFailures]=useState<Failure[]>([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');
 const lock=useRef(false),input=useRef<HTMLInputElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function failed(failure:Failure){if(alive.current)setFailures(old=>[...old.filter(item=>item.id!==failure.id),failure]);}
 async function upload(item:Upload){
  if(!supabase||!navigator.onLine)throw new Error('Mất kết nối. Thử lại khi có mạng.');
  const body=new FormData();body.set('file',item.file);body.set('request_id',item.id);
  const {data,error}=await supabase.functions.invoke('kitchen-image-upload',{body});
  if(error){
   const response=(error as {context?:unknown}).context;
   if(response instanceof Response){const details=await response.clone().json().catch(()=>null);if(typeof details?.error==='string')throw new Error(details.error.slice(0,300));}
   throw new Error('Chưa xác nhận được. Thử lại sau ít phút.');
  }
  if(!data?.ticket?.id)throw new Error('Chưa xác nhận được. Thử lại sau ít phút.');
  try{localStorage.removeItem(`goc-pho-image-upload:${userId}:${item.hash}`);}catch{/* Server ACK is authoritative; retain the UUID if local cleanup fails. */}
  if(alive.current){setFailures(old=>old.filter(f=>f.id!==item.id));onUploaded();}
 }
 async function choose(files:File[]){
  if(lock.current||!online||!navigator.onLine)return;lock.current=true;setBusy(true);setFailures(old=>old.filter(f=>f.upload));
  const seen=new Set<string>();
  try{
   for(const [index,file] of files.entries()){
    if(!alive.current)break;setProgress(`Đang tải ${index+1}/${files.length}…`);
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>maxBytes){failed({id:`invalid:${file.name}`,name:file.name,message:'Chỉ nhận JPG, PNG, WebP tối đa 5 MB.'});continue;}
    let item:Upload|undefined;
    try{
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
     if(seen.has(hash))continue;seen.add(hash);
     const key=`goc-pho-image-upload:${userId}:${hash}`;
     let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
     item={id,hash,file};await upload(item);
    }catch(error){failed({id:item?.id??`prepare:${file.name}`,name:file.name,upload:item,message:error instanceof Error&&error.message?error.message:'Chưa chuẩn bị được ảnh. Thử lại.'});}
   }
  }finally{lock.current=false;if(alive.current){setBusy(false);setProgress('');if(input.current)input.current.value='';}}
 }
 async function retry(item:Upload){
  if(lock.current||!online||!navigator.onLine)return;lock.current=true;setBusy(true);setProgress('Đang tải…');
  try{await upload(item);}catch(error){failed({id:item.id,name:item.file.name,upload:item,message:error instanceof Error&&error.message?error.message:'Chưa xác nhận được. Thử lại.'});}
  finally{lock.current=false;if(alive.current){setBusy(false);setProgress('');}}
 }
 return <div className="kitchen-image-upload">
  <button className="primary kitchen-upload-button" aria-label="Tải ảnh lên" aria-busy={busy} disabled={!online||busy} onClick={()=>input.current?.click()}>{busy?progress||'Đang tải…':'Tải ảnh lên'}</button>
  <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>void choose(Array.from(e.target.files??[]))}/>
  {!!failures.length&&<ul className="image-upload-errors" aria-label="Ảnh tải chưa thành công">{failures.map(item=><li key={item.id}><span role="alert"><strong>{item.name}</strong> · {item.message}</span>{item.upload&&<button disabled={!online||busy} onClick={()=>void retry(item.upload!)}>Thử lại</button>}</li>)}</ul>}
 </div>;
}
