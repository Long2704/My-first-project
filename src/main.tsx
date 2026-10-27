import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import {supabase} from './supabase';
import {fifo, kitchenLines, savedTotal, tableStatus} from './order-model';
import type {Order, TableSession} from './order-model';
import './style.css';
import PaymentPanel from './PaymentPanel';
import RevenuePanel from './RevenuePanel';
import TransferPanel from './TransferPanel';
import MenuPanel from './MenuPanel';
import BillPanel from './BillPanel';
import KitchenTools from './KitchenTools';
import InvoiceHistory from './InvoiceHistory';
import PosIcon from './PosIcon';
import {CancelItem,AuditPanel} from './OperationsPanel';
const groups=[{id:'bun',name:'Món chính'},{id:'an_them',name:'Món thêm'},{id:'do_uong',name:'Nước giải khát'}];
const roles:Record<string,string>={chu:'Chủ quán',thu_ngan:'Thu ngân',phuc_vu:'Phục vụ',bep:'Bếp'};
const money=(n:number)=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
type View='service'|'kitchen'|'menu'|'revenue'|'audit'|'invoices';
type Item={id:string;name:string;price:number;category:string;is_out:boolean};
type DiningTable={id:number;name:string};
type Profile={name:string;role:string};
type Pending={requestId:string;tableId:number;items:{menu_item_id:string;qty:number;note:string;expected_price?:number}[]};
type KitchenOrder=Order&{table_sessions:{table_id:number;closed_at:string|null}};
const orderFields='id,request_id,session_id,status,kitchen_relevant,created_at,order_items(id,name,price,qty,category,note,paid,bill_no,cancelled_at,cancel_reason)';
const storageKey=(user:string)=>`goc-pho-pending-v1:${user}`;
function App(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true);
 const [profile,setProfile]=useState<Profile|null>(null),[menu,setMenu]=useState<Item[]>([]),[tables,setTables]=useState<DiningTable[]>([]);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0);
 const [freshKitchenIds,setFreshKitchenIds]=useState<string[]>([]);
 const [view,setView]=useState<View>('service'),[history,setHistory]=useState(false);
 const [tableSearch,setTableSearch]=useState(''),[tableFilter,setTableFilter]=useState<'all'|'empty'|'busy'>('all'),[menuSearch,setMenuSearch]=useState(''),[tableActionsOpen,setTableActionsOpen]=useState(false);
 const [receiptRequest,setReceiptRequest]=useState<{id:string;key:number}|null>(null);
 const managementNav=useRef<HTMLDetailsElement>(null);
 function navigate(next:View){setView(next);managementNav.current?.removeAttribute('open');}
 const [selected,setSelected]=useState<DiningTable|null>(null),[group,setGroup]=useState('bun');
 const [drafts,setDrafts]=useState<Record<number,Record<string,number>>>({}),[notes,setNotes]=useState<Record<number,Record<string,string>>>({});
 const [paymentPending,setPaymentPending]=useState(false),[transferPending,setTransferPending]=useState(false),[menuPending,setMenuPending]=useState(false),[billPending,setBillPending]=useState(false);
 const [pending,setPending]=useState<Pending|null>(null),[sending,setSending]=useState(false);
 const [sessions,setSessions]=useState<TableSession[]>([]),[cooking,setCooking]=useState<KitchenOrder[]>([]);
 const [syncError,setSyncError]=useState(''),[lastSync,setLastSync]=useState(''),[completing,setCompleting]=useState<string|null>(null);
 const sendLock=useRef(false),refreshLock=useRef(false),identity=useRef<string|null>(null);
 const menuRef=useRef(menu),draftRef=useRef(drafts);menuRef.current=menu;draftRef.current=drafts;
 identity.current=session?.user.id??null;
 useEffect(()=>{
  if(!supabase){setError('Chưa cấu hình kết nối Supabase.');setLoading(false);return;}
  let active=true,changed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{changed=true;if(active){setSession(s);setLoading(false);}});
  supabase.auth.getSession().then(({data,error})=>{if(active&&!changed){setSession(data.session);if(error)setError('Không thể khôi phục phiên đăng nhập.');setLoading(false);}}).catch(()=>{if(active){setError('Không thể kết nối. Vui lòng tải lại trang.');setLoading(false);}});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  setTableSearch('');setTableFilter('all');setMenuSearch('');setTableActionsOpen(false);setReceiptRequest(null);setProfile(null);setMenu([]);setTables([]);setDrafts({});setNotes({});setSelected(null);setSessions([]);setCooking([]);setPending(null);setError('');setMessage('');setLastSync('');setSyncError('');
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
   const [s,k,m]=await Promise.all([
    supabase.from('table_sessions').select(`id,table_id,orders(${orderFields})`).is('closed_at',null),
    supabase.from('orders').select(`${orderFields},table_sessions!inner(table_id,closed_at)`).eq('status','cooking').eq('kitchen_relevant',true).order('created_at').order('id'),
    supabase.from('menu_items').select('id,name,price,category,is_out').eq('is_active',true).order('sort').order('id')
   ]);
   if(s.error||k.error||m.error)throw new Error();
   if(identity.current===user){
    if(JSON.stringify(menuRef.current)!==JSON.stringify(m.data)&&Object.values(draftRef.current).some(d=>Object.values(d).some(n=>n>0)))setMessage('Thực đơn đã thay đổi. Kiểm tra lại giá và món đang chọn trước khi gửi.');
    setMenu(m.data??[]);setSessions(s.data as unknown as TableSession[]);setCooking(k.data as unknown as KitchenOrder[]);setLastSync(new Date().toLocaleTimeString('vi-VN'));setSyncError('');}
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
 async function logout(){if(!supabase||sending||paymentPending||transferPending||menuPending||billPending)return;setBusy(true);try{const r=await supabase.auth.signOut({scope:'local'});if(r.error)setError('Chưa đăng xuất được.');}catch{setError('Chưa đăng xuất được.');}finally{setBusy(false);}}
 const qty=selected?drafts[selected.id]??{}:{};
 const total=menu.reduce((s,m)=>s+m.price*(qty[m.id]||0),0);
 const count=Object.values(qty).reduce((a,b)=>a+b,0);
 const unavailableDraft=Object.entries(qty).some(([id,n])=>n>0&&!menu.some(m=>m.id===id&&!m.is_out));
 const locked=!!pending||sending||paymentPending||transferPending||menuPending||billPending;
 function changeQty(id:string,delta:number){if(!selected||locked)return;const table=selected.id;setDrafts(d=>({...d,[table]:{...d[table],[id]:Math.min(99,Math.max(0,(d[table]?.[id]||0)+delta))}}));}
 async function sendOrder(){
  if(!session||!supabase||sendLock.current||paymentPending||transferPending||menuPending||billPending||!profile||profile.role==='bep')return;
  const user=session.user.id;
  let payload=pending;
  if(!payload){
   if(!selected||!count||unavailableDraft)return;
   payload={requestId:crypto.randomUUID(),tableId:selected.id,items:Object.entries(qty).filter(([,n])=>n>0).map(([id,n])=>({menu_item_id:id,qty:n,note:notes[selected.id]?.[id]??'',expected_price:menu.find(m=>m.id===id)!.price}))};
   try{localStorage.setItem(storageKey(user),JSON.stringify(payload));}catch{setError('Không lưu được mã đơn trên thiết bị. Hãy cho phép lưu trữ trình duyệt trước khi gửi.');return;}
   setPending(payload);
  }
  sendLock.current=true;setSending(true);setError('');setMessage('');let rejectedByMenu=false;
  try{
   const r=await supabase.rpc('submit_order',{p_table_id:payload.tableId,p_request_id:payload.requestId,p_items:payload.items});
   if(r.error){
    if(r.error.code==='P0001'&&['Món đã ngừng bán hoặc hết món.','Giá món đã thay đổi. Kiểm tra thực đơn trước khi gửi lại.'].includes(r.error.message)){
     rejectedByMenu=true;localStorage.removeItem(storageKey(user));if(identity.current===user)setPending(null);await refresh();
     throw new Error(`Đơn chưa được lưu: ${r.error.message} Xóa chọn món không còn bán hoặc kiểm tra giá rồi gửi lại.`);
    }
    throw new Error(r.error.message);
   }
   if(identity.current!==user)return;
   try{localStorage.removeItem(storageKey(user));}catch{/* Retained request ID is safe to retry after reload. */}
   setPending(null);setDrafts(d=>({...d,[payload!.tableId]:{}}));setNotes(n=>({...n,[payload!.tableId]:{}}));
   setMessage(`Đã lưu đơn Bàn ${payload.tableId}. Món ăn được gửi tới bếp; món nước không vào bếp.`);
   await refresh();
  }catch(e){if(identity.current===user)setError(rejectedByMenu?(e instanceof Error?e.message:'Thực đơn đã thay đổi. Kiểm tra lại trước khi gửi.'):`Chưa xác nhận gửi đơn: ${e instanceof Error?e.message:'Lỗi kết nối'}. Giữ nguyên đơn và bấm Thử gửi lại; không tạo đơn mới.`);}
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
 const canCashier=!!profile&&['chu','thu_ngan'].includes(profile.role);
 const occupied=tables.filter(t=>sessions.some(s=>s.table_id===t.id)).length;
 const unpaidTotal=tables.reduce((n,t)=>n+savedTotal(sessions,t.id),0);
 const visibleTables=tables.filter(t=>t.name.toLocaleLowerCase('vi-VN').includes(tableSearch.trim().toLocaleLowerCase('vi-VN'))&&(tableFilter==='all'||(tableFilter==='busy')===sessions.some(s=>s.table_id===t.id)));
 const titles:Record<View,string>={service:selected?'Gọi món':'Sơ đồ bàn',kitchen:'Khu vực bếp',menu:'Quản lý thực đơn',revenue:'Báo cáo doanh thu',audit:'Nhật ký hoạt động',invoices:'Hóa đơn gần đây'};
 return <div className="pos-app"><header className="app-header"><a className="brand" href="#" onClick={e=>{e.preventDefault();if(profile)navigate(profile.role==='bep'?'kitchen':'service');}}><span className="brand-mark">GP</span><span><strong>Bún Riêu Góc Phố</strong><small>QUẢN LÝ BÁN HÀNG</small></span></a>
 {session&&<div className="account"><span className="account-name">{profile?.name??'Nhân viên'}<small>{profile?roles[profile.role]:''}</small></span><button className="logout-button" disabled={busy||locked} onClick={logout}>Đăng xuất</button></div>}</header>
 {profile&&!loading&&<div className="app-navigation"><nav aria-label="Chức năng">{profile.role!=='bep'&&<button aria-pressed={view==='service'} onClick={()=>navigate('service')}><PosIcon name="tables"/>Phục vụ</button>}<button aria-pressed={view==='kitchen'} onClick={()=>navigate('kitchen')}><PosIcon name="kitchen"/>Bếp ({cooking.length})</button>
 {canCashier&&<details ref={managementNav} data-active={view!=='service'&&view!=='kitchen'} className="management-menu"><summary><PosIcon name="menu"/>Quản lý<PosIcon name="chevron"/></summary><div className="management-dropdown"><small>QUẢN LÝ QUÁN</small>{profile.role==='chu'&&<button onClick={()=>navigate('menu')}><PosIcon name="menu"/>Quản lý thực đơn</button>}<button onClick={()=>navigate('revenue')}><PosIcon name="report"/>Báo cáo doanh thu</button><button onClick={()=>navigate('audit')}><PosIcon name="audit"/>Nhật ký hoạt động</button><button onClick={()=>navigate('invoices')}><PosIcon name="invoice"/>Hóa đơn gần đây</button></div></details>}
 </nav><div className="sync-tools"><span className={syncError?'connection-status offline':'connection-status'}>{syncError?'Chưa đồng bộ':lastSync?'Đã kết nối':'Đang kết nối'}</span><button aria-label="Đồng bộ" title="Đồng bộ dữ liệu" onClick={()=>void refresh()}><PosIcon name="refresh"/><span>Đồng bộ</span></button></div></div>}
 <main className="app-main">
 {error&&<aside className="notice error-notice" role="alert">{error}{!profile&&session&&<p><button onClick={()=>setReload(n=>n+1)}>Thử tải lại</button></p>}</aside>}
 {message&&<aside className="notice" role="status">{message}<button className="dismiss-notice" aria-label="Ẩn thông báo" onClick={()=>setMessage('')}>×</button></aside>}
 {loading?<div className="loading-state" role="status">Đang tải…</div>:!session?<div className="login-shell"><form className="login-form" onSubmit={login}><small>BÚN RIÊU GÓC PHỐ</small><h2>Đăng nhập nhân viên</h2><p>Chào ngày mới, sẵn sàng phục vụ.</p><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy||!supabase} type="submit">{busy?'Đang đăng nhập…':'Đăng nhập'}</button></form></div>:profile&&<>
 <div className="workspace-heading"><div><small>{view==='service'||view==='kitchen'?'BÁN HÀNG':'QUẢN LÝ'}</small><h1>{titles[view]}</h1></div><span className="workspace-subtitle">{view==='service'?`${tables.length} bàn · ${occupied} đang phục vụ`:view==='kitchen'?`${cooking.length} đơn đang làm`:'Bún Riêu Góc Phố'}</span></div>
 {syncError&&<aside className="notice error-notice" role="alert">{syncError}</aside>}
 {pending&&<aside className="notice" role="status"><strong>Đơn chờ xác nhận — Bàn {pending.tableId}</strong><ul>{pending.items.map((i,n)=><li key={n}>{i.qty} × {menu.find(m=>m.id===i.menu_item_id)?.name??i.menu_item_id}{i.note&&` · ${i.note}`}</li>)}</ul><p>Giữ nguyên mã gửi để tránh trùng đơn.</p><button disabled={sending||paymentPending||transferPending||menuPending||billPending} onClick={sendOrder}>{sending?'Đang gửi…':'Thử gửi lại đơn này'}</button></aside>}
 {menuPending&&view!=='menu'&&<aside className="notice" role="status">Có cập nhật thực đơn đang xử lý hoặc chờ xác nhận. <button onClick={()=>navigate('menu')}>Mở quản lý thực đơn</button></aside>}
 {(transferPending||billPending||paymentPending)&&view!=='service'&&view!=='invoices'&&<aside className="notice" role="status">Có thao tác bàn hoặc thanh toán đang chờ. <button onClick={()=>navigate('service')}>Kiểm tra thao tác chờ</button></aside>}
 <div hidden={view!=='service'} className="service-page"><div className="service-layout">
 <section className="service-main">
 {!selected?<><div className="tables-toolbar"><label className="search-field"><PosIcon name="search"/><input aria-label="Tìm bàn" placeholder="Tìm bàn…" value={tableSearch} onChange={e=>setTableSearch(e.target.value)}/></label><div className="table-filters" role="group" aria-label="Lọc trạng thái bàn"><button aria-pressed={tableFilter==='all'} onClick={()=>setTableFilter('all')}>Tất cả <span>{tables.length}</span></button><button aria-pressed={tableFilter==='empty'} onClick={()=>setTableFilter('empty')}>Trống <span>{tables.length-occupied}</span></button><button aria-pressed={tableFilter==='busy'} onClick={()=>setTableFilter('busy')}>Đang phục vụ <span>{occupied}</span></button></div></div>
 <div className="table-legend"><span><i className="legend-dot empty"/>Bàn trống</span><span><i className="legend-dot cooking"/>Bếp đang làm</span><span><i className="legend-dot ready"/>Đã ra món</span></div>
 <div className="table-grid">{visibleTables.map(t=>{
 const d=drafts[t.id]??{},draftTotal=menu.reduce((sum,i)=>sum+i.price*(d[i.id]||0),0);
 const known=pending?.tableId===t.id&&sessions.some(s=>s.orders.some(o=>o.request_id===pending.requestId));
 const amount=savedTotal(sessions,t.id)+(known?0:draftTotal),status=tableStatus(sessions,t.id);
 return <button className={`table-card ${status==='Trống'?'is-empty':status==='Bếp đang làm'?'is-cooking':'is-ready'}`} key={t.id} disabled={!lastSync} onClick={()=>{setSelected(t);setGroup('bun');setMenuSearch('');setMessage('');setTableActionsOpen(false);}}><div className="table-card-heading"><PosIcon name="tables"/><strong>{t.name}</strong></div><span className="table-total">{amount>0?money(amount):'Sẵn sàng phục vụ'}</span><span className="table-state">{lastSync?status:'Đang tải…'}</span>{draftTotal>0&&!known&&<small>Có món chưa xác nhận</small>}</button>;
 })}</div>{!visibleTables.length&&<div className="empty-state"><h3>Không tìm thấy bàn</h3><p>Thử đổi từ khóa hoặc bộ lọc.</p></div>}</>:<>
 <div className="menu-toolbar"><button className="back-button" onClick={()=>setSelected(null)}>← Danh sách bàn</button><label className="search-field"><PosIcon name="search"/><input aria-label="Tìm món" placeholder="Tìm tên món…" value={menuSearch} onChange={e=>setMenuSearch(e.target.value)}/></label></div>
 <div className="selected-table-strip"><strong>{selected.name}</strong><span>{tableStatus(sessions,selected.id)} · Chọn món để gọi thêm</span></div>
 <nav className="menu-groups" aria-label="Nhóm món">{groups.map(g=><button key={g.id} aria-pressed={group===g.id} onClick={()=>setGroup(g.id)}>{g.name}</button>)}</nav>
 {unavailableDraft&&!pending&&<aside className="notice error-notice" role="alert">Có món đang chọn đã hết hoặc ngừng bán. Bấm Xóa chọn rồi chọn lại trước khi gửi.</aside>}
 <fieldset disabled={locked}><legend className="visually-hidden">Chọn món mới</legend><div className="menu-grid">{menu.filter(m=>m.category===group&&!m.is_out&&m.name.toLocaleLowerCase('vi-VN').includes(menuSearch.trim().toLocaleLowerCase('vi-VN'))).map(m=><article className="menu-card" key={m.id}><div className="menu-row"><div><h2>{m.name}</h2><strong>{money(m.price)}</strong></div><div className="counter"><button aria-label={'Bớt '+m.name} disabled={locked||!qty[m.id]} onClick={()=>changeQty(m.id,-1)}>−</button><output>{qty[m.id]||0}</output><button aria-label={'Thêm '+m.name} disabled={locked||(qty[m.id]||0)>=99} onClick={()=>changeQty(m.id,1)}>+</button></div></div>{!!qty[m.id]&&<label>Ghi chú món<input maxLength={500} placeholder="Ví dụ: ít bún, không hành" value={notes[selected.id]?.[m.id]??''} onChange={e=>{const value=e.target.value;setNotes(n=>({...n,[selected.id]:{...n[selected.id],[m.id]:value}}));}}/></label>}</article>)}</div></fieldset>
 </>}
 </section>
 <aside className="table-order" aria-label="Đơn của bàn">
 <div className="order-panel-heading"><span className="order-panel-icon"><PosIcon name="invoice"/></span><div><h2>{selected?selected.name:'Thông tin bàn'}</h2><small>{selected?'Theo dõi đơn và thanh toán':'Chọn bàn để bắt đầu phục vụ'}</small></div></div>
 {!selected&&!transferPending&&!billPending&&!paymentPending&&<div className="table-placeholder"><PosIcon name="tables"/><h3>Chọn một bàn</h3><p>Gọi món, theo dõi đơn và thanh toán ngay tại đây.</p><dl><div><dt>Bàn trống</dt><dd>{tables.length-occupied}</dd></div><div><dt>Đang phục vụ</dt><dd>{occupied}</dd></div><div><dt>Chưa thanh toán</dt><dd>{money(unpaidTotal)}</dd></div></dl></div>}
 {selected&&<><h3 className="saved-order-title">Đơn đã lưu · {money(savedTotal(sessions,selected.id))}</h3><div className="saved-orders">{currentOrders.length?currentOrders.map(o=><article className="saved-order" key={o.id}><div><div className="order-heading"><h2>Đợt {new Date(o.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</h2><span className="order-status">{o.status==='cooking'?'Đang làm':'Đã ra món'}</span></div><ul>{o.order_items.map(i=><li className={i.cancelled_at?'cancelled-line':''} key={i.id}><div className="saved-line-heading"><strong>{i.qty} × {i.name}</strong><span>{money(i.price*i.qty)}</span></div><small>Bill {i.bill_no??1}</small>{i.note&&<p className="item-note">{i.note}</p>}{canCashier?<CancelItem compact item={i} disabled={locked||!!syncError||!lastSync} onChanged={refresh}/>:i.cancelled_at&&<p>Đã hủy · {i.cancel_reason}</p>}</li>)}</ul></div></article>):<div className="empty-orders"><p>Bàn chưa có món đã lưu.</p><small>Chọn món bên trái rồi bấm Gửi bếp.</small></div>}</div></>}
 <details className="table-operations" hidden={!canCashier||(!selected&&!transferPending&&!billPending)} open={tableActionsOpen||transferPending||billPending} onToggle={e=>setTableActionsOpen(e.currentTarget.open)}><summary>Thao tác bàn<PosIcon name="chevron"/></summary>
 {canCashier&&<TransferPanel key={`transfer:${session!.user.id}`} userId={session!.user.id} table={selected} tables={tables} sessions={sessions} disabled={billPending||menuPending||paymentPending||!!pending||sending||!!syncError||!lastSync||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setTransferPending} onTransferred={async id=>{await refresh();setSelected(tables.find(t=>t.id===id)??null);}}/>}
 {canCashier&&<BillPanel key={`bill-move:${session!.user.id}`} userId={session!.user.id} table={selected} sessions={sessions} disabled={menuPending||paymentPending||transferPending||sending||!!pending||!!syncError||!lastSync||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setBillPending} onChanged={refresh}/>}
 </details>
 <PaymentPanel key={session!.user.id} userId={session!.user.id} table={selected} sessions={sessions} canPay={canCashier} hasDraft={billPending||menuPending||transferPending||!!count||!!pending||!!syncError||!lastSync} onPending={setPaymentPending} onPaid={refresh} receiptRequest={receiptRequest} onReceiptError={setError}/>
 {selected&&<footer className="order-footer"><div><small>{selected.name} · {count} món chọn thêm</small><strong>{money(total)}</strong></div><div className="footer-actions"><button disabled={locked||!count} onClick={()=>{setDrafts(d=>({...d,[selected.id]:{}}));setNotes(n=>({...n,[selected.id]:{}}));}}>Xóa chọn</button><button className="primary" disabled={locked||!count||!lastSync||unavailableDraft} onClick={sendOrder}>Gửi bếp</button></div></footer>}
 </aside></div></div>
 {view==='kitchen'&&<div className="kitchen-page"><KitchenTools key={`kitchen-tools:${session!.user.id}`} orders={cooking} ready={!!lastSync} onFreshChange={setFreshKitchenIds} onShowQueue={()=>setHistory(false)}/><nav className="kitchen-tabs" aria-label="Đơn bếp"><button aria-pressed={!history} onClick={()=>setHistory(false)}>Đang làm ({cooking.length})</button><button aria-pressed={history} onClick={()=>setHistory(true)}>Lịch sử</button></nav><section className="kitchen-grid">{kitchen.map((o,index)=><article className={`kitchen-card ${!history&&index===0?'first-order':''} ${!history&&freshKitchenIds.includes(o.id)?'new-kitchen-order':''}`} key={o.id}><div className="order-heading"><h2>Bàn {o.table_sessions.table_id}</h2><span>{new Date(o.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} · {Math.max(0,Math.floor((Date.now()-Date.parse(o.created_at))/60000))} phút</span></div><small>Đơn {o.id.slice(0,8)}{!history&&freshKitchenIds.includes(o.id)&&<strong className="new-order-badge">Mới</strong>}</small><ul>{kitchenLines(o).map(i=><li key={i.id}><strong>{i.qty} × {i.name}</strong>{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul>{!history&&canComplete&&<button className="primary" disabled={!!completing} onClick={()=>void complete(o.id)}>{completing===o.id?'Đang lưu…':'Xong'}</button>}</article>)}{!kitchen.length&&<div className="empty-state"><h3>{history?'Chưa có đơn đã xong của các bàn đang mở.':'Chưa có món đang làm.'}</h3></div>}</section></div>}
 {profile.role==='chu'&&<div className="management-page" hidden={view!=='menu'}><MenuPanel key={`menu:${session!.user.id}`} active={view==='menu'} userId={session!.user.id} disabled={billPending||paymentPending||transferPending||!!pending||sending||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setMenuPending} onSaved={refresh}/></div>}
 {canCashier&&<><div className="management-page" hidden={view!=='revenue'}><RevenuePanel key={`revenue:${session!.user.id}`} active={view==='revenue'}/></div><div className="management-page" hidden={view!=='audit'}><AuditPanel active={view==='audit'}/></div><div className="management-page" hidden={view!=='invoices'}><InvoiceHistory active={view==='invoices'} disabled={paymentPending} onOpen={id=>{setError('');setReceiptRequest(r=>({id,key:(r?.key??0)+1}));}}/></div></>}
 </>}
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
