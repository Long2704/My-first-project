import {placeLabel} from './order-model';
import {useEffect,useRef,useState} from 'react';
import ConfirmDialog from './ConfirmDialog';
import {supabase} from './supabase';
import type {OrderLine} from './order-model';
export function CancelItem({item,disabled,onChanged,compact=false,onBusy}:{compact?:boolean;item:OrderLine;disabled:boolean;onChanged:()=>Promise<void>;onBusy?:(busy:boolean)=>void}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 async function cancel(){
  if(!supabase||lock.current||disabled)return;
  lock.current=true;setBusy(true);onBusy?.(true);setError('');
  try{const r=await supabase.rpc('cancel_order_item',{p_item_id:item.id,p_reason:''});if(r.error)throw new Error(r.error.message);setOpen(false);await onChanged();}
  catch(e){setError(`Chưa xác nhận hủy: ${e instanceof Error?e.message:'Lỗi kết nối'}. Thử lại cùng món; hệ thống chỉ hủy một lần.`);}
  finally{lock.current=false;setBusy(false);onBusy?.(false);}
 }
 if(item.cancelled_at)return <p className="item-note">Đã hủy{item.cancel_reason?` · ${item.cancel_reason}`:''}</p>;
 if(item.paid)return <small> · Đã thanh toán</small>;
 return <><button className="cancel-line-button" aria-label={`Hủy ${item.name}`} disabled={disabled||busy} onClick={()=>{setError('');setOpen(true);}}>{compact?'Hủy':`Hủy ${item.name}`}</button><ConfirmDialog open={open} title={`Xác nhận hủy ${item.name}`} busy={busy} error={error} confirmLabel="Xác nhận hủy món" onConfirm={()=>void cancel()} onClose={()=>setOpen(false)}><p>Hủy {item.qty} × <strong>{item.name}</strong> · {(item.price*item.qty).toLocaleString('vi-VN')}đ?</p><p>Báo bếp nếu món đã được chuẩn bị.</p></ConfirmDialog></>;
}
type Event={id:string;type:string;table_no:number|null;user_id:string;created_at:string;extra:Record<string,unknown>};
const labels:Record<string,string>={table_order:'Sắp xếp bàn',table_update:'Cập nhật bàn',takeaway_created:'Tạo đơn mang về',takeaway_discarded:'Bỏ đơn mang về trống',cancel_table:'Hủy cả bàn / đơn',bill_move:'Tách/gộp bill',menu_update:'Cập nhật thực đơn',table_transfer:'Chuyển bàn',payment:'Thanh toán',cancel_item:'Hủy món',order_created:'Gửi đơn',kitchen_done:'Bếp hoàn thành'};
export function AuditPanel({active}:{active?:boolean}){
 const [rows,setRows]=useState<Event[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('');
 async function load(type=filter){if(!supabase)return;setBusy(true);setError('');setOpen(true);try{
  let q=supabase.from('audit_log').select('id,type,table_no,user_id,created_at,extra').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100);
  if(type)q=q.eq('type',type);
  const r=await q;if(r.error)throw new Error('Không tải được nhật ký. Vui lòng thử lại.');setRows(r.data);
 }catch(e){setRows([]);setError(e instanceof Error?e.message:'Lỗi kết nối.');}finally{setBusy(false);}}
 useEffect(()=>{if(active)void load();},[active]);
 return <section aria-label="Nhật ký hoạt động">{active===undefined&&<button disabled={busy} onClick={()=>void load()}>Nhật ký hoạt động</button>}{open&&<><div className="order-heading"><h2>100 hoạt động gần nhất</h2>{active===undefined&&<button onClick={()=>setOpen(false)}>Ẩn nhật ký</button>}</div><label htmlFor="audit-filter">Loại hoạt động</label><select id="audit-filter" disabled={busy} value={filter} onChange={e=>{setFilter(e.target.value);void load(e.target.value);}}><option value="">Tất cả</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>{busy?<p role="status">Đang tải nhật ký…</p>:error?<p role="alert">{error}</p>:!rows.length?<p>Chưa có hoạt động.</p>:<ul>{rows.map(r=><li key={r.id}><strong>{labels[r.type]??r.type} · {String(r.extra.place_label??(r.table_no?placeLabel(r.table_no):'—'))}</strong><p>{new Date(r.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} · Nhân viên {r.user_id}</p>{r.type==='table_order'&&<p>Đã lưu thứ tự {Number(r.extra.count)} bàn.</p>}{r.type==='table_update'&&<p>{r.extra.action==='create'?'Thêm bàn':'Sửa bàn'} · {String(r.extra.name)} · {r.extra.active?'Đang sử dụng':'Ngừng sử dụng'}</p>}{r.type==='cancel_item'&&<p>{String(r.extra.qty)} × {String(r.extra.name)}{r.extra.reason?` · Lý do: ${String(r.extra.reason)}`:''}</p>}{r.type==='cancel_table'&&<p>Đã hủy {Number(r.extra.count)} dòng món chưa thanh toán.</p>}{r.type==='bill_move'&&<p>Bill {String(r.extra.from_bill)} → Bill {String(r.extra.to_bill)}{r.extra.reason?` · Lý do: ${String(r.extra.reason)}`:''}</p>}{r.type==='menu_update'&&<p>{String((r.extra.after as Record<string,unknown>)?.name??'Món')} · {r.extra.action==='create'?'Thêm món':'Sửa món'} · Giá mới {Number((r.extra.after as Record<string,unknown>)?.price??0).toLocaleString('vi-VN')}đ</p>}{r.type==='table_transfer'&&<p>Bàn {String(r.extra.from_table)} → Bàn {String(r.extra.to_table)}{r.extra.reason?` · Lý do: ${String(r.extra.reason)}`:''}</p>}{r.type==='payment'&&<p>Thu {Number(r.extra.total).toLocaleString('vi-VN')}đ · {r.extra.method==='cash'?'Tiền mặt':'Chuyển khoản'} · Giảm {Number(r.extra.discount).toLocaleString('vi-VN')}đ</p>}</li>)}</ul>}</>}</section>;
}
