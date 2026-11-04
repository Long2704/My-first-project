import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import {downloadCsv,revenueExport} from './revenue-export';
import type {RevenueReport as Report} from './revenue-export';
import PosIcon from './PosIcon';
import ReportClock from './ReportClock';
import SalesRetention from './SalesRetention';
import {formatMoney as money} from './format';
import {reportTimestamp,validReportPeriod,reportPeriodLabel} from './revenue-period';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function RevenuePanel({active}:{active?:boolean}){
 const [open,setOpen]=useState(false),[from,setFrom]=useState(today),[to,setTo]=useState(today);
 const [fromTime,setFromTime]=useState('00:00:00'),[toTime,setToTime]=useState('23:59:59');
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(active)setOpen(true);},[active]);
 const fromLocal=reportTimestamp(from,fromTime),toLocal=reportTimestamp(to,toTime);
 const valid=validReportPeriod(fromLocal,toLocal);
 async function load(){
  if(!supabase||lock.current||!valid)return;
  lock.current=true;setBusy(true);setReport(null);setError('');
  try{
   const r=await supabase.rpc('revenue_report_window',{p_from_local:fromLocal,p_to_local:toLocal});
   if(r.error)throw new Error(['PGRST202','42883'].includes(r.error.code)?'Cần cập nhật SQL 037 để xuất doanh thu theo khung giờ.':'Không tải được báo cáo. Kiểm tra kết nối và quyền tài khoản rồi thử lại.');
   if(r.data?.slots_complete!==true||!Array.isArray(r.data.slots)||r.data?.products_complete!==true||r.data?.time_filter!==true||r.data.from!==fromLocal||r.data.to!==toLocal)throw new Error('Chưa xác nhận được khoảng thời gian báo cáo. Kiểm tra SQL 037 rồi thử lại.');
   if(alive.current)setReport(r.data as Report);
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Không tải được báo cáo.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function exportExcel(){
  if(!report||busy||stale)return;
  try{const {downloadRevenueWorkbook}=await import('./revenue-workbook');await downloadRevenueWorkbook(report);setError('');}
  catch{setError('Không xuất được Excel. Kiểm tra dữ liệu báo cáo rồi thử lại.');}
 }
 function exportReport(){
  if(!report||busy||report.from!==fromLocal||report.to!==toLocal)return;
  try{downloadCsv(revenueExport(report));setError('');}
  catch{setError('Không tải được tệp CSV. Kiểm tra quyền tải tệp của trình duyệt rồi thử lại.');}
 }
 const stale=!!report&&(report.from!==fromLocal||report.to!==toLocal);
 return <section className="revenue-panel" aria-label="Báo cáo doanh thu">
 {active===undefined&&<button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Báo cáo doanh thu</button>}
 {open&&<>{active===undefined&&<h2>Báo cáo doanh thu</h2>}
 <form className="report-form" onSubmit={e=>{e.preventDefault();void load();}}>
 <div className="report-range-fields"><label>Từ ngày<input type="date" required value={from} disabled={busy} onChange={e=>setFrom(e.target.value)}/></label><ReportClock label="Từ giờ" value={fromTime} disabled={busy} onChange={setFromTime}/></div>
 <div className="report-range-fields"><label>Đến ngày<input type="date" required value={to} disabled={busy} onChange={e=>setTo(e.target.value)}/></label><ReportClock label="Đến giờ" value={toTime} disabled={busy} onChange={setToTime}/></div>
 <div className="report-date-presets"><button type="button" disabled={busy} onClick={()=>{setFrom(today());setTo(today());setFromTime('00:00:00');setToTime('23:59:59');}}>Hôm nay</button>
 <button type="button" disabled={busy} onClick={()=>{const d=today();setFrom(d.slice(0,8)+'01');setTo(d);setFromTime('00:00:00');setToTime('23:59:59');}}>Tháng này</button></div>
 <button className="primary" type="submit" disabled={busy||!valid}>{busy?'Đang tải báo cáo…':'Xem báo cáo'}</button>
 </form><p className="report-timezone">Giờ Việt Nam · Tính theo thời điểm thanh toán, bao gồm giây kết thúc đã chọn.</p>{!valid&&<p role="alert">Chọn ngày và giờ hợp lệ: mốc bắt đầu không sau mốc kết thúc, tối đa 366 ngày.</p>}
 {error&&<p role="alert">{error}</p>}{stale&&<p role="status">Khoảng thời gian đã đổi. Bấm Xem báo cáo để cập nhật.</p>}
 {report&&!stale&&<div className="report-result"><p className="report-period">{reportPeriodLabel(report.from)} — {reportPeriodLabel(report.to)} · Giờ Việt Nam</p>
 <div className="report-export-actions"><button disabled={busy} onClick={exportReport}><PosIcon name="download"/>Xuất doanh thu CSV</button><button disabled={busy} onClick={()=>void exportExcel()}><PosIcon name="download"/>Xuất Excel theo khung giờ</button></div>
 <dl className="report-totals">{[['Doanh thu thực thu',money(report.total)],['Số hóa đơn',report.invoices],['Tiền trước giảm giá',money(report.gross)],['Giảm giá',money(report.discount)],['Tiền mặt',money(report.cash)],['Chuyển khoản',money(report.transfer)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
 {!report.invoices?<p>Chưa có hóa đơn đã thanh toán trong khoảng thời gian này.</p>:<><h3>Doanh thu từng ngày</h3><div className="report-table"><table><thead><tr><th>Ngày</th><th>Hóa đơn</th><th>Thực thu</th><th>Tiền mặt</th><th>Chuyển khoản</th></tr></thead><tbody>{report.days.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.invoices}</td><td>{money(d.total)}</td><td>{money(d.cash)}</td><td>{money(d.transfer)}</td></tr>)}</tbody></table></div>
 <div className="report-products-heading"><h3>Món ăn</h3><small>Trước giảm giá hóa đơn</small></div><div className="report-table report-products"><table><thead><tr><th>Món ăn</th><th>Số lượng</th><th>Tổng tiền</th></tr></thead><tbody>{report.products.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.qty}</td><td>{money(p.gross)}</td></tr>)}</tbody></table></div></>}
 </div>}<SalesRetention/></>}
 </section>;
}
