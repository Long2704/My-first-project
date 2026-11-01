import {useCallback,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {supabase} from '../supabase';
import KitchenImageUpload from './KitchenImageUpload';
import KitchenImageTicket from './KitchenImageTicket';
import {createPrivateImages} from './private-images';
import {imageTicketFields} from './types';
import type {ImageTicket} from './types';
import './kitchen-images.css';
type Props={userId:string;canRead:boolean;canUpload:boolean;canComplete:boolean;online:boolean;history:boolean;normalCount:number;children:ReactNode};
export default function KitchenImageArea(props:Props){
 // Remount on user/permission changes to dispose all private data and in-flight UI state.
 return props.canRead?<AuthorizedImages key={`${props.userId}:${props.canUpload}:${props.canComplete}`} {...props}/>:<section className="kitchen-grid" aria-describedby="kitchen-swipe-help">{props.children}{!props.normalCount&&<Empty history={props.history}/>}</section>;
}
function Empty({history}:{history:boolean}){return <div className="empty-state"><h3>{history?'Chưa có đơn đã xong của các bàn đang mở.':'Chưa có món đang làm.'}</h3></div>;}
function AuthorizedImages({userId,canUpload,canComplete,online,history,normalCount,children}:Props){
 const [tickets,setTickets]=useState<ImageTicket[]>([]),[limit,setLimit]=useState(40),[hasMore,setHasMore]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(''),[revision,setRevision]=useState(0);
 const [cache]=useState(createPrivateImages);const alive=useRef(true),completeLock=useRef(false),confirmedDone=useRef(new Set<string>());
 useEffect(()=>{alive.current=true;cache.activate();return()=>{alive.current=false;cache.dispose();};},[cache]);
 const reload=useCallback(()=>setRevision(n=>n+1),[]);
 useEffect(()=>{setLimit(40);setTickets([]);setReady(false);},[history]);
 useEffect(()=>{
  if(!supabase||!online)return;let active=true,inFlight=false;
  async function refresh(){
   if(inFlight||!active||!supabase)return;inFlight=true;
   try{
    const order=history?'completed_at':'created_at';
    const {data,error:failure}=await supabase.from('kitchen_image_tickets').select(imageTicketFields).eq('status',history?'done':'cooking').order(order,{ascending:!history}).order('id',{ascending:!history}).range(0,limit);
    if(!active)return;
    if(failure)throw failure;
    const next=((data??[]).slice(0,limit) as ImageTicket[]).filter(t=>history||!confirmedDone.current.has(t.id));
    setTickets(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);setHasMore((data?.length??0)>limit);setReady(true);setError('');
   }catch{if(active)setError('Chưa đồng bộ được phiếu ảnh. Đơn bếp thường vẫn hoạt động.');}
   finally{inFlight=false;}
  }
  void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);
  return()=>{active=false;clearInterval(timer);};
 },[history,limit,online,revision]);
 async function complete(id:string){
  if(completeLock.current||!online||!navigator.onLine||!supabase||!canComplete)return;
  completeLock.current=true;setBusy(id);setError('');
  try{
   const {data,error:failure}=await supabase.rpc('complete_kitchen_image_ticket',{p_ticket_id:id});
   if(failure||!data||data.id!==id||data.status!=='done')throw new Error();
   if(alive.current){confirmedDone.current.add(id);setTickets(old=>old.filter(t=>t.id!==id));reload();}
  }catch{if(alive.current)setError('Chưa xác nhận hoàn thành. Phiếu được giữ lại; thử lại khi có mạng.');}
  finally{completeLock.current=false;if(alive.current)setBusy('');}
 }
 return <>
  {canUpload&&<KitchenImageUpload userId={userId} online={online} onUploaded={reload}/>}
  {error&&<p className="image-ticket-error" role="alert">{error} <button onClick={reload} disabled={!online}>Thử đồng bộ ảnh</button></p>}
  <section className="kitchen-grid" aria-describedby="kitchen-swipe-help">{children}
   {tickets.map(ticket=><KitchenImageTicket key={ticket.id} ticket={ticket} cache={cache} disabled={!online||!canComplete||!!busy||!!error||history} onComplete={()=>complete(ticket.id)}/>)}
   {!ready&&!error&&<p role="status">Đang tải phiếu ảnh…</p>}
   {!normalCount&&!tickets.length&&ready&&!error&&<Empty history={history}/>}
  </section>
  {hasMore&&<button className="image-load-more" disabled={!online} onClick={()=>setLimit(n=>n+40)}>Xem thêm phiếu ảnh</button>}
 </>;
}
