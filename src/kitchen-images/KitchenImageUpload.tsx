import {useRef,useState} from 'react';
import {supabase} from '../supabase';
type Upload={id:string;hash:string;file:File;state:'waiting'|'sending'|'failed'|'done';message:string};
const maxBytes=5*1024*1024;
export default function KitchenImageUpload({userId,online,onUploaded}:{userId:string;online:boolean;onUploaded:()=>void}){
 const [items,setItems]=useState<Upload[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),input=useRef<HTMLInputElement>(null);
 function change(id:string,patch:Partial<Upload>){setItems(old=>old.map(item=>item.id===id?{...item,...patch}:item));}
 async function choose(files:File[]){
  if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{
   const picked:Upload[]=[];
   for(const file of files){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>maxBytes){setMessage('Chỉ nhận JPG, PNG, WebP tối đa 5 MB mỗi ảnh.');continue;}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
    // Persist UUID/hash only. If reply is lost or browser reloads, reselecting the same file retries the same operation.
    const key=`goc-pho-image-upload:${userId}:${hash}`;
    let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
    if(!picked.some(i=>i.id===id)&&!items.some(i=>i.id===id))picked.push({id,hash,file,state:'waiting',message:''});
   }
   setItems(old=>[...old,...picked]);
  }catch{setMessage('Chưa chuẩn bị được ảnh. Kiểm tra bộ nhớ trình duyệt và thử lại.');}
  finally{lock.current=false;setBusy(false);if(input.current)input.current.value='';}
 }
 async function send(item:Upload){
  if(lock.current||!online||!navigator.onLine||!supabase)return;
  lock.current=true;setBusy(true);change(item.id,{state:'sending',message:''});
  try{
   const body=new FormData();body.set('file',item.file);body.set('request_id',item.id);
   const {data,error}=await supabase.functions.invoke('kitchen-image-upload',{body});
   if(error){
    const response=(error as {context?:unknown}).context;
    if(response instanceof Response){const details=await response.clone().json().catch(()=>null);if(typeof details?.error==='string')throw new Error(details.error.slice(0,300));}
    throw new Error();
   }
   if(!data?.ticket?.id)throw new Error();
   localStorage.removeItem(`goc-pho-image-upload:${userId}:${item.hash}`);
   change(item.id,{state:'done',message:'Đã tạo phiếu ảnh.'});onUploaded();
  }catch(error){change(item.id,{state:'failed',message:error instanceof Error&&error.message?error.message:'Chưa xác nhận được. Giữ nguyên ảnh, bấm Thử lại sau ít phút.'});}
  finally{lock.current=false;setBusy(false);}
 }
 async function cleanup(){
  if(lock.current||!online||!navigator.onLine||!supabase)return;lock.current=true;setBusy(true);setMessage('');
  try{const {data,error}=await supabase.functions.invoke('kitchen-image-upload',{body:{action:'cleanup'}});if(error)throw error;setMessage(`Đã dọn ${data.cleaned} lượt tải dở hết hạn.`);}catch{setMessage('Chưa dọn được ảnh tải dở. Phiếu ảnh đã lưu được giữ nguyên.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="kitchen-image-upload" aria-label="Tải phiếu ảnh">
  <div className="image-upload-heading"><div><strong>Phiếu ảnh cho bếp</strong><p>Mỗi ảnh là một phiếu riêng · JPG, PNG, WebP · tối đa 5 MB/ảnh</p></div><button className="primary" disabled={!online||busy} onClick={()=>input.current?.click()}>Tải ảnh lên</button></div>
  <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>void choose(Array.from(e.target.files??[]))}/>
  {!!items.length&&<ul className="image-upload-list">{items.map(item=><li key={item.id}><span>{item.file.name}<small role="status">{item.message|| (item.state==='sending'?'Đang tải…':'Sẵn sàng tải')}</small></span>{item.state!=='done'&&<button disabled={!online||busy} onClick={()=>void send(item)}>{item.state==='failed'?'Thử lại':'Gửi ảnh'}</button>}</li>)}</ul>}
  {message&&<p role="status">{message}</p>}
  <details><summary>Ảnh tải dở</summary><p>Chỉ dọn lượt tải dở đã hết hạn hơn 1 giờ. Giữ toàn bộ ảnh đã thành phiếu.</p><button disabled={!online||busy} onClick={()=>void cleanup()}>Dọn ảnh tải dở</button></details>
 </section>;
}
