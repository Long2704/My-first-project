import {useState} from 'react';
import {CancelItem} from '../OperationsPanel';
import POSIcon from './POSIcon';
import QuantityControl from './QuantityControl';
import {formatMoney} from './types';
import type {DraftLine,Product} from './types';
import type {SavedGroup} from './saved-order-groups';
export default function SavedOrderItem({group,product,draft,disabled,awaiting,canCancel,onChange,onNote,onBusy,onSavedChanged}:{
 group:SavedGroup;product?:Product;draft?:DraftLine;disabled:boolean;awaiting:boolean;canCancel:boolean;
 onChange:(delta:number)=>void;onNote:(note:string)=>void;onBusy:(value:boolean)=>void;onSavedChanged:()=>Promise<void>;
}){
 const [expanded,setExpanded]=useState(false),extra=draft?.qty??0;
 const notes=new Map<string,number>();for(const {line} of group.rows)if(line.note)notes.set(line.note,(notes.get(line.note)??0)+line.qty);
 const status=group.rows.some(row=>row.status==='cooking')?'Đang làm':'Đã ra món';
 const name=group.name;
 return <article className={`pos-saved-line${extra?' has-extra':''}`} data-product-id={group.productId??undefined}>
  <span className="pos-order-art"><POSIcon name={group.category==='do_uong'?'cup':'plate'}/></span>
  <div className="pos-order-item-body">
   <div className="pos-order-item-heading pos-saved-heading"><h3>{name}</h3><small>{status}</small>{group.rows.length>1&&<button type="button" className="pos-line-more" aria-label={`Chi tiết lượt gọi ${name}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}><POSIcon name="more"/></button>}</div>
   <div className="pos-order-item-bottom"><strong>{formatMoney(group.amount+(draft?draft.product.price*extra:0))}</strong>{product?<QuantityControl name={name} qty={group.qty+extra} disabled={disabled} decreaseDisabled={extra===0} increaseDisabled={product.is_out||extra>=99} maxQty={group.qty+99} onIncrease={()=>onChange(1)} onDecrease={()=>{if(extra>0)onChange(-1);}}/>:<span className="pos-saved-qty">{group.qty} món</span>}</div>
   {extra>0&&<p className="pos-extra-note">Đã gửi {group.qty} · <strong>Thêm {extra} {awaiting?'chờ xác nhận':'chưa gửi'}</strong></p>}
   {[...notes].map(([note,qty])=><p className="pos-saved-note" key={note}>{qty===group.qty?note:`${qty} × ${note}`}</p>)}
   {extra>0&&<label className="pos-line-note">Ghi chú món thêm<input maxLength={500} disabled={disabled} value={draft?.note??''} placeholder="Ghi chú cho phần gọi thêm…" onChange={event=>onNote(event.target.value)}/></label>}
   {group.rows.length===1&&canCancel&&<div className="pos-saved-actions"><CancelItem compact item={group.rows[0].line} disabled={disabled} onBusy={onBusy} onChanged={onSavedChanged}/></div>}
   {expanded&&<div className="pos-saved-sources">{group.rows.map(({line,status})=><div className="pos-saved-source" key={line.id}><div><strong>{line.qty} × {line.name}</strong><span>{formatMoney(line.price*line.qty)}</span></div><small>Bill {line.bill_no??1} · {status==='done'?'Đã ra món':'Đang làm'}</small>{line.note&&<p>{line.note}</p>}{canCancel&&<CancelItem compact item={line} disabled={disabled} onBusy={onBusy} onChanged={onSavedChanged}/>}</div>)}</div>}
  </div>
 </article>;
}
