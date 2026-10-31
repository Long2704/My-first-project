import {useRef,useState} from 'react';
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
