import PosIcon from './PosIcon';
import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import type {OrderLine,TableSession} from './order-model';
type Attempt={requestId:string;sessionId:string;tableId:number;from:number;to:number;itemIds:string[];reason:string};
type Draft={sessionId:string;tableId:number;from:number;items:OrderLine[]};
const money=(n:number)=>n.toLocaleString('vi-VN')+'đ';
export default function BillPanel({userId,table,sessions,disabled,onPending,onChanged}:{userId:string;table:{id:number;name:string}|null;sessions:TableSession[];disabled:boolean;onPending:(v:boolean)=>void;onChanged:(tableId?:number)=>Promise<void>}){
 const key=`goc-pho-bill-move-v1:${userId}`;
 const [pending,setPending]=useState<Attempt|null>(null),[storageError,setStorageError]=useState(false),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState<Draft|null>(null),[ids,setIds]=useState<string[]>([]),[to,setTo]=useState('0'),[error,setError]=useState(''),[message,setMessage]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||!p.sessionId||!Number.isInteger(p.tableId)||!Number.isInteger(p.from)||!Number.isInteger(p.to)||!Array.isArray(p.itemIds)||!p.itemIds.length||typeof p.reason!=='string')throw new Error();setPending(p);}}catch{setStorageError(true);}return()=>{alive.current=false;};},[key]);
 useEffect(()=>{onPending(!!pending||storageError||busy);},[pending,storageError,busy,onPending]);
 const current=table?sessions.find(s=>s.table_id===table.id):undefined;
 const unpaid=current?.orders.flatMap(o=>o.order_items).filter(i=>!i.paid&&!i.cancelled_at)??[];
 const bills=[...new Set(unpaid.map(i=>i.bill_no??1))].sort((a,b)=>a-b);
 const targets=bills.filter(b=>b!==draft?.from);
 function start(from=bills[0]){if(!current||!table||!from)return;setDraft({sessionId:current.id,tableId:table.id,from,items:unpaid.filter(i=>(i.bill_no??1)===from).map(i=>({...i}))});setIds([]);setTo('0');setError('');setMessage('');}
 async function move(){
  if(!supabase||lock.current||storageError)return;
  let attempt=pending;
  if(!attempt){if(disabled||!draft||!ids.length||ids.length>500||(to!=='0'&&!targets.includes(Number(to))))return;
   attempt={requestId:crypto.randomUUID(),sessionId:draft.sessionId,tableId:draft.tableId,from:draft.from,to:Number(to),itemIds:ids,reason:''};
   try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã tách/gộp bill. Chưa gửi yêu cầu.');return;}setPending(attempt);
  }
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const r=await supabase.rpc('move_bill_items',{p_session_id:attempt.sessionId,p_request_id:attempt.requestId,p_from_bill:attempt.from,p_to_bill:attempt.to,p_item_ids:attempt.itemIds,p_reason:attempt.reason});
   if(r.error){
    if(r.error.code==='P0001'&&r.error.message!=='Mã tách/gộp bill đã được sử dụng.'){
     localStorage.removeItem(key);if(alive.current){setPending(null);setDraft(null);setIds([]);}await onChanged(attempt.tableId);throw new Error(r.error.message);
    }
    throw new Error(['PGRST202','42883'].includes(r.error.code)?'Cần chạy migration 012_table_actions_merge.sql rồi Thử lại cùng mã tách/gộp.':`Chưa xác nhận tách/gộp: ${r.error.message}. Thử lại cùng mã tách/gộp.`);
   }
   await onChanged(attempt.tableId);localStorage.removeItem(key);
   if(alive.current){setPending(null);setDraft(null);setIds([]);setMessage(`Đã chuyển ${attempt.itemIds.length} dòng món từ Bill ${attempt.from} sang Bill ${r.data} của Bàn ${attempt.tableId}. Chưa thu tiền.`);}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa xác nhận tách/gộp. Thử lại cùng mã tách/gộp.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="bill-panel" aria-label="Tách gộp bill">
 {table&&!!unpaid.length&&!pending&&<button disabled={disabled||busy||storageError} onClick={()=>start()}><PosIcon name="split"/><span>Tách/gộp bill {table.name}</span></button>}
 {storageError&&<p role="alert">Không đọc được yêu cầu tách/gộp bill chờ. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ.</p>}
 {pending&&<aside role="status"><strong>Tách/gộp bill chờ xác nhận · Bàn {pending.tableId} · Bill {pending.from}</strong><p>{pending.itemIds.length} dòng món → {pending.to===0?'Bill mới':`Bill ${pending.to}`}</p><button disabled={busy} onClick={()=>void move()}>{busy?'Đang xử lý…':'Thử lại cùng mã tách/gộp'}</button></aside>}
 {draft&&current?.id===draft.sessionId&&!pending&&<form className="bill-move-form" onSubmit={e=>{e.preventDefault();void move();}}><h3>Chọn dòng món cần tách/gộp</h3><p>Chuyển toàn bộ số lượng của từng dòng món. Giữ nguyên món bếp; chỉ chọn món chưa trả tiền, chưa hủy.</p>
 <fieldset disabled={disabled||busy||storageError}><label htmlFor="bill-source">Bill nguồn</label><select id="bill-source" value={draft.from} onChange={e=>start(Number(e.target.value))}>{bills.map(b=><option key={b} value={b}>Bill {b}</option>)}</select>
 <button type="button" onClick={()=>setIds(draft.items.map(i=>i.id))}>Chọn tất cả dòng</button><button type="button" onClick={()=>setIds([])}>Bỏ chọn dòng</button>
 {draft.items.map(i=><label key={i.id} className="checkbox-label"><input type="checkbox" checked={ids.includes(i.id)} onChange={e=>setIds(v=>e.target.checked?[...v,i.id]:v.filter(id=>id!==i.id))}/><span>{i.qty} × {i.name} — {money(i.price*i.qty)}{i.note&&<small> · {i.note}</small>}</span></label>)}
 <p>Đã chọn {ids.length} dòng · {money(draft.items.filter(i=>ids.includes(i.id)).reduce((sum,i)=>sum+i.price*i.qty,0))}</p>
 <label htmlFor="bill-target">Chuyển sang</label><select id="bill-target" value={to} onChange={e=>setTo(e.target.value)}><option value="0">Bill mới</option>{targets.map(b=><option key={b} value={b}>Bill {b}</option>)}</select>
 <button type="submit" className="primary" disabled={!ids.length||ids.length>500||(to!=='0'&&!targets.includes(Number(to)))}>Xác nhận tách/gộp bill</button></fieldset><button type="button" disabled={busy} onClick={()=>setDraft(null)}>Đóng tách/gộp bill</button></form>}
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
