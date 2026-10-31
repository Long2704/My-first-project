import {placeLabel} from './order-model';
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from './supabase';
import type {OrderLine, TableSession} from './order-model';
import {formatMoney as money} from './format';
import './payment.css';
type Bill={service_label?:string;id:string;invoice_no:number;table_no:number;bill_no:number;gross:number;discount:number;total:number;method:string;cash_received:number|null;change_due:number;paid_at:string;bill_items:{id:string;name:string;price:number;qty:number;note:string}[]};
type Attempt={tableName?:string;requestId:string;sessionId:string;tableId:number;itemIds:string[];method:'cash'|'transfer';discountType:'amount'|'percent';discountValue:number;cash:number|null;gross:number;discount:number;total:number;items:OrderLine[];billNo?:number;billId?:string};
export type PaymentHandle={open:()=>void};
type Props={onPendingAmount?:(amount:{total:number;tableId:number}|null)=>void;compact?:boolean;onReady?:(ready:boolean)=>void;userId:string;table:{id:number;name:string}|null;sessions:TableSession[];canPay:boolean;canDiscount:boolean;hasDraft:boolean;onPending:(value:boolean)=>void;onPaid:()=>Promise<void>;receiptRequest?:{id:string;key:number}|null;onReceiptError?:(message:string)=>void};
function integer(raw:string){const text=raw.trim();if(!/^\d+$/.test(text))return null;const n=Number(text);return Number.isSafeInteger(n)?n:null;}
const PaymentPanel=forwardRef<PaymentHandle,Props>(function PaymentPanel({compact=false,onReady,onPendingAmount,userId,table,sessions,canPay,canDiscount,hasDraft,onPending,onPaid,receiptRequest,onReceiptError},ref){
 const key=`goc-pho-payment-v1:${userId}`;
 const [pending,setPending]=useState<Attempt|null>(null),[storageError,setStorageError]=useState(false);
 const [draft,setDraft]=useState<{sessionId:string;tableId:number;tableName?:string;billNo:number;items:OrderLine[]}|null>(null);
 const [chosen,setChosen]=useState<{sessionId:string;billNo:number}|null>(null);
 const [cash,setCash]=useState(''),[method,setMethod]=useState<'cash'|'transfer'>('cash');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Bill|null>(null),[open,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||!p.sessionId||!Array.isArray(p.itemIds)||!Array.isArray(p.items))throw new Error();setPending(p);setMethod(p.method);setCash(p.cash===null?'':String(p.cash));}}catch{setStorageError(true);}return()=>{mounted.current=false;};},[key]);
 useEffect(()=>{onPendingAmount?.(pending?{total:pending.total,tableId:pending.tableId}:null);},[pending?.total,pending?.tableId,onPendingAmount]);
 useEffect(()=>{onPending(!!pending||storageError||busy);},[pending,storageError,busy,onPending]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 const lines=pending?.items??draft?.items??[];
 const gross=lines.reduce((s,i)=>s+i.price*i.qty,0);
 const total=pending?.total??gross;
 const cashNumber=cash.trim()===''?total:integer(cash);
 const valid=Number.isSafeInteger(total)&&total>=0&&(method==='transfer'||(cashNumber!==null&&cashNumber>=total));
 const current=table?sessions.find(s=>s.table_id===table.id):undefined;
 const unpaid=current?.orders.flatMap(o=>o.order_items).filter(i=>!i.paid&&!i.cancelled_at)??[];
 const billNumbers=[...new Set(unpaid.map(i=>i.bill_no??1))].sort((a,b)=>a-b);
 const billNo=current&&chosen?.sessionId===current.id&&billNumbers.includes(chosen.billNo)?chosen.billNo:billNumbers[0]??1;
 const payable=unpaid.filter(i=>(i.bill_no??1)===billNo);
 function start(){if(!current||!table||hasDraft||pending||!payable.length)return;setDraft({sessionId:current.id,tableId:table.id,tableName:table.name,billNo,items:payable.map(i=>({...i}))});setCash(String(payable.reduce((sum,item)=>sum+item.price*item.qty,0)));setMethod('cash');setError('');setReceipt(null);setOpen(true);}
 useImperativeHandle(ref,()=>({open:()=>{if(pending){setReceipt(null);setOpen(true);void pay();}else start();}}));
 useEffect(()=>{onReady?.(canPay&&!storageError&&!busy&&(!!pending||!!current&&payable.length>0&&!hasDraft));},[canPay,current?.id,payable.length,hasDraft,!!pending,storageError,busy,onReady]);
 async function loadReceipt(id:string){
  const r=await supabase!.from('bills').select('service_label,id,invoice_no,table_no,bill_no,gross,discount,total,method,cash_received,change_due,paid_at,bill_items(id,name,price,qty,note)').eq('id',id).single();
  if(r.error)throw new Error('Chưa tải được hóa đơn.');
  if(mounted.current){setReceipt(r.data);setDraft(null);setOpen(true);}
 }
 async function pay(){
  if(!navigator.onLine){setError('Mất kết nối. Kết nối mạng trước khi thanh toán.');return;}
  if(!supabase||!canPay||lock.current||storageError)return;
  let attempt=pending;
  if(attempt&&!attempt.billId&&attempt.discountValue>0&&!canDiscount){setError('Yêu cầu chờ có giảm giá. Liên hệ Bún Riêu Góc Phố để đối chiếu; không tạo thanh toán mới.');return;}
  if(!attempt){
   if(!draft||!valid)return;
   attempt={requestId:crypto.randomUUID(),sessionId:draft.sessionId,tableId:draft.tableId,tableName:draft.tableName,billNo:draft.billNo,itemIds:lines.map(i=>i.id),items:lines,method,discountType:'amount',discountValue:0,cash:method==='cash'?cashNumber:null,gross,discount:0,total};
   try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã thanh toán. Chưa gửi yêu cầu; kiểm tra bộ nhớ trình duyệt.');return;}
   setPending(attempt);
  }
  lock.current=true;setBusy(true);setError('');
  try{
   if(!attempt.billId){
    const r=await supabase.rpc('pay_bill',{p_session_id:attempt.sessionId,p_request_id:attempt.requestId,p_method:attempt.method,p_expected_item_ids:attempt.itemIds,p_bill_no:attempt.billNo??1,p_discount_type:attempt.discountType,p_discount_value:attempt.discountValue,p_cash_received:attempt.cash});
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
 async function reopen(id:string){if(busy||pending)return;setBusy(true);setError('');try{await loadReceipt(id);}catch{setError('Chưa tải được hóa đơn. Vui lòng thử lại.');onReceiptError?.('Chưa tải được hóa đơn. Vui lòng thử lại.');}finally{setBusy(false);}}
 useEffect(()=>{if(receiptRequest&&canPay)void reopen(receiptRequest.id);},[receiptRequest?.key]);
 if(!canPay)return null;
 return <section className={`cashier-panel${compact?' compact-payment-controller':''}`} aria-label="Thanh toán">
 {table&&(billNumbers.length>1||billNo!==1)&&<><label htmlFor="pay-bill-number">Bill thanh toán</label><select id="pay-bill-number" value={billNo} disabled={hasDraft||!!pending||storageError||busy} onChange={e=>{if(current)setChosen({sessionId:current.id,billNo:Number(e.target.value)});}}>{billNumbers.map(b=><option key={b} value={b}>Bill {b} · {money(unpaid.filter(i=>(i.bill_no??1)===b).reduce((s,i)=>s+i.price*i.qty,0))}</option>)}</select></>}
 <div className="cashier-actions">{table&&<button className="primary" disabled={!payable.length||hasDraft||!!pending||storageError||busy} onClick={start}>Thanh toán {table.name}{billNumbers.length>1||billNo!==1?` · Bill ${billNo}`:''}</button>}</div>
 {table&&hasDraft&&<p>Gửi hoặc xóa các món đang chọn trước khi thanh toán.</p>}
 {storageError&&<aside role="alert">Không đọc được dữ liệu thanh toán chờ. Chưa thể thanh toán; không xóa dữ liệu trình duyệt.</aside>}
 {pending&&<aside role="status"><strong>{pending.billId?'Đã thanh toán, chờ tải hóa đơn':'Thanh toán chờ xác nhận'} — {pending.tableName??placeLabel(pending.tableId)} · Bill {pending.billNo??1}</strong><p>{money(pending.total)} · {pending.method==='cash'?'Tiền mặt':'Chuyển khoản'}. Giữ nguyên mã yêu cầu, không thu tiền lần nữa.</p><button disabled={busy} onClick={()=>{setReceipt(null);setOpen(true);void pay();}}>{busy?'Đang xử lý…':'Thử lại cùng mã'}</button></aside>}
 {error&&<aside role="alert">{error}</aside>}
 {createPortal(<dialog ref={dialog} className={`payment-dialog payment-sheet${receipt?' has-receipt':''}`} aria-labelledby="payment-dialog-title" onCancel={e=>{if(busy)e.preventDefault();else setOpen(false);}}>
 <header className="payment-header"><div><h2 id="payment-dialog-title">{receipt?'Hóa đơn đã thanh toán':`Thanh toán ${pending?.tableName??draft?.tableName??table?.name??placeLabel(pending?.tableId??draft?.tableId??table?.id??0)}`}</h2>{!receipt&&(pending||draft)&&<p>Bill {pending?.billNo??draft?.billNo??1}</p>}</div><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Đóng</button></header>
 {receipt?<div className="payment-body"><div className="receipt"><h2>Bún Riêu Góc Phố</h2><p>Hóa đơn #{receipt.invoice_no} · {receipt.service_label||placeLabel(receipt.table_no)} · Bill {receipt.bill_no??1}</p><p>{new Date(receipt.paid_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p><ul>{receipt.bill_items.map(i=><li key={i.id}><div className="order-heading"><span>{i.qty} × {i.name}</span><span>{money(i.price*i.qty)}</span></div>{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul>{receipt.discount>0&&<><p>Tạm tính: {money(receipt.gross)}</p><p>Giảm giá: {money(receipt.discount)}</p></>}<h3>Tổng thanh toán: {money(receipt.total)}</h3><p>{receipt.method==='cash'?'Tiền mặt':'Chuyển khoản'}</p>{receipt.method==='cash'&&<><p>Khách đưa: {money(receipt.cash_received??0)}</p><p>Tiền thối: {money(receipt.change_due)}</p></>}<p>Cảm ơn quý khách!</p></div></div>:<>
 <section className="payment-amount" aria-label="Số tiền cần thanh toán"><span>{pending?(pending.billId?'Đã thanh toán':'Chờ xác nhận'):draft?'Cần thanh toán':'Kiểm tra lại đơn'}</span>{pending||draft?<strong>{money(total)}</strong>:<p>Đóng và mở lại thanh toán để kiểm tra đơn.</p>}{pending&&pending.discount>0&&<small>Đã giảm {money(pending.discount)} trong yêu cầu đang chờ</small>}</section>
 <div className="payment-body">
 {compact&&draft&&!pending&&billNumbers.length>1&&current?.id===draft.sessionId&&<label className="payment-bill-choice">Bill thanh toán<select aria-label="Bill thanh toán" value={draft.billNo} disabled={busy} onChange={e=>{const next=Number(e.target.value),items=unpaid.filter(i=>(i.bill_no??1)===next).map(i=>({...i}));setChosen({sessionId:current.id,billNo:next});setDraft({...draft,billNo:next,items});setCash(String(items.reduce((sum,item)=>sum+item.price*item.qty,0)));}}>{billNumbers.map(no=><option key={no} value={no}>Bill {no} · {money(unpaid.filter(i=>(i.bill_no??1)===no).reduce((sum,i)=>sum+i.price*i.qty,0))}</option>)}</select></label>}
 {(pending||draft)&&<form id="payment-confirm-form" className="payment-form" onSubmit={e=>{e.preventDefault();void pay();}}><fieldset disabled={!!pending||busy}>
 <div className="payment-methods" role="group" aria-label="Hình thức thanh toán"><button type="button" aria-pressed={method==='cash'} onClick={()=>setMethod('cash')}>Tiền mặt</button><button type="button" aria-pressed={method==='transfer'} onClick={()=>setMethod('transfer')}>Chuyển khoản</button></div>
 {method==='cash'?<><label className="payment-cash-label" htmlFor="payment-cash">Tiền khách đưa</label><div className="payment-cash-input"><input id="payment-cash" inputMode="numeric" autoComplete="off" placeholder={String(total)} value={cash} onChange={e=>setCash(e.target.value)}/><span aria-hidden="true">đ</span></div>{cashNumber!==null&&cashNumber>=total?<div className="payment-change"><span>Tiền thối</span><strong>{money(cashNumber-total)}</strong></div>:<p className="payment-input-error" role="alert">{cashNumber===null?'Nhập số tiền hợp lệ.':'Tiền khách đưa chưa đủ.'}</p>}</>:<p className="payment-transfer-note">Chỉ xác nhận sau khi đã kiểm tra tiền vào tài khoản quán.</p>}
 </fieldset></form>}
 {(pending||draft)&&<details className="payment-items"><summary><span>Chi tiết món</span><span>{lines.reduce((sum,item)=>sum+item.qty,0)} món</span></summary><ul>{lines.map(i=><li key={i.id}><div><span>{i.qty} × {i.name}</span><strong>{money(i.price*i.qty)}</strong></div>{i.note&&<p>{i.note}</p>}</li>)}</ul></details>}
 {pending&&<p className="payment-pending-note" role="status">{pending.billId?'Đã thanh toán, chờ tải hóa đơn. Không thu thêm tiền.':'Đang chờ xác nhận thanh toán. Thử lại cùng mã, không thu tiền lần nữa.'}</p>}
 {error&&<p className="payment-input-error" role="alert">{error}</p>}
 </div>
 <footer className="payment-footer">{pending?<button className="primary" type="button" disabled={busy} onClick={()=>void pay()}>{busy?'Đang xử lý…':'Thử lại cùng mã'}</button>:<button className="primary" disabled={busy||!valid||!draft} type="submit" form="payment-confirm-form">{busy?'Đang xử lý…':method==='cash'?'Xác nhận thu tiền mặt':'Xác nhận đã nhận chuyển khoản'}</button>}</footer>
 </>}
 </dialog>,document.body)}</section>;

});
export default PaymentPanel;
