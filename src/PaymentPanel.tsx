import {useEffect, useRef, useState} from 'react';
import {supabase} from './supabase';
import type {OrderLine, TableSession} from './order-model';
const money=(n:number)=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
type Bill={id:string;invoice_no:number;table_no:number;gross:number;discount:number;total:number;method:string;cash_received:number|null;change_due:number;paid_at:string;bill_items:{id:string;name:string;price:number;qty:number;note:string}[]};
type Attempt={requestId:string;sessionId:string;tableId:number;itemIds:string[];method:'cash'|'transfer';discountType:'amount'|'percent';discountValue:number;cash:number|null;gross:number;discount:number;total:number;items:OrderLine[];billId?:string};
type Props={userId:string;table:{id:number;name:string}|null;sessions:TableSession[];canPay:boolean;hasDraft:boolean;onPending:(value:boolean)=>void;onPaid:()=>Promise<void>};
function integer(raw:string){const text=raw.trim();if(!/^\d+$/.test(text))return null;const n=Number(text);return Number.isSafeInteger(n)?n:null;}
function discountValue(raw:string,gross:number){
 const text=raw.trim()||'0',percent=text.endsWith('%');
 const n=integer(percent?text.slice(0,-1):text);
 if(n===null||(percent?n>100:n>gross))return null;
 const amount=percent?Math.round(gross*n/100):n;
 return {type:percent?'percent' as const:'amount' as const,value:n,amount};
}
export default function PaymentPanel({userId,table,sessions,canPay,hasDraft,onPending,onPaid}:Props){
 const key=`goc-pho-payment-v1:${userId}`;
 const [pending,setPending]=useState<Attempt|null>(null),[storageError,setStorageError]=useState(false);
 const [draft,setDraft]=useState<{sessionId:string;tableId:number;items:OrderLine[]}|null>(null);
 const [discount,setDiscount]=useState('0'),[cash,setCash]=useState(''),[method,setMethod]=useState<'cash'|'transfer'>('cash');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Bill|null>(null),[recent,setRecent]=useState<Bill[]>([]),[showRecent,setShowRecent]=useState(false),[open,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||!p.sessionId||!Array.isArray(p.itemIds)||!Array.isArray(p.items))throw new Error();setPending(p);setMethod(p.method);setDiscount(String(p.discountValue)+(p.discountType==='percent'?'%':''));setCash(p.cash===null?'':String(p.cash));}}catch{setStorageError(true);}return()=>{mounted.current=false;};},[key]);
 useEffect(()=>{onPending(!!pending||storageError||busy);},[pending,storageError,busy,onPending]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 const lines=pending?.items??draft?.items??[];
 const gross=lines.reduce((s,i)=>s+i.price*i.qty,0);
 const reduction=discountValue(discount,gross);
 const total=gross-(reduction?.amount??0);
 const cashNumber=cash.trim()===''?total:integer(cash);
 const valid=!!reduction&&(method==='transfer'||(cashNumber!==null&&cashNumber>=total));
 const current=table?sessions.find(s=>s.table_id===table.id):undefined;
 const payable=current?.orders.flatMap(o=>o.order_items).filter(i=>!i.paid&&!i.cancelled_at&&i.bill_no===1)??[];
 function start(){if(!current||!table||hasDraft||pending)return;setDraft({sessionId:current.id,tableId:table.id,items:payable.map(i=>({...i}))});setDiscount('0');setCash('');setMethod('cash');setError('');setReceipt(null);setOpen(true);}
 async function loadReceipt(id:string){
  const r=await supabase!.from('bills').select('id,invoice_no,table_no,gross,discount,total,method,cash_received,change_due,paid_at,bill_items(id,name,price,qty,note)').eq('id',id).single();
  if(r.error)throw new Error('Chưa tải được hóa đơn.');
  if(mounted.current){setReceipt(r.data);setDraft(null);setOpen(true);}
 }
 async function pay(){
  if(!supabase||!canPay||lock.current||storageError)return;
  let attempt=pending;
  if(!attempt){
   if(!draft||!valid)return;
   attempt={requestId:crypto.randomUUID(),sessionId:draft.sessionId,tableId:draft.tableId,itemIds:lines.map(i=>i.id),items:lines,method,discountType:reduction!.type,discountValue:reduction!.value,cash:method==='cash'?cashNumber:null,gross,discount:reduction!.amount,total};
   try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã thanh toán. Chưa gửi yêu cầu; kiểm tra bộ nhớ trình duyệt.');return;}
   setPending(attempt);
  }
  lock.current=true;setBusy(true);setError('');
  try{
   if(!attempt.billId){
    const r=await supabase.rpc('pay_bill',{p_session_id:attempt.sessionId,p_request_id:attempt.requestId,p_method:attempt.method,p_expected_item_ids:attempt.itemIds,p_bill_no:1,p_discount_type:attempt.discountType,p_discount_value:attempt.discountValue,p_cash_received:attempt.cash});
    if(r.error){
     const rejected=r.error.code==='P0001'&&['Danh sách món đã thay đổi. Đồng bộ và kiểm tra lại trước khi thanh toán.','Phiên bàn đã thanh toán xong.','Bill không còn món chưa thanh toán.'].includes(r.error.message);
     if(rejected){localStorage.removeItem(key);if(mounted.current){setPending(null);setDraft(null);}await onPaid();throw new Error(r.error.message);}
     throw new Error(`Chưa xác nhận thanh toán: ${r.error.message}. Dùng Thử lại cùng mã; không thu tiền lần nữa.`);
    }
    attempt={...attempt,billId:r.data};
    // Nếu lưu bước này thất bại, mã yêu cầu cũ vẫn cho phép lấy lại cùng hóa đơn.
    try{localStorage.setItem(key,JSON.stringify(attempt));}catch{}
    if(mounted.current)setPending(attempt);
   }
   await onPaid();
   try{await loadReceipt(attempt.billId!);}catch{throw new Error('Đã thanh toán thành công nhưng chưa tải được hóa đơn. Bấm Thử lại cùng mã để tải hóa đơn, không thu thêm tiền.');}
   localStorage.removeItem(key);
   if(mounted.current)setPending(null);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Chưa xác nhận thanh toán. Thử lại cùng mã.');}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 async function recentBills(){
  if(!supabase||busy)return;setBusy(true);setError('');
  try{const r=await supabase.from('bills').select('id,invoice_no,table_no,gross,discount,total,method,cash_received,change_due,paid_at').order('paid_at',{ascending:false}).limit(30);if(r.error)throw new Error('Chưa tải được danh sách hóa đơn.');setRecent(r.data as Bill[]);setShowRecent(true);}catch(e){setError(e instanceof Error?e.message:'Lỗi kết nối.');}finally{setBusy(false);}
 }
 async function reopen(id:string){if(busy||pending)return;setBusy(true);setError('');try{await loadReceipt(id);}catch{setError('Chưa tải được hóa đơn. Vui lòng thử lại.');}finally{setBusy(false);}}
 if(!canPay)return null;
 return <section className="cashier-panel" aria-label="Thu ngân">
 <div className="cashier-actions">{table&&<button className="primary" disabled={!payable.length||hasDraft||!!pending||storageError||busy} onClick={start}>Thanh toán {table.name}</button>}<button disabled={busy||!!pending} onClick={recentBills}>Hóa đơn gần đây</button></div>
 {table&&hasDraft&&<p>Gửi hoặc xóa các món đang chọn trước khi thanh toán.</p>}
 {storageError&&<aside role="alert">Không đọc được dữ liệu thanh toán chờ. Chưa thể thanh toán; không xóa dữ liệu trình duyệt.</aside>}
 {pending&&<aside role="status"><strong>{pending.billId?'Đã thanh toán, chờ tải hóa đơn':'Thanh toán chờ xác nhận'} — Bàn {pending.tableId}</strong><p>{money(pending.total)} · {pending.method==='cash'?'Tiền mặt':'Chuyển khoản'}. Giữ nguyên mã yêu cầu, không thu tiền lần nữa.</p><button disabled={busy} onClick={()=>{setReceipt(null);setOpen(true);void pay();}}>{busy?'Đang xử lý…':'Thử lại cùng mã'}</button></aside>}
 {error&&<aside role="alert">{error}</aside>}
 {showRecent&&<div className="recent-bills"><div className="order-heading"><h3>30 hóa đơn gần nhất</h3><button onClick={()=>setShowRecent(false)}>Ẩn danh sách</button></div>{recent.map(b=><button key={b.id} disabled={busy||!!pending} onClick={()=>void reopen(b.id)}>#{b.invoice_no} · Bàn {b.table_no} · {money(b.total)} · {new Date(b.paid_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</button>)}{!recent.length&&<p>Chưa có hóa đơn.</p>}</div>}
 <dialog ref={dialog} className="payment-dialog" onCancel={e=>{if(busy)e.preventDefault();else setOpen(false);}}><div className="order-heading"><h2>{receipt?'Hóa đơn đã thanh toán':`Thanh toán Bàn ${pending?.tableId??draft?.tableId??''}`}</h2><button className="no-print" disabled={busy} onClick={()=>setOpen(false)}>Đóng</button></div>
 {receipt?<><div className="receipt"><h2>Bún Riêu Góc Phố</h2><p>Hóa đơn #{receipt.invoice_no} · Bàn {receipt.table_no}</p><p>{new Date(receipt.paid_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p><ul>{receipt.bill_items.map(i=><li key={i.id}><div className="order-heading"><span>{i.qty} × {i.name}</span><span>{money(i.price*i.qty)}</span></div>{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul><p>Tạm tính: {money(receipt.gross)}</p><p>Giảm giá: {money(receipt.discount)}</p><h3>Tổng thanh toán: {money(receipt.total)}</h3><p>{receipt.method==='cash'?'Tiền mặt':'Chuyển khoản'}</p>{receipt.method==='cash'&&<><p>Khách đưa: {money(receipt.cash_received??0)}</p><p>Tiền thối: {money(receipt.change_due)}</p></>}<p>Cảm ơn quý khách!</p></div><button className="primary no-print" onClick={()=>window.print()}>In hóa đơn</button></>:<>
 <ul>{lines.map(i=><li key={i.id}>{i.qty} × {i.name} — {money(i.price*i.qty)}{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul>
 <form className="payment-form" onSubmit={e=>{e.preventDefault();void pay();}}><fieldset disabled={!!pending||busy}><legend>Thông tin thanh toán</legend><p>Tạm tính: {money(gross)}</p><label>Giảm giá<input placeholder="10% hoặc 10000; nhập 0 để bỏ" value={discount} onChange={e=>setDiscount(e.target.value)}/></label>{!reduction&&<p role="alert">Nhập số đồng nguyên hoặc phần trăm nguyên, không có dấu chấm. Giảm tối đa bằng tạm tính.</p>}<label htmlFor="payment-method">Hình thức</label><select id="payment-method" value={method} onChange={e=>setMethod(e.target.value as 'cash'|'transfer')}><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option></select><h3>Phải thu: {money(pending?.total??total)}</h3>{method==='cash'&&<><label>Tiền khách đưa<input inputMode="numeric" placeholder={String(total)} value={cash} onChange={e=>setCash(e.target.value)}/></label><small>Để trống nghĩa là khách đưa đúng số tiền. Nhập số đồng, ví dụ 100000.</small>{cashNumber!==null&&cashNumber>=total?<p>Tiền thối: {money(cashNumber-total)}</p>:<p role="alert">Tiền khách đưa chưa đủ hoặc không hợp lệ.</p>}</>}{method==='transfer'&&<p>Chỉ xác nhận sau khi đã kiểm tra tiền vào tài khoản quán.</p>}</fieldset><button className="primary" disabled={busy||!!pending||!valid||!draft} type="submit">{busy?'Đang xử lý…':method==='cash'?'Xác nhận thu tiền mặt':'Xác nhận đã nhận chuyển khoản'}</button></form>
 {pending&&<button disabled={busy} onClick={()=>void pay()}>Thử lại cùng mã</button>}
 {error&&<p role="alert">{error}</p>}
 </>}
 </dialog></section>;
}
