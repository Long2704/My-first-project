import {placeLabel} from './order-model';
import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
type Invoice={service_label?:string;id:string;invoice_no:number;table_no:number;bill_no:number;total:number;method:string;paid_at:string};
export default function InvoiceHistory({active,disabled,ownOnly=false,onOpen}:{active:boolean;disabled:boolean;ownOnly?:boolean;onOpen:(id:string)=>void}){
 const [rows,setRows]=useState<Invoice[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function load(){if(!supabase||lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const r=await supabase.from('bills').select('service_label,id,invoice_no,table_no,bill_no,total,method,paid_at').order('paid_at',{ascending:false}).order('id',{ascending:false}).limit(30);
  if(r.error)throw new Error('Chưa tải được danh sách hóa đơn. Vui lòng thử lại.');
  if(alive.current)setRows(r.data as Invoice[]);
 }catch(e){if(alive.current){setRows([]);setError(e instanceof Error?e.message:'Không tải được hóa đơn.');}}finally{lock.current=false;if(alive.current)setBusy(false);}}
 useEffect(()=>{if(active)void load();},[active]);
 return <section className="invoice-history" aria-label="Danh sách hóa đơn"><div className="panel-heading"><div><h2>{ownOnly?'30 hóa đơn gần nhất của tôi':'30 hóa đơn gần nhất'}</h2><p>{ownOnly?'Chỉ hiển thị hóa đơn do bạn thanh toán.':'Mở hóa đơn để xem chi tiết hoặc in lại.'}</p></div><button disabled={busy} onClick={()=>void load()}>Tải lại hóa đơn</button></div>
 {busy?<p role="status">Đang tải hóa đơn…</p>:error?<p role="alert">{error}</p>:!rows.length?<div className="empty-state"><h3>Chưa có hóa đơn</h3><p>Hóa đơn đã thanh toán sẽ xuất hiện tại đây.</p></div>:<div className="invoice-list">{rows.map(b=><button key={b.id} disabled={disabled} onClick={()=>onOpen(b.id)}><span><strong>#{b.invoice_no} · {b.service_label||placeLabel(b.table_no)} · Bill {b.bill_no??1}</strong><small>{new Date(b.paid_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} · {b.method==='cash'?'Tiền mặt':'Chuyển khoản'}</small></span><strong>{Number(b.total).toLocaleString('vi-VN')}đ</strong></button>)}</div>}
 </section>;
}
