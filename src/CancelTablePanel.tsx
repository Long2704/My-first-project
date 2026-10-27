import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import type {OrderLine,TableSession} from './order-model';
import ConfirmDialog from './ConfirmDialog';
type Attempt={requestId:string;sessionId:string;tableId:number;items:OrderLine[]};
export default function CancelTablePanel({userId,table,sessions,disabled,onPending,onChanged,onMessage}:{userId:string;table:{id:number;name:string}|null;sessions:TableSession[];disabled:boolean;onPending:(v:boolean)=>void;onChanged:()=>Promise<void>;onMessage:(message:string)=>void}){
 const key=`goc-pho-cancel-table-v1:${userId}`;
 const [pending,setPending]=useState<Attempt|null>(null),[draft,setDraft]=useState<Attempt|null>(null),[storageError,setStorageError]=useState(false),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||!p.sessionId||!Number.isInteger(p.tableId)||!Array.isArray(p.items)||!p.items.length||p.items.some((i:OrderLine)=>!i.id))throw new Error();setPending(p);}}catch{setStorageError(true);}return()=>{alive.current=false;};},[key]);
 useEffect(()=>{onPending(!!pending||storageError||busy);},[pending,storageError,busy,onPending]);
 const current=table?sessions.find(s=>s.table_id===table.id):undefined;
 const lines=current?.orders.flatMap(o=>o.order_items).filter(i=>!i.paid&&!i.cancelled_at)??[];
 function start(){if(!table||!current||!lines.length||disabled||pending)return;setDraft({requestId:crypto.randomUUID(),sessionId:current.id,tableId:table.id,items:lines.map(i=>({...i}))});setError('');onMessage('');setOpen(true);}
 async function cancel(){
  if(!supabase||lock.current||storageError||(!pending&&disabled))return;
  const attempt=pending??draft;if(!attempt)return;
  if(!pending){try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã hủy bàn. Chưa gửi yêu cầu.');return;}setPending(attempt);}
  lock.current=true;setBusy(true);setError('');
  try{
   const r=await supabase.rpc('cancel_table_session',{p_session_id:attempt.sessionId,p_request_id:attempt.requestId,p_expected_item_ids:attempt.items.map(i=>i.id)});
   if(r.error){
    if(r.error.code==='P0001'&&['Bạn không có quyền hủy bàn.','Phiên bàn không còn mở.','Bàn vừa được chuyển. Đồng bộ và kiểm tra lại.','Danh sách món đã thay đổi. Đồng bộ và xác nhận hủy bàn lại.'].includes(r.error.message)){
     localStorage.removeItem(key);if(alive.current){setPending(null);setDraft(null);setOpen(false);}await onChanged();throw new Error(r.error.message);
    }
    throw new Error(['PGRST202','42883'].includes(r.error.code)?'Cần chạy migration 011_cancellations_kitchen_history.sql rồi Thử lại cùng mã hủy bàn.':`Chưa xác nhận hủy bàn: ${r.error.message}. Thử lại cùng mã hủy bàn.`);
   }
   if(alive.current)setOpen(false);await onChanged();localStorage.removeItem(key);
   if(alive.current){setPending(null);setDraft(null);onMessage(`Đã hủy các món chưa thanh toán của Bàn ${attempt.tableId}. Hóa đơn đã trả được giữ nguyên.`);}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa xác nhận hủy bàn. Thử lại cùng mã hủy bàn.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 const snapshot=pending??draft;
 return <section className="cancel-table-panel" aria-label="Hủy bàn">{table&&lines.length>0&&!pending&&<button className="danger-outline" disabled={disabled||busy||storageError} onClick={start}>Hủy cả {table.name}</button>}
 {storageError&&<p role="alert">Không đọc được yêu cầu hủy bàn chờ. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ.</p>}
 {pending&&<aside role="status"><strong>Hủy bàn chờ xác nhận · Bàn {pending.tableId}</strong><p>Giữ nguyên mã và danh sách {pending.items.length} dòng món.</p><button disabled={busy} onClick={()=>{setOpen(true);}}>Kiểm tra yêu cầu hủy bàn</button></aside>}
 {!open&&error&&<p role="alert">{error}</p>}
 <ConfirmDialog open={open} title={`Xác nhận hủy Bàn ${snapshot?.tableId??''}`} busy={busy} error={error} confirmLabel={pending?'Thử lại cùng mã hủy bàn':'Xác nhận hủy cả bàn'} onConfirm={()=>void cancel()} onClose={()=>setOpen(false)}><p>Hủy toàn bộ món chưa thanh toán trong danh sách dưới đây. Báo bếp nếu đã chuẩn bị món.</p><ul>{snapshot?.items.map(i=><li key={i.id}>{i.qty} × {i.name} · {(i.price*i.qty).toLocaleString('vi-VN')}đ</li>)}</ul><p>Các món đã trả tiền và hóa đơn được giữ nguyên.</p></ConfirmDialog>
 </section>;
}
