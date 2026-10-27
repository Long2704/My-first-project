import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
const money=(n:number)=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
type Day={day:string;invoices:number;gross:number;discount:number;total:number;cash:number;transfer:number};
type Report={from:string;to:string;generated_at:string;invoices:number;gross:number;discount:number;total:number;cash:number;transfer:number;days:Day[];products:{name:string;qty:number;gross:number}[]};
export default function RevenuePanel(){
 const [open,setOpen]=useState(false),[from,setFrom]=useState(today),[to,setTo]=useState(today);
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const span=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 const valid=!!from&&!!to&&Number.isFinite(span)&&span>=0&&span<=365;
 async function load(){
  if(!supabase||lock.current||!valid)return;
  lock.current=true;setBusy(true);setReport(null);setError('');
  try{
   const r=await supabase.rpc('revenue_report',{p_from:from,p_to:to});
   if(r.error)throw new Error(['PGRST202','42883'].includes(r.error.code)?'Database chưa có báo cáo doanh thu. Cần chạy migration 006_revenue_report.sql.':'Không tải được báo cáo. Kiểm tra kết nối và quyền tài khoản rồi thử lại.');
   if(alive.current)setReport(r.data as Report);
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Không tải được báo cáo.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 const stale=!!report&&(report.from!==from||report.to!==to);
 return <section className="revenue-panel" aria-label="Báo cáo doanh thu">
 <button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Báo cáo doanh thu</button>
 {open&&<><h2>Báo cáo doanh thu</h2><p>Theo ngày thanh toán, giờ Việt Nam. Tiền thực thu sau giảm giá; chưa tính chi phí hoặc lợi nhuận.</p>
 <form className="report-form" onSubmit={e=>{e.preventDefault();void load();}}>
 <label>Từ ngày<input type="date" required value={from} disabled={busy} onChange={e=>setFrom(e.target.value)}/></label>
 <label>Đến ngày<input type="date" required value={to} disabled={busy} onChange={e=>setTo(e.target.value)}/></label>
 <button type="button" disabled={busy} onClick={()=>{setFrom(today());setTo(today());}}>Hôm nay</button>
 <button type="button" disabled={busy} onClick={()=>{const d=today();setFrom(d.slice(0,8)+'01');setTo(d);}}>Tháng này</button>
 <button className="primary" type="submit" disabled={busy||!valid}>{busy?'Đang tải báo cáo…':'Xem báo cáo'}</button>
 </form>{!valid&&<p role="alert">Chọn ngày bắt đầu không sau ngày kết thúc, tối đa 366 ngày.</p>}
 {error&&<p role="alert">{error}</p>}{stale&&<p role="status">Khoảng ngày đã đổi. Bấm Xem báo cáo để cập nhật.</p>}
 {report&&!stale&&<div className="report-result"><p>Khoảng {report.from} — {report.to} · Cập nhật {new Date(report.generated_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p>
 <dl className="report-totals">{[['Doanh thu thực thu',money(report.total)],['Số hóa đơn',report.invoices],['Tiền trước giảm giá',money(report.gross)],['Giảm giá',money(report.discount)],['Tiền mặt',money(report.cash)],['Chuyển khoản',money(report.transfer)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
 {!report.invoices?<p>Chưa có hóa đơn đã thanh toán trong khoảng ngày này.</p>:<><h3>Doanh thu từng ngày</h3><div className="report-table"><table><thead><tr><th>Ngày</th><th>Hóa đơn</th><th>Thực thu</th><th>Tiền mặt</th><th>Chuyển khoản</th></tr></thead><tbody>{report.days.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.invoices}</td><td>{money(d.total)}</td><td>{money(d.cash)}</td><td>{money(d.transfer)}</td></tr>)}</tbody></table></div>
 <h3>20 món bán nhiều nhất</h3><p>Gộp theo tên món trên hóa đơn; tiền món trước giảm giá hóa đơn.</p><div className="report-table"><table><thead><tr><th>Món</th><th>Số lượng</th><th>Tiền món</th></tr></thead><tbody>{report.products.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.qty}</td><td>{money(p.gross)}</td></tr>)}</tbody></table></div></>}
 </div>}</>}
 </section>;
}
