import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import type {TableSession} from './order-model';
type Table={id:number;name:string};
type Attempt={requestId:string;sessionId:string;from:number;to:number;reason:string};
type Props={userId:string;table:Table|null;tables:Table[];sessions:TableSession[];disabled:boolean;onPending:(v:boolean)=>void;onTransferred:(tableId:number)=>Promise<void>};
export default function TransferPanel({userId,table,tables,sessions,disabled,onPending,onTransferred}:Props){
 const key=`goc-pho-transfer-v1:${userId}`;
 const [pending,setPending]=useState<Attempt|null>(null),[storageError,setStorageError]=useState(false),[busy,setBusy]=useState(false);
 const [open,setOpen]=useState(false),[to,setTo]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||!p.sessionId||!Number.isInteger(p.from)||!Number.isInteger(p.to)||(p.reason!==undefined&&typeof p.reason!=='string'))throw new Error();setPending(p);}}catch{setStorageError(true);}return()=>{alive.current=false;};},[key]);
 useEffect(()=>{onPending(!!pending||storageError||busy);},[pending,storageError,busy,onPending]);
 const current=table?sessions.find(s=>s.table_id===table.id):undefined;
 const available=tables.filter(t=>t.id!==table?.id&&!sessions.some(s=>s.table_id===t.id));
 async function transfer(){
  if(!supabase||lock.current||storageError)return;
  let attempt=pending;
  if(!attempt){
   if(disabled||!current||!table||!available.some(t=>t.id===Number(to)))return;
   attempt={requestId:crypto.randomUUID(),sessionId:current.id,from:table.id,to:Number(to),reason:''};
   try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã chuyển bàn. Chưa gửi yêu cầu.');return;}
   setPending(attempt);
  }
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const r=await supabase.rpc('transfer_table',{p_session_id:attempt.sessionId,p_from_table:attempt.from,p_to_table:attempt.to,p_request_id:attempt.requestId,p_reason:attempt.reason??''});
   if(r.error){
    if(['PGRST202','42883'].includes(r.error.code))throw new Error('Database chưa có chuyển bàn. Cần chạy migration 007_table_transfer.sql, rồi bấm Thử lại cùng mã chuyển bàn.');
    const rejected=r.error.code==='P0001'&&['Bàn đích đang có khách. Chọn bàn trống khác.','Bàn đích không hoạt động.','Phiên bàn đã đóng hoặc không tồn tại.','Phiên khách đã chuyển sang bàn khác. Đồng bộ và kiểm tra lại.','Bạn không có quyền chuyển bàn.'].includes(r.error.message);
    if(rejected){localStorage.removeItem(key);if(alive.current){setPending(null);setOpen(false);}await onTransferred(attempt.from);throw new Error(r.error.message);}
    throw new Error(`Chưa xác nhận chuyển bàn: ${r.error.message}. Dùng Thử lại cùng mã; không chuyển lại bằng yêu cầu mới.`);
   }
   await onTransferred(attempt.to);
   localStorage.removeItem(key);
   if(alive.current){setPending(null);setOpen(false);setTo('');setMessage(`Đã chuyển Bàn ${attempt.from} sang Bàn ${attempt.to}. Báo bếp và phục vụ vị trí mới.`);}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa xác nhận chuyển bàn. Dùng Thử lại cùng mã.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="transfer-panel" aria-label="Chuyển bàn">
 {table&&current&&!pending&&<button disabled={disabled||busy||storageError} onClick={()=>{setOpen(v=>!v);setError('');setMessage('');}}>Chuyển {table.name}</button>}
 {table&&current&&disabled&&!pending&&<p>Gửi hoặc xóa món đang chọn ở các bàn, xử lý yêu cầu chờ và đồng bộ trước khi chuyển bàn.</p>}
 {storageError&&<p role="alert">Không đọc được dữ liệu chuyển bàn chờ. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ.</p>}
 {pending&&<aside role="status"><strong>Chuyển bàn chờ xác nhận: Bàn {pending.from} → Bàn {pending.to}</strong><p>Giữ nguyên mã để tránh chuyển nhầm phiên khách.</p><button disabled={busy} onClick={()=>void transfer()}>{busy?'Đang chuyển…':'Thử lại cùng mã chuyển bàn'}</button></aside>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {open&&!pending&&current&&<form className="transfer-form" onSubmit={e=>{e.preventDefault();void transfer();}}><h3>Chuyển toàn bộ {table?.name}</h3><p>Giữ nguyên món và trạng thái bếp. Chỉ chuyển sang bàn trống; chưa gộp bàn.</p><label htmlFor="transfer-target">Bàn đích</label><select id="transfer-target" value={to} disabled={disabled||busy} onChange={e=>setTo(e.target.value)}><option value="">Chọn bàn trống</option>{available.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>{!available.length&&<p>Không có bàn trống.</p>}<button className="primary" disabled={disabled||busy||!available.some(t=>t.id===Number(to))} type="submit">Xác nhận chuyển bàn</button><button type="button" onClick={()=>setOpen(false)}>Đóng chuyển bàn</button></form>}
 </section>;
}
