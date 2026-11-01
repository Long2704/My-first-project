import {useRef,useState} from 'react';
import SwipeOrderCard from '../SwipeOrderCard';
import PrivateImage from './PrivateImage';
import KitchenImageZoom from './KitchenImageZoom';
import type {PrivateImages} from './private-images';
import type {ImageTicket} from './types';
export default function KitchenImageTicket({ticket,cache,disabled,onComplete}:{ticket:ImageTicket;cache:PrivateImages;disabled:boolean;onComplete:()=>Promise<void>}){
 const [zoom,setZoom]=useState(false);const start=useRef<{x:number;y:number;moved:boolean}|null>(null);
 const done=ticket.status==='done';
 return <><SwipeOrderCard className="kitchen-card kitchen-image-ticket" disabled={disabled||done} onComplete={onComplete}>
  <div className="order-heading"><h2>Phiếu ảnh</h2><span>{new Date(ticket.created_at).toLocaleString('vi-VN')} · {Math.max(0,Math.floor((Date.now()-Date.parse(ticket.created_at))/60000))} phút</span></div>
  <div className="kitchen-image-tap" role="button" tabIndex={0} aria-label="Phóng to phiếu ảnh"
   onPointerDown={e=>{if((e.target as HTMLElement).closest('button')){start.current=null;return;}start.current={x:e.clientX,y:e.clientY,moved:false};}}
   onPointerMove={e=>{const p=start.current;if(p&&(Math.abs(e.clientX-p.x)>8||Math.abs(e.clientY-p.y)>8))p.moved=true;}}
   onPointerCancel={()=>{start.current=null;}}
   onPointerUp={e=>{const p=start.current;start.current=null;if(p&&!p.moved&&Math.abs(e.clientX-p.x)<8&&Math.abs(e.clientY-p.y)<8)setZoom(true);}}
   onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();setZoom(true);}}}>
   <PrivateImage path={ticket.preview_path} cache={cache} ratio={ticket.width/ticket.height}/>
  </div>
  <button className="image-open" onClick={()=>setZoom(true)}>Xem ảnh lớn</button>
  {done?<p className="image-completed">Đã xong · {new Date(ticket.completed_at!).toLocaleString('vi-VN')}</p>:<button className="primary" disabled={disabled} onClick={()=>void onComplete()}>Xong</button>}
 </SwipeOrderCard>{zoom&&<KitchenImageZoom path={ticket.image_path} cache={cache} onClose={()=>setZoom(false)}/>}</>;
}
