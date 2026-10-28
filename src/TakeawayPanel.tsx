import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import ConfirmDialog from './ConfirmDialog';
type Place={id:number;name:string;session_id:string;closed:boolean};
type Attempt={requestId:string;note:string};
export default function TakeawayPanel({userId,disabled,onPending,onCreated}:{userId:string;disabled:boolean;onPending:(v:boolean)=>void;onCreated:(place:Place)=>Promise<void>}){
 const key=`goc-pho-takeaway-v1:${userId}`;
 const [open,setOpen]=useState(false),[note,setNote]=useState(''),[pending,setPending]=useState<Attempt|null>(null),[busy,setBusy]=useState(false),[storageError,setStorageError]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||typeof p.note!=='string')throw new Error();setPending(p);setNote(p.note);setOpen(true);}}catch{setStorageError(true);}return()=>{alive.current=false;};},[key]);
 useEffect(()=>onPending(!!pending||busy||storageError),[pending,busy,storageError,onPending]);
 async function create(){
  if(!supabase||lock.current||storageError||(!pending&&disabled))return;
  let attempt=pending;
  if(!attempt){attempt={requestId:crypto.randomUUID(),note:note.trim()};try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã tạo đơn. Chưa gửi yêu cầu.');return;}setPending(attempt);}
  lock.current=true;setBusy(true);setError('');
  try{const r=await supabase.rpc('create_takeaway',{p_request_id:attempt.requestId,p_customer_note:attempt.note});if(r.error)throw new Error(r.error.message);
   await onCreated(r.data as Place);localStorage.removeItem(key);if(alive.current){setPending(null);setOpen(false);setNote('');}
  }catch(e){if(alive.current)setError(`Chưa xác nhận tạo đơn: ${e instanceof Error?e.message:'Lỗi kết nối'}. Thử lại cùng mã để tránh tạo trùng đơn.`);}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="takeaway-create"><button className="primary" disabled={disabled&&!pending||busy||storageError} onClick={()=>{setError('');setOpen(true);}}>{pending?'Kiểm tra tạo đơn mang về':'Tạo đơn mang về'}</button>{storageError&&<p role="alert">Không đọc được mã tạo đơn chờ. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ.</p>}
 <ConfirmDialog danger={false} open={open} title="Tạo đơn mang về" busy={busy} error={error} confirmLabel={pending?'Thử lại cùng mã tạo đơn':'Tạo đơn'} onConfirm={()=>void create()} onClose={()=>setOpen(false)}><label>Tên khách / ghi chú đơn (tùy chọn)<input maxLength={120} value={note} disabled={!!pending||busy} onChange={e=>setNote(e.target.value)} placeholder="Ví dụ: Chị Lan, nhận lúc 11:30"/></label><p>Đơn có mã riêng, không chiếm bàn. Chọn món và gửi bếp sau khi tạo.</p></ConfirmDialog></section>;
}
export function DiscardTakeaway({sessionId,disabled,onBusy,onDone}:{sessionId:string;disabled:boolean;onBusy:(v:boolean)=>void;onDone:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 async function discard(){if(!supabase||lock.current||disabled)return;lock.current=true;setBusy(true);onBusy(true);setError('');try{const r=await supabase.rpc('close_empty_takeaway',{p_session_id:sessionId});if(r.error)throw new Error(r.error.message);setOpen(false);await onDone();}catch(e){setError(e instanceof Error?e.message:'Chưa xác nhận bỏ đơn. Có thể thử lại cùng đơn.');}finally{lock.current=false;setBusy(false);onBusy(false);}}
 return <><button className="danger-outline" disabled={disabled} onClick={()=>setOpen(true)}>Bỏ đơn mang về trống</button><ConfirmDialog open={open} title="Bỏ đơn mang về trống?" busy={busy} error={error} confirmLabel="Xác nhận bỏ đơn" onConfirm={()=>void discard()} onClose={()=>setOpen(false)}><p>Chỉ bỏ đơn chưa có món đã gửi. Đơn đã gửi món cần thu ngân xử lý hủy.</p></ConfirmDialog></>;
}
