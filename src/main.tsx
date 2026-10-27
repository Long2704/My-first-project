import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import {supabase} from './supabase';
import {fifo, kitchenLines, savedTotal, tableStatus} from './order-model';
import type {Order, TableSession} from './order-model';
import './style.css';
const groups=[{id:'bun',name:'Món chính'},{id:'an_them',name:'Món thêm'},{id:'do_uong',name:'Nước giải khát'}];
const roles:Record<string,string>={chu:'Chủ quán',thu_ngan:'Thu ngân',phuc_vu:'Phục vụ',bep:'Bếp'};
const money=(n:number)=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
type Item={id:string;name:string;price:number;category:string;is_out:boolean};
type DiningTable={id:number;name:string};
type Profile={name:string;role:string};
type Pending={requestId:string;tableId:number;items:{menu_item_id:string;qty:number;note:string}[]};
type KitchenOrder=Order&{table_sessions:{table_id:number;closed_at:string|null}};
const orderFields='id,request_id,session_id,status,kitchen_relevant,created_at,order_items(id,name,price,qty,category,note,paid)';
const storageKey=(user:string)=>`goc-pho-pending-v1:${user}`;
function App(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true);
 const [profile,setProfile]=useState<Profile|null>(null),[menu,setMenu]=useState<Item[]>([]),[tables,setTables]=useState<DiningTable[]>([]);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0);
 const [view,setView]=useState<'service'|'kitchen'>('service'),[history,setHistory]=useState(false);
 const [selected,setSelected]=useState<DiningTable|null>(null),[group,setGroup]=useState('bun');
 const [drafts,setDrafts]=useState<Record<number,Record<string,number>>>({}),[notes,setNotes]=useState<Record<number,Record<string,string>>>({});
 const [pending,setPending]=useState<Pending|null>(null),[sending,setSending]=useState(false);
 const [sessions,setSessions]=useState<TableSession[]>([]),[cooking,setCooking]=useState<KitchenOrder[]>([]);
 const [syncError,setSyncError]=useState(''),[lastSync,setLastSync]=useState(''),[completing,setCompleting]=useState<string|null>(null);
 const sendLock=useRef(false),refreshLock=useRef(false),identity=useRef<string|null>(null);
 identity.current=session?.user.id??null;
 useEffect(()=>{
  if(!supabase){setError('Chưa cấu hình kết nối Supabase.');setLoading(false);return;}
  let active=true,changed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{changed=true;if(active){setSession(s);setLoading(false);}});
  supabase.auth.getSession().then(({data,error})=>{if(active&&!changed){setSession(data.session);if(error)setError('Không thể khôi phục phiên đăng nhập.');setLoading(false);}}).catch(()=>{if(active){setError('Không thể kết nối. Vui lòng tải lại trang.');setLoading(false);}});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  setProfile(null);setMenu([]);setTables([]);setDrafts({});setNotes({});setSelected(null);setSessions([]);setCooking([]);setPending(null);setError('');setMessage('');setLastSync('');setSyncError('');
  if(!session||!supabase)return;
  const user=session.user.id;let active=true;setLoading(true);
  try{
   const raw=localStorage.getItem(storageKey(user));
   if(raw){const p:Pending=JSON.parse(raw);if(!p.requestId||!Number.isInteger(p.tableId)||!Array.isArray(p.items)||!p.items.length)throw new Error();setPending(p);setDrafts({[p.tableId]:Object.fromEntries(p.items.map(i=>[i.menu_item_id,i.qty]))});setNotes({[p.tableId]:Object.fromEntries(p.items.map(i=>[i.menu_item_id,i.note]))});}
  }catch{setError('Không đọc được đơn chờ gửi trên thiết bị. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ trước khi gửi lại đơn.');}
  async function load(){
   try{
    const p=await supabase!.from('profiles').select('name,role').eq('id',user).maybeSingle();
    if(p.error)throw new Error('Không đọc được hồ sơ nhân viên.');
    if(!p.data||!roles[p.data.role])throw new Error('Tài khoản chưa được cấp vai trò hợp lệ.');
    const [m,t]=await Promise.all([supabase!.from('menu_items').select('id,name,price,category,is_out').eq('is_active',true).order('sort').order('id'),supabase!.from('restaurant_tables').select('id,name').eq('is_active',true).order('id')]);
    if(m.error||t.error)throw new Error('Không tải được thực đơn hoặc danh sách bàn.');
    if(active){setProfile(p.data);setMenu(m.data??[]);setTables(t.data??[]);setView(p.data.role==='bep'?'kitchen':'service');}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Không thể tải dữ liệu.');}finally{if(active)setLoading(false);}
  }
  void load();return()=>{active=false;};
 },[session?.user.id,reload]);
 const refresh=useCallback(async()=>{
  if(!supabase||!profile||!session||refreshLock.current)return;
  const user=session.user.id;refreshLock.current=true;
  try{
   const [s,k]=await Promise.all([
    supabase.from('table_sessions').select(`id,table_id,orders(${orderFields})`).is('closed_at',null),
    supabase.from('orders').select(`${orderFields},table_sessions!inner(table_id,closed_at)`).eq('status','cooking').eq('kitchen_relevant',true).order('created_at').order('id')
   ]);
   if(s.error||k.error)throw new Error();
   if(identity.current===user){setSessions(s.data as unknown as TableSession[]);setCooking(k.data as unknown as KitchenOrder[]);setLastSync(new Date().toLocaleTimeString('vi-VN'));setSyncError('');}
  }catch{if(identity.current===user)setSyncError('Chưa đồng bộ được đơn hàng. Dữ liệu có thể đã cũ; kiểm tra mạng rồi bấm Đồng bộ.');}
  finally{refreshLock.current=false;}
 },[profile,session?.user.id]);
 useEffect(()=>{
  void refresh();const timer=setInterval(()=>void refresh(),5000);
  const online=()=>void refresh();window.addEventListener('online',online);
  return()=>{clearInterval(timer);window.removeEventListener('online',online);};
 },[refresh]);
 async function login(e:React.FormEvent){
  e.preventDefault();if(!supabase)return;setBusy(true);setError('');
  try{const r=await supabase.auth.signInWithPassword({email:email.trim(),password});if(r.error)setError('Đăng nhập thất bại. Kiểm tra email, mật khẩu và kết nối.');else setPassword('');}catch{setError('Không kết nối được Supabase.');}finally{setBusy(false);}
 }
 async function logout(){if(!supabase||sending)return;setBusy(true);try{const r=await supabase.auth.signOut({scope:'local'});if(r.error)setError('Chưa đăng xuất được.');}catch{setError('Chưa đăng xuất được.');}finally{setBusy(false);}}
 const qty=selected?drafts[selected.id]??{}:{};
 const total=menu.reduce((s,m)=>s+m.price*(qty[m.id]||0),0);
 const count=Object.values(qty).reduce((a,b)=>a+b,0);
 const locked=!!pending||sending;
 function changeQty(id:string,delta:number){if(!selected||locked)return;const table=selected.id;setDrafts(d=>({...d,[table]:{...d[table],[id]:Math.min(99,Math.max(0,(d[table]?.[id]||0)+delta))}}));}
 async function sendOrder(){
  if(!session||!supabase||sendLock.current||!profile||profile.role==='bep')return;
  const user=session.user.id;
  let payload=pending;
  if(!payload){
   if(!selected||!count)return;
   payload={requestId:crypto.randomUUID(),tableId:selected.id,items:Object.entries(qty).filter(([,n])=>n>0).map(([id,n])=>({menu_item_id:id,qty:n,note:notes[selected.id]?.[id]??''}))};
   try{localStorage.setItem(storageKey(user),JSON.stringify(payload));}catch{setError('Không lưu được mã đơn trên thiết bị. Hãy cho phép lưu trữ trình duyệt trước khi gửi.');return;}
   setPending(payload);
  }
  sendLock.current=true;setSending(true);setError('');setMessage('');
  try{
   const r=await supabase.rpc('submit_order',{p_table_id:payload.tableId,p_request_id:payload.requestId,p_items:payload.items});
   if(r.error)throw new Error(r.error.message);
   if(identity.current!==user)return;
   try{localStorage.removeItem(storageKey(user));}catch{/* Retained request ID is safe to retry after reload. */}
   setPending(null);setDrafts(d=>({...d,[payload!.tableId]:{}}));setNotes(n=>({...n,[payload!.tableId]:{}}));
   setMessage(`Đã lưu đơn Bàn ${payload.tableId}. Món ăn được gửi tới bếp; món nước không vào bếp.`);
   await refresh();
  }catch(e){if(identity.current===user)setError(`Chưa xác nhận gửi đơn: ${e instanceof Error?e.message:'Lỗi kết nối'}. Giữ nguyên đơn và bấm Thử gửi lại; không tạo đơn mới.`);}
  finally{sendLock.current=false;setSending(false);}
 }
 async function complete(id:string){
  if(!supabase||completing)return;setCompleting(id);setError('');
  try{const r=await supabase.rpc('complete_kitchen_order',{p_order_id:id});if(r.error)throw new Error(r.error.message);await refresh();}
  catch(e){setError(`Chưa hoàn thành đơn: ${e instanceof Error?e.message:'Lỗi kết nối'}. Có thể thử lại an toàn.`);}finally{setCompleting(null);}
 }
 const historyOrders=fifo(sessions.flatMap(s=>s.orders.filter(o=>o.status==='done'&&o.kitchen_relevant).map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:null}}))));
 const kitchen=history?historyOrders:fifo(cooking);
 const canComplete=profile&&['bep','chu','thu_ngan'].includes(profile.role);
 const currentOrders=selected?fifo(sessions.filter(s=>s.table_id===selected.id).flatMap(s=>s.orders)):[];
 return <><header><small>ỨNG DỤNG NỘI BỘ CỦA QUÁN</small><h1>Bún Riêu Góc Phố</h1><p>Nóng hổi từng tô, đậm đà vị cua.</p>{session&&<div className="account"><span>{profile?`${profile.name} · ${roles[profile.role]}`:'Tài khoản nhân viên'}</span><button disabled={busy||sending} onClick={logout}>Đăng xuất</button></div>}</header><main>
 {error&&<aside role="alert">{error}{!profile&&session&&<p><button onClick={()=>setReload(n=>n+1)}>Thử tải lại</button></p>}</aside>}
 {message&&<aside role="status">{message}</aside>}
 {loading?<p role="status">Đang tải…</p>:!session?<form onSubmit={login}><h2>Đăng nhập nhân viên</h2><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy||!supabase} type="submit">{busy?'Đang đăng nhập…':'Đăng nhập'}</button></form>:profile&&<>
 <nav aria-label="Chức năng">{profile.role!=='bep'&&<button aria-pressed={view==='service'} onClick={()=>setView('service')}>Phục vụ</button>}<button aria-pressed={view==='kitchen'} onClick={()=>setView('kitchen')}>Bếp ({cooking.length})</button><button onClick={()=>void refresh()}>Đồng bộ</button></nav>
 <p className="sync-status" role="status">{syncError|| (lastSync?`Đã đồng bộ ${lastSync} · cập nhật mỗi 5 giây`:'Đang tải đơn hàng…')}</p>
 <aside><strong>Bản thử nghiệm gọi món</strong><p>Đơn đã gửi được lưu tại quán. Chưa có hủy món hoặc thanh toán; hãy dùng đơn thử trước khi vận hành.</p></aside>
 {pending&&<aside role="status"><strong>Đơn chờ xác nhận — Bàn {pending.tableId}</strong><ul>{pending.items.map((i,n)=><li key={n}>{i.qty} × {menu.find(m=>m.id===i.menu_item_id)?.name??i.menu_item_id}{i.note&&` · ${i.note}`}</li>)}</ul><p>Giữ nguyên mã gửi để tránh trùng đơn. Chưa hỗ trợ tự gửi khi có mạng.</p><button disabled={sending} onClick={sendOrder}>{sending?'Đang gửi…':'Thử gửi lại đơn này'}</button></aside>}
 {view==='kitchen'?<><nav aria-label="Đơn bếp"><button aria-pressed={!history} onClick={()=>setHistory(false)}>Đang làm ({cooking.length})</button><button aria-pressed={history} onClick={()=>setHistory(true)}>Lịch sử</button></nav><section>{kitchen.map((o,index)=><article className={`kitchen-card ${!history&&index===0?'first-order':''}`} key={o.id}><div className="order-heading"><h2>Bàn {o.table_sessions.table_id}</h2><span>{new Date(o.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} · {Math.max(0,Math.floor((Date.now()-Date.parse(o.created_at))/60000))} phút</span></div><small>Đơn {o.id.slice(0,8)}</small><ul>{kitchenLines(o).map(i=><li key={i.id}><strong>{i.qty} × {i.name}</strong>{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul>{!history&&canComplete&&<button className="primary" disabled={!!completing} onClick={()=>void complete(o.id)}>{completing===o.id?'Đang lưu…':'Xong'}</button>}</article>)}{!kitchen.length&&<p>{history?'Chưa có đơn đã xong của các bàn đang mở.':'Chưa có món đang làm.'}</p>}</section></>:!selected?<><h2 className="section-title">Chọn bàn</h2><div className="table-grid">{tables.map(t=>{
 const d=drafts[t.id]??{};const draftTotal=menu.reduce((sum,i)=>sum+i.price*(d[i.id]||0),0);
 const known=pending?.tableId===t.id&&sessions.some(s=>s.orders.some(o=>o.request_id===pending.requestId));
 const amount=savedTotal(sessions,t.id)+(known?0:draftTotal);
 return <button className="table-card" key={t.id} disabled={!lastSync} onClick={()=>{setSelected(t);setGroup('bun');setMessage('');}}><strong>{t.name}</strong>{amount>0&&<span className="table-total">{money(amount)}</span>}<span>{lastSync?tableStatus(sessions,t.id):'Đang tải…'}</span>{draftTotal>0&&!known&&<small>Có món chưa xác nhận</small>}</button>;
 })}</div>{!tables.length&&<p>Chưa có bàn đang hoạt động.</p>}</>:<>
 <div className="table-heading"><button onClick={()=>setSelected(null)}>← Danh sách bàn</button><h2>{selected.name}</h2></div>
 <h3>Đơn đã lưu · {money(savedTotal(sessions,selected.id))}</h3>
 {currentOrders.length?<section>{currentOrders.map(o=><article className="saved-order" key={o.id}><div><h2>Đợt {new Date(o.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} · {o.status==='cooking'?'Bếp đang làm':'Đã ra món'}</h2><ul>{o.order_items.map(i=><li key={i.id}>{i.qty} × {i.name} — {money(i.price*i.qty)}{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul></div></article>)}</section>:<p>Chưa có đơn đã lưu.</p>}
 <h3>Gọi thêm món</h3><nav aria-label="Nhóm món">{groups.map(g=><button key={g.id} aria-pressed={group===g.id} onClick={()=>setGroup(g.id)}>{g.name}</button>)}</nav>
 <fieldset disabled={locked}><legend className="visually-hidden">Chọn món mới</legend><section>{menu.filter(m=>m.category===group&&!m.is_out).map(m=><article className="menu-card" key={m.id}><div className="menu-row"><div><h2>{m.name}</h2><strong>{money(m.price)}</strong></div><div className="counter"><button aria-label={'Bớt '+m.name} disabled={locked||!qty[m.id]} onClick={()=>changeQty(m.id,-1)}>−</button><output>{qty[m.id]||0}</output><button aria-label={'Thêm '+m.name} disabled={locked||(qty[m.id]||0)>=99} onClick={()=>changeQty(m.id,1)}>+</button></div></div>{!!qty[m.id]&&<label>Ghi chú món<input maxLength={500} placeholder="Ví dụ: ít bún, không hành" value={notes[selected.id]?.[m.id]??''} onChange={e=>{const value=e.target.value;setNotes(n=>({...n,[selected.id]:{...n[selected.id],[m.id]:value}}));}}/></label>}</article>)}</section></fieldset>
 </>}
 </>}
 </main>{profile&&!loading&&selected&&view==='service'&&<footer><div><small>{selected.name} · {count} món chọn thêm</small><strong>{money(total)}</strong></div><div className="footer-actions"><button disabled={locked||!count} onClick={()=>{setDrafts(d=>({...d,[selected.id]:{}}));setNotes(n=>({...n,[selected.id]:{}}));}}>Xóa chọn</button><button className="primary" disabled={sending||!!pending||!count||!lastSync} onClick={sendOrder}>Gửi bếp</button></div></footer>}</>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
