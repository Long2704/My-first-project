import type {Order} from '../order-model';
import type {DraftLine,Product} from './types';
import {formatMoney} from './types';
import POSIcon from './POSIcon';
import OrderItem from './OrderItem';
import SavedOrderItem from './SavedOrderItem';
import {groupSavedOrders} from './saved-order-groups';
export default function OrderDetail({lines,orders,products,disabled,awaiting,canCancel,onChange,onQuickChange,onNote,onRemove,onBusy,onSavedChanged}:{
 lines:DraftLine[];orders:Order[];products:Product[];disabled:boolean;awaiting:boolean;canCancel:boolean;
 onChange:(id:string,delta:number)=>void;onQuickChange:(id:string,delta:number)=>void;onNote:(id:string,note:string)=>void;
 onRemove:(id:string)=>void;onBusy:(value:boolean)=>void;onSavedChanged:()=>Promise<void>;
}){
 const {groups,history}=groupSavedOrders(orders),byProduct=new Map(products.map(product=>[product.id,product])),drafts=new Map(lines.map(line=>[line.product.id,line]));
 const merged=new Set(groups.map(group=>group.productId).filter((id):id is string=>!!id));
 const remaining=lines.filter(line=>!merged.has(line.product.id));
 return <div className="pos-order-lines">
  {groups.length>0&&<><h2 className="pos-lines-label">Món đã gọi</h2>{groups.map(group=><SavedOrderItem key={`saved:${group.key}`} group={group} product={group.productId?byProduct.get(group.productId):undefined} draft={group.productId?drafts.get(group.productId):undefined} disabled={disabled} awaiting={awaiting} canCancel={canCancel} onChange={delta=>{if(group.productId)onQuickChange(group.productId,delta);}} onNote={note=>{if(group.productId)onNote(group.productId,note);}} onBusy={onBusy} onSavedChanged={onSavedChanged}/>)}</>}
  {remaining.length>0&&<><h2 className="pos-lines-label">Chưa gửi · {remaining.reduce((sum,line)=>sum+line.qty,0)} món</h2>{remaining.map(line=><OrderItem key={`draft:${line.product.id}`} line={line} disabled={disabled} onChange={delta=>onChange(line.product.id,delta)} onNote={note=>onNote(line.product.id,note)} onRemove={()=>onRemove(line.product.id)}/>)}</>}
  {history.map(({line})=><article key={`history:${line.id}`} className={`pos-saved-line${line.cancelled_at?' is-cancelled':''}`}><span className="pos-order-art"><POSIcon name={line.category==='do_uong'?'cup':'plate'}/></span><div className="pos-order-item-body"><div className="pos-order-item-heading"><h3>{line.name}</h3><small>{line.cancelled_at?'Đã hủy':'Đã thanh toán'}</small></div><div className="pos-order-item-bottom"><strong>{formatMoney(line.price*line.qty)}</strong><span className="pos-saved-qty">{line.qty} × {formatMoney(line.price)}</span></div>{line.note&&<p className="pos-saved-note">{line.note}</p>}</div></article>)}
  {!orders.length&&!lines.length&&<div className="pos-empty"><h2>Chưa có món</h2><p>Bấm dấu + để chọn món.</p></div>}
 </div>;
}
