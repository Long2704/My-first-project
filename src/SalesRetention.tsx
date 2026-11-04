import {useEffect,useState} from 'react';
import {supabase} from './supabase';
type State={retention_days:number;enabled:boolean;scheduled:boolean;next_run:string;last_run:null|{finished_at:string;sessions:number;orders:number;invoices:number};eligible:{sessions:number;orders:number;invoices:number}};
const stamp=(s:string)=>new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
export default function SalesRetention(){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){if(!supabase)return;const r=await supabase.rpc('get_sales_retention_status');if(r.error){setError('Chưa đọc được lịch dọn dữ liệu. Kiểm tra SQL 038.');return;}if(r.data?.retention_days!==7){setState(null);setError('Cần cập nhật SQL 039 để giữ đúng 7 ngày.');return;}setState(r.data);setError('');}
 useEffect(()=>{void load();},[]);
 async function toggle(){if(!supabase||!state||busy)return;setBusy(true);try{const r=await supabase.rpc('set_sales_retention_enabled',{p_enabled:!state.enabled});if(r.error)throw Error();await load();}catch{setError('Chưa xác nhận đổi lịch dọn. Tải lại để kiểm tra.');}finally{setBusy(false);}}
 return <div className="sales-retention"><h3>Dọn lịch sử hằng tuần</h3><p>Giữ 7 ngày gần nhất. Chỉ dọn phiên bàn đã đóng và đơn đã xử lý xong; dữ liệu đã dọn không còn trong báo cáo.</p>{error&&<p role="alert">{error}</p>}{state&&<><p>{!state.scheduled?'Chưa cài lịch tự động trên Supabase.':state.enabled?`Đang bật · Thứ Hai, 03:00 giờ Việt Nam · Lần tới: ${stamp(state.next_run)}`:'Đã tạm dừng dọn tự động.'}</p><p>Hiện đủ điều kiện: {state.eligible.sessions} phiên · {state.eligible.orders} đơn · {state.eligible.invoices} hóa đơn.</p>{state.last_run&&<p>Lần gần nhất: {stamp(state.last_run.finished_at)} · Đã dọn {state.last_run.orders} đơn, {state.last_run.invoices} hóa đơn.</p>}<button disabled={busy||!state.scheduled} onClick={()=>void toggle()}>{busy?'Đang cập nhật…':state.enabled?'Tạm dừng dọn tự động':'Bật dọn tự động (giữ 7 ngày)'}</button><button disabled={busy} onClick={()=>void load()}>Kiểm tra lịch dọn</button></>}</div>;
}
