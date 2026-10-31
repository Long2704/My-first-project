import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import DeferredPanel from './DeferredPanel';
import type {Session} from '@supabase/supabase-js';
import {supabase} from './supabase';
import PasswordRecovery,{recoveryCallback,recoveryUser,rememberRecovery} from './PasswordRecovery';
import {fifo, kitchenLines, savedTotal, tableStatus, placeLabel} from './order-model';
import type {Order, TableSession} from './order-model';
import './style.css';
import './pos/pos.css';
import PWAControls, {OfflineNotice,useOnline} from './pwa/PWAControls';
import PaymentModal from './pos/PaymentModal';
import type {PaymentHandle} from './pos/PaymentModal';
import ServiceWorkspace from './pos/ServiceWorkspace';
const RevenuePanel=React.lazy(()=>import('./RevenuePanel'));
import TransferPanel from './TransferPanel';
import TableManagement from './TableManagement';
import MenuPanel from './MenuPanel';
import BillPanel from './BillPanel';
import KitchenTools from './KitchenTools';
const InvoiceHistory=React.lazy(()=>import('./InvoiceHistory'));
const EmployeeManagement=React.lazy(()=>import('./EmployeeManagement'));
const InitialPasswordSetup=React.lazy(()=>import('./InitialPasswordSetup'));
import PosIcon from './PosIcon';
import CancelTablePanel from './CancelTablePanel';
import TableActions from './TableActions';
import SwipeOrderCard from './SwipeOrderCard';
const AuditPanel=React.lazy(()=>import('./AuditPanel'));
const roles:Record<string,string>={chu:'Bún Riêu Góc Phố',phuc_vu:'Phục vụ',bep:'Bếp'};
import {formatMoney as money} from './format';
type View='employees'|'tables'|'service'|'kitchen'|'menu'|'revenue'|'audit'|'invoices';
type Item={id:string;name:string;price:number;category:string;is_out:boolean};
type DiningTable={id:number;name:string};
type Profile={name:string;role:string;is_active:boolean;permissions:string[];must_change_password?:boolean;session_invalid?:boolean};
const permitted=(profile:Profile|null,permission:string)=>!!profile?.is_active&&profile.permissions.includes(permission);
function checkedAccess(data:unknown):Profile{
 const p=data as Partial<Profile>|null;
 if(!p||typeof p.name!=='string'||typeof p.role!=='string'||!roles[p.role]||!Array.isArray(p.permissions)||p.permissions.some(v=>typeof v!=='string'))throw new Error('Tài khoản chưa được cấp vai trò hợp lệ.');
 if(p.must_change_password!==undefined&&typeof p.must_change_password!=='boolean')throw new Error('Không xác nhận được trạng thái tài khoản.');
 if(p.session_invalid===true)throw new Error('Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng xuất và đăng nhập lại.');
 if(p.is_active!==true)throw new Error('Tài khoản đã bị khóa. Liên hệ Bún Riêu Góc Phố để được hỗ trợ.');
 return p as Profile;
}
type Pending={requestId:string;tableId:number;items:{menu_item_id:string;qty:number;note:string;expected_price?:number}[]};
type KitchenOrder=Order&{table_sessions:{table_id:number;closed_at:string|null;table_path?:number[]}};
const orderFields='service_label,table_path,id,request_id,session_id,status,kitchen_relevant,created_at,order_items(id,name,price,qty,category,note,paid,bill_no,cancelled_at,cancel_reason)';
const storageKey=(user:string)=>`goc-pho-pending-v1:${user}`;
function App(){
 const online=useOnline();
 const [recovering,setRecovering]=useState(()=>recoveryCallback||!!recoveryUser());
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true);
 const [profile,setProfile]=useState<Profile|null>(null),[menu,setMenu]=useState<Item[]>([]),[tables,setTables]=useState<DiningTable[]>([]);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  if(!message.startsWith('Đã lưu đơn '))return;
  const current=message,timer=setTimeout(()=>setMessage(value=>value===current?'':value),2800);
  return()=>clearTimeout(timer);
 },[message]);
 const wasOnline=useRef(online);
 useEffect(()=>{const reconnected=!wasOnline.current&&online;wasOnline.current=online;if(reconnected&&session&&!profile&&!loading)setReload(n=>n+1);},[online,session,profile,loading]);
 const [freshKitchenIds,setFreshKitchenIds]=useState<string[]>([]);
 const [view,setView]=useState<View>('service'),[history,setHistory]=useState(false);
 const [tableSearch,setTableSearch]=useState(''),[tableFilter,setTableFilter]=useState<'all'|'empty'|'busy'>('all');
 const [receiptRequest,setReceiptRequest]=useState<{id:string;key:number}|null>(null);
 const managementNav=useRef<HTMLDetailsElement>(null);
 const [loadedViews,setLoadedViews]=useState<Partial<Record<View,true>>>({});
 function navigate(next:View){
  if(next==='invoices'&&profile?.role==='bep')return;
  const permission:Record<View,string>={service:'orders.read',kitchen:'orders.read',tables:'tables.manage',menu:'menu.manage',revenue:'reports.read',audit:'audit.read',invoices:'receipts.read_own',employees:'employees.manage'};
  if(!permitted(profile,permission[next]))return;
  setLoadedViews(current=>current[next]?current:{...current,[next]:true});setView(next);managementNav.current?.removeAttribute('open');
 }
 const [posScreen,setPosScreen]=useState<'menu'|'order'>('menu');
 const paymentController=useRef<PaymentHandle>(null);
 const [paymentReady,setPaymentReady]=useState(false);
 const [pendingPaymentAmount,setPendingPaymentAmount]=useState<{total:number;tableId:number}|null>(null);
 const [selected,setSelected]=useState<DiningTable|null>(null);
 const [drafts,setDrafts]=useState<Record<number,Record<string,number>>>({}),[notes,setNotes]=useState<Record<number,Record<string,string>>>({});
 const [tablePending,setTablePending]=useState(false);
 const [paymentPending,setPaymentPending]=useState(false),[transferPending,setTransferPending]=useState(false),[menuPending,setMenuPending]=useState(false),[billPending,setBillPending]=useState(false),[cancelTablePending,setCancelTablePending]=useState(false),[itemCancelBusy,setItemCancelBusy]=useState(false);
 const [pending,setPending]=useState<Pending|null>(null),[sending,setSending]=useState(false);
 const [sessions,setSessions]=useState<TableSession[]>([]),[cooking,setCooking]=useState<KitchenOrder[]>([]);
 const [syncError,setSyncError]=useState(''),[lastSync,setLastSync]=useState(''),[completing,setCompleting]=useState<string|null>(null);
 const sendLock=useRef(false),refreshLock=useRef(false),identity=useRef<string|null>(null);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(Object.values(drafts).some(table=>Object.values(table).some(qty=>qty>0))||pending||sending){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts,pending,sending]);
 const menuRef=useRef(menu),draftRef=useRef(drafts);menuRef.current=menu;draftRef.current=drafts;
 identity.current=session?.user.id??null;
 useEffect(()=>{
  if(!supabase){setError('Chưa cấu hình kết nối Supabase.');setLoading(false);return;}
  let active=true,changed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,s)=>{changed=true;if(active){if(event==='PASSWORD_RECOVERY'&&s){rememberRecovery(s.user.id);setRecovering(true);}else if(event==='SIGNED_OUT'){rememberRecovery(null);}else if(s&&recoveryUser()&&recoveryUser()!==s.user.id&&!recoveryCallback){rememberRecovery(null);setRecovering(false);}setSession(s);setLoading(false);}});
  supabase.auth.getSession().then(({data,error})=>{if(active&&!changed){setSession(data.session);if(error)setError('Không thể khôi phục phiên đăng nhập.');setLoading(false);}}).catch(()=>{if(active){setError('Không thể kết nối. Vui lòng tải lại trang.');setLoading(false);}});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  setLoadedViews({});setTableSearch('');setTableFilter('all');setReceiptRequest(null);setProfile(null);setMenu([]);setTables([]);setDrafts({});setNotes({});setSelected(null);setPosScreen('order');setSessions([]);setCooking([]);setPending(null);setError('');setMessage('');setLastSync('');setSyncError('');
  if(recovering){setLoading(false);return;}
  if(!session||!supabase)return;
  const user=session.user.id;let active=true;setLoading(true);
  try{
   const raw=localStorage.getItem(storageKey(user));
   if(raw){const p:Pending=JSON.parse(raw);if(!p.requestId||!Number.isInteger(p.tableId)||!Array.isArray(p.items)||!p.items.length)throw new Error();setPending(p);setDrafts({[p.tableId]:Object.fromEntries(p.items.map(i=>[i.menu_item_id,i.qty]))});setNotes({[p.tableId]:Object.fromEntries(p.items.map(i=>[i.menu_item_id,i.note]))});}
  }catch{setError('Không đọc được đơn chờ gửi trên thiết bị. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ trước khi gửi lại đơn.');}
  async function load(){
   try{
    const p=await supabase!.rpc('get_my_access');
    if(p.error)throw new Error('Không đọc được quyền nhân viên. Kiểm tra migration 023 và kết nối.');
    const access=checkedAccess(p.data);
    if(access.must_change_password){if(active){setProfile(access);setView('service');}return;}
    const [m,t]=await Promise.all([supabase!.from('menu_items').select('id,name,price,category,is_out').eq('is_active',true).order('sort').order('id'),supabase!.from('restaurant_tables').select('id,name').eq('is_active',true).order('display_order').order('id')]);
    if(m.error||t.error)throw new Error('Không tải được thực đơn hoặc danh sách bàn.');
    if(active){setProfile(access);setMenu(m.data??[]);setTables(t.data??[]);setView(access.role==='bep'?'kitchen':'service');}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Không thể tải dữ liệu.');}finally{if(active)setLoading(false);}
  }
  void load();return()=>{active=false;};
 },[session?.user.id,reload,recovering]);
 const refresh=useCallback(async()=>{
  if(!supabase||!profile||profile.must_change_password||!session||refreshLock.current)return;
  const user=session.user.id;refreshLock.current=true;
  try{
   const accessResult=await supabase.rpc('get_my_access');
   if(identity.current!==user)return;
   if(accessResult.error)throw new Error();
   let access:Profile;
   try{access=checkedAccess(accessResult.data);}catch(e){
    setProfile(null);setMenu([]);setTables([]);setSessions([]);setCooking([]);setSelected(null);setReceiptRequest(null);setLastSync('');
    setError(e instanceof Error?e.message:'Không xác nhận được quyền tài khoản.');
    return;
   }
   if(access.must_change_password){setProfile(access);setMenu([]);setTables([]);setSessions([]);setCooking([]);setSelected(null);setReceiptRequest(null);setLastSync('');return;}
   setProfile(prev=>JSON.stringify(prev)===JSON.stringify(access)?prev:access);
   setView(current=>{
    if(current==='invoices'&&access.role==='bep')return 'kitchen';
    const permissions:Record<View,string>={service:'orders.read',kitchen:'orders.read',tables:'tables.manage',menu:'menu.manage',revenue:'reports.read',audit:'audit.read',invoices:'receipts.read_own',employees:'employees.manage'};
    return permitted(access,permissions[current])?current:access.role==='bep'?'kitchen':'service';
   });
   const [s,k,m,t]=await Promise.all([
    supabase.from('table_sessions').select(`id,table_id,table_path,orders(${orderFields})`).is('closed_at',null),
    supabase.from('orders').select(`${orderFields},table_sessions!inner(table_id,closed_at,table_path)`).eq('status','cooking').eq('kitchen_relevant',true).order('created_at').order('id'),
    supabase.from('menu_items').select('id,name,price,category,is_out').eq('is_active',true).order('sort').order('id'),
    supabase.from('restaurant_tables').select('id,name').eq('is_active',true).order('display_order').order('id')
   ]);
   if(s.error||k.error||m.error||t.error)throw new Error();
   if(identity.current===user){
    if(JSON.stringify(menuRef.current)!==JSON.stringify(m.data)&&Object.values(draftRef.current).some(d=>Object.values(d).some(n=>n>0)))setMessage('Thực đơn đã thay đổi. Kiểm tra lại giá và món đang chọn trước khi gửi.');
    setTables(prev=>JSON.stringify(prev)===JSON.stringify(t.data??[])?prev:t.data??[]);setSelected(prev=>{if(!prev)return null;const next=(t.data??[]).find(t=>t.id===prev.id);return next&&next.name!==prev.name?next:prev;});setMenu(prev=>JSON.stringify(prev)===JSON.stringify(m.data??[])?prev:m.data??[]);setSessions(prev=>JSON.stringify(prev)===JSON.stringify(s.data)?prev:s.data as unknown as TableSession[]);setCooking(prev=>JSON.stringify(prev)===JSON.stringify(k.data)?prev:k.data as unknown as KitchenOrder[]);setLastSync(new Date().toLocaleTimeString('vi-VN'));setSyncError('');}
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
  try{
   // Tài khoản cũ vẫn đăng nhập được trong lúc chuyển đổi; giao diện chỉ hỏi tên đăng nhập.
   if(email.includes('@')){const r=await supabase.auth.signInWithPassword({email:email.trim(),password});if(r.error)setError('Đăng nhập thất bại. Kiểm tra tên đăng nhập, mật khẩu và kết nối.');else setPassword('');}
   else{
    const r=await supabase.functions.invoke('staff-login',{body:{username:email.trim().toLowerCase(),password}});
    if(r.error||!r.data?.access_token||!r.data?.refresh_token){
     let message='Đăng nhập thất bại. Kiểm tra tên đăng nhập, mật khẩu và kết nối.';
     try{const body=r.error?.context instanceof Response?await r.error.context.json():r.data;if(typeof body?.error==='string')message=body.error;}catch{/* Không hiển thị lỗi nội bộ. */}
     setError(message);
    }else{const session=await supabase.auth.setSession({access_token:r.data.access_token,refresh_token:r.data.refresh_token});if(session.error)setError('Chưa xác nhận được phiên đăng nhập. Vui lòng thử lại.');else setPassword('');}
   }
  }catch{setError('Không kết nối được Supabase.');}finally{setBusy(false);}
 }
 async function logout(){if(!supabase||(profile&&!profile.must_change_password&&(sending||paymentPending||transferPending||tablePending||menuPending||billPending||cancelTablePending||itemCancelBusy)))return;setBusy(true);try{const r=await supabase.auth.signOut({scope:'local'});if(r.error)setError('Chưa đăng xuất được.');}catch{setError('Chưa đăng xuất được.');}finally{setBusy(false);}}
 const qty=selected?drafts[selected.id]??{}:{};
 const count=Object.values(qty).reduce((a,b)=>a+b,0);
 const unavailableDraft=Object.entries(qty).some(([id,n])=>n>0&&!menu.some(m=>m.id===id&&!m.is_out));
 const locked=!!pending||sending||paymentPending||transferPending||tablePending||menuPending||billPending||cancelTablePending||itemCancelBusy;
 const changeQty=useCallback((id:string,delta:number)=>{if(!selected||locked)return;const table=selected.id;setDrafts(d=>({...d,[table]:{...d[table],[id]:Math.min(99,Math.max(0,(d[table]?.[id]||0)+delta))}}));},[selected?.id,locked]);
 const changeNote=useCallback((id:string,note:string)=>{if(!selected||locked)return;const table=selected.id;setNotes(current=>({...current,[table]:{...current[table],[id]:note}}));},[selected?.id,locked]);
 async function sendOrder(orderNote=''){
  if(!navigator.onLine){setError('Mất kết nối. Kết nối mạng trước khi gửi món.');return;}
  if(!session||!supabase||sendLock.current||paymentPending||transferPending||tablePending||menuPending||billPending||cancelTablePending||itemCancelBusy||!permitted(profile,'orders.create'))return;
  const user=session.user.id;
  let payload=pending;
  if(!payload){
   if(!selected||!count||unavailableDraft||(selected.id<0&&!sessions.some(s=>s.table_id===selected.id)))return;
   payload={requestId:crypto.randomUUID(),tableId:selected.id,items:Object.entries(qty).filter(([,n])=>n>0).map(([id,n])=>({menu_item_id:id,qty:n,note:[orderNote.trim(),notes[selected.id]?.[id]?.trim()??''].filter(Boolean).join('\n'),expected_price:menu.find(m=>m.id===id)!.price}))};
   if(payload.items.some(item=>item.note.length>500)){setError('Tổng ghi chú đơn và ghi chú món tối đa 500 ký tự mỗi món. Hãy rút gọn trước khi gửi.');return;}
   try{localStorage.setItem(storageKey(user),JSON.stringify(payload));}catch{setError('Không lưu được mã đơn trên thiết bị. Hãy cho phép lưu trữ trình duyệt trước khi gửi.');return;}
   setPending(payload);
  }
  sendLock.current=true;setSending(true);setError('');setMessage('');let rejectedByMenu=false;
  try{
   const r=await supabase.rpc('submit_order',{p_table_id:payload.tableId,p_request_id:payload.requestId,p_items:payload.items});
   if(r.error){
    if(r.error.code==='P0001'&&r.error.message==='Bàn không hoạt động.'){
     localStorage.removeItem(storageKey(user));
     if(identity.current===user){setPending(null);setPosScreen('order');setDrafts(d=>({...d,[payload!.tableId]:{}}));setNotes(n=>({...n,[payload!.tableId]:{}}));setSelected(null);}
     rejectedByMenu=true;
     throw new Error(`Đơn chưa được gửi vì bàn cũ đã ngừng hoạt động. Chọn bàn đang hoạt động và gọi lại: ${payload.items.map(i=>`${i.qty} × ${menu.find(m=>m.id===i.menu_item_id)?.name??i.menu_item_id}${i.note?' ('+i.note+')':''}`).join('; ')}.`);
    }
    if(r.error.code==='P0001'&&['Món đã ngừng bán hoặc hết món.','Giá món đã thay đổi. Kiểm tra thực đơn trước khi gửi lại.'].includes(r.error.message)){
     rejectedByMenu=true;localStorage.removeItem(storageKey(user));if(identity.current===user)setPending(null);await refresh();
     throw new Error(`Đơn chưa được lưu: ${r.error.message} Xóa chọn món không còn bán hoặc kiểm tra giá rồi gửi lại.`);
    }
    throw new Error(r.error.message);
   }
   if(identity.current!==user)return;
   try{localStorage.removeItem(storageKey(user));}catch{/* Retained request ID is safe to retry after reload. */}
   setPending(null);setPosScreen('order');setDrafts(d=>({...d,[payload!.tableId]:{}}));setNotes(n=>({...n,[payload!.tableId]:{}}));
   setMessage(`Đã lưu đơn ${tables.find(t=>t.id===payload.tableId)?.name??placeLabel(payload.tableId)}.`);
   await refresh();
  }catch(e){if(identity.current===user)setError(rejectedByMenu?(e instanceof Error?e.message:'Thực đơn đã thay đổi. Kiểm tra lại trước khi gửi.'):`Chưa xác nhận gửi đơn: ${e instanceof Error?e.message:'Lỗi kết nối'}. Giữ nguyên đơn và bấm Thử gửi lại; không tạo đơn mới.`);}
  finally{sendLock.current=false;setSending(false);}
 }
 async function complete(id:string){
  if(!navigator.onLine){setError('Mất kết nối. Kết nối mạng trước khi hoàn thành đơn.');return;}
  if(!supabase||!permitted(profile,'kitchen.complete')||completing||cancelTablePending||itemCancelBusy)return;setCompleting(id);setError('');
  try{const r=await supabase.rpc('complete_kitchen_order',{p_order_id:id});if(r.error)throw new Error(r.error.message);await refresh();}
  catch(e){setError(`Chưa hoàn thành đơn: ${e instanceof Error?e.message:'Lỗi kết nối'}. Có thể thử lại an toàn.`);}finally{setCompleting(null);}
 }
 const historyOrders=fifo(sessions.flatMap(s=>s.orders.filter(o=>o.status==='done'&&o.kitchen_relevant).map(o=>({...o,table_sessions:{table_id:s.table_id,closed_at:null,table_path:s.table_path}}))));
 const kitchen=history?historyOrders:fifo(cooking);
 const canComplete=permitted(profile,'kitchen.complete');
 const currentOrders=selected?fifo(sessions.filter(s=>s.table_id===selected.id).flatMap(s=>s.orders)):[];
 const showTableMenu=!!selected&&posScreen==='menu';
 const canPay=permitted(profile,'payments.collect');
 const canDiscount=permitted(profile,'payments.discount');
 const canTransfer=permitted(profile,'tables.transfer'),canSplit=permitted(profile,'bills.split');
 const canCancel=permitted(profile,'orders.cancel');
 const canCancelTable=permitted(profile,'tables.cancel')||canCancel;
 const canReadInvoices=profile?.role!=='bep'&&permitted(profile,'receipts.read_own');
 const canManage=permitted(profile,'menu.manage')||permitted(profile,'tables.manage')||permitted(profile,'reports.read')||permitted(profile,'audit.read')||permitted(profile,'employees.manage');
 const placeName=(id:number)=>tables.find(t=>t.id===id)?.name??placeLabel(id);
 const dineTables=tables.filter(t=>t.id>0);
 const channelTables=tables;
 const occupied=channelTables.filter(t=>sessions.some(s=>s.table_id===t.id)).length;
 const visibleTables=channelTables.filter(t=>t.name.toLocaleLowerCase('vi-VN').includes(tableSearch.trim().toLocaleLowerCase('vi-VN'))&&(tableFilter==='all'||(tableFilter==='busy')===sessions.some(s=>s.table_id===t.id)));
 const titles:Record<View,string>={service:selected?(showTableMenu?'Gọi món':'Đơn đã gọi'):'Sơ đồ bàn',kitchen:'Khu vực bếp',tables:'Quản lý bàn',menu:'Quản lý thực đơn',revenue:'Báo cáo doanh thu',audit:'Nhật ký hoạt động',invoices:'Hóa đơn gần đây',employees:'Quản lý nhân viên'};
 return <div className={`pos-app${view==='service'&&selected?' has-pos-workspace pos-workspace-'+posScreen:''}`}><header className="app-header"><a className="brand" href="#" onClick={e=>{e.preventDefault();if(profile)navigate(profile.role==='bep'?'kitchen':'service');}}><img className="brand-mark" src="/brand/goc-pho-logo.webp" alt="Logo Bún Riêu Góc Phố" width={54} height={54}/><span><strong>Bún Riêu Góc Phố</strong><small>QUẢN LÝ BÁN HÀNG</small></span></a>
 {session&&!recovering&&<div className="account"><span className="account-name">{profile?.role==='chu'?'Bún Riêu Góc Phố':profile?.name??'Nhân viên'}{profile?.role!=='chu'&&<small>{profile?roles[profile.role]:''}</small>}</span><button className="logout-button" disabled={busy||!!profile&&!profile.must_change_password&&locked} onClick={logout}>Đăng xuất</button></div>}</header>
 {profile&&!recovering&&!profile.must_change_password&&!loading&&<div className="app-navigation"><nav aria-label="Chức năng">{permitted(profile,'orders.read')&&<button aria-pressed={view==='service'} onClick={()=>navigate('service')}><PosIcon name="tables"/>Phục vụ</button>}<button aria-pressed={view==='kitchen'} onClick={()=>navigate('kitchen')}><PosIcon name="kitchen"/>Bếp ({cooking.length})</button>
 {!canManage&&canReadInvoices&&<button aria-pressed={view==='invoices'} onClick={()=>navigate('invoices')}><PosIcon name="invoice"/>Hóa đơn của tôi</button>}{canManage&&<details ref={managementNav} data-active={view!=='service'&&view!=='kitchen'} className="management-menu"><summary><PosIcon name="menu"/>Quản lý<PosIcon name="chevron"/></summary><div className="management-dropdown"><small>QUẢN LÝ QUÁN</small>{permitted(profile,'employees.manage')&&<button onClick={()=>navigate('employees')}><PosIcon name="employees"/>Quản lý nhân viên</button>}{permitted(profile,'menu.manage')&&<><button onClick={()=>navigate('menu')}><PosIcon name="menu"/>Quản lý thực đơn</button><button onClick={()=>navigate('tables')}><PosIcon name="tables"/>Quản lý bàn</button></>}<button onClick={()=>navigate('revenue')}><PosIcon name="report"/>Báo cáo doanh thu</button><button onClick={()=>navigate('audit')}><PosIcon name="audit"/>Nhật ký hoạt động</button><button onClick={()=>navigate('invoices')}><PosIcon name="invoice"/>Hóa đơn gần đây</button></div></details>}
 </nav><div className="sync-tools"><span className={syncError?'connection-status offline':'connection-status'}>{syncError?'Chưa đồng bộ':lastSync?'Đã kết nối':'Đang kết nối'}</span><button aria-label="Đồng bộ" title="Đồng bộ dữ liệu" onClick={()=>void refresh()}><PosIcon name="refresh"/><span>Đồng bộ</span></button></div></div>}
 <main className="app-main"><PWAControls/><OfflineNotice online={online}/>
 {error&&<aside className="notice error-notice" role="alert">{error}{!profile&&session&&<p><button onClick={()=>setReload(n=>n+1)}>Thử tải lại</button></p>}</aside>}
 {message&&<aside className="notice" role="status">{message}<button className="dismiss-notice" aria-label="Ẩn thông báo" onClick={()=>setMessage('')}>×</button></aside>}
 {loading?<div className="loading-state" role="status">Đang tải…</div>:recovering?<PasswordRecovery hasSession={!!session} onExit={async()=>{if(supabase&&session){const result=await supabase.auth.signOut({scope:'local'});if(result.error)throw result.error;}rememberRecovery(null);setRecovering(false);window.history.replaceState(null,'',window.location.pathname);}}/>:!session?<div className="login-shell"><form className="login-form" onSubmit={login}><small>BÚN RIÊU GÓC PHỐ</small><h2>Đăng nhập nhân viên</h2><p>Chào ngày mới, sẵn sàng phục vụ.</p><label>Tên đăng nhập<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy||!supabase} type="submit">{busy?'Đang đăng nhập…':'Đăng nhập'}</button></form></div>:profile?.must_change_password?<React.Suspense fallback={<p role="status">Đang tải thiết lập mật khẩu…</p>}><InitialPasswordSetup key={`initial-password:${session!.user.id}`} onBusy={setBusy} onCompleted={()=>setReload(n=>n+1)}/></React.Suspense>:profile&&<>
 <div className={`workspace-heading${view==='kitchen'?' kitchen-heading':''}`}><div><div className="workspace-title-row"><h1>{titles[view]}</h1>{view==='kitchen'&&<KitchenTools key={`kitchen-tools:${session!.user.id}`} orders={cooking} ready={!!lastSync} onFreshChange={setFreshKitchenIds} onShowQueue={()=>setHistory(false)}/>}</div></div></div>
 {syncError&&<aside className="notice error-notice" role="alert">{syncError}</aside>}
 {pending&&<aside className="notice" role="status"><strong>Đơn chờ xác nhận — {placeName(pending.tableId)}</strong><ul>{pending.items.map((i,n)=><li key={n}>{i.qty} × {menu.find(m=>m.id===i.menu_item_id)?.name??i.menu_item_id}{i.note&&` · ${i.note}`}</li>)}</ul><p>Giữ nguyên mã gửi để tránh trùng đơn.</p><button disabled={sending||paymentPending||transferPending||tablePending||menuPending||billPending||cancelTablePending||itemCancelBusy} onClick={()=>void sendOrder()}>{sending?'Đang gửi…':'Thử gửi lại đơn này'}</button></aside>}
 {tablePending&&view!=='tables'&&<aside className="notice" role="status">Có cập nhật bàn đang chờ. <button onClick={()=>navigate('tables')}>Mở quản lý bàn</button></aside>}
 {menuPending&&view!=='menu'&&<aside className="notice" role="status">Có cập nhật thực đơn đang xử lý hoặc chờ xác nhận. <button onClick={()=>navigate('menu')}>Mở quản lý thực đơn</button></aside>}
 {(transferPending||billPending||cancelTablePending||itemCancelBusy||paymentPending)&&view!=='service'&&view!=='invoices'&&<aside className="notice" role="status">Có thao tác hoặc thanh toán đang chờ. <button onClick={()=>navigate('service')}>Kiểm tra thao tác chờ</button></aside>}
 <div hidden={view!=='service'} className="service-page">
 {!selected&&<div className="service-layout tables-only"><section className="service-main"><div className="tables-toolbar"><label className="search-field"><PosIcon name="search"/><input aria-label="Tìm bàn" placeholder="Tìm bàn…" value={tableSearch} onChange={e=>setTableSearch(e.target.value)}/></label><div className="table-filters" role="group" aria-label="Lọc trạng thái bàn"><button aria-pressed={tableFilter==='all'} onClick={()=>setTableFilter('all')}>Tất cả <span>{channelTables.length}</span></button><button aria-pressed={tableFilter==='empty'} onClick={()=>setTableFilter('empty')}>Trống <span>{channelTables.length-occupied}</span></button><button aria-pressed={tableFilter==='busy'} onClick={()=>setTableFilter('busy')}>Đang phục vụ <span>{occupied}</span></button></div></div>

 <div className="table-grid">{visibleTables.map(t=>{
 const d=drafts[t.id]??{},draftTotal=menu.reduce((sum,i)=>sum+i.price*(d[i.id]||0),0);
 const known=pending?.tableId===t.id&&sessions.some(s=>s.orders.some(o=>o.request_id===pending.requestId));
 const amount=savedTotal(sessions,t.id)+(known?0:draftTotal),status=tableStatus(sessions,t.id);
 return <button className={`table-card ${(status==='Trống'||status==='Chưa gọi món')?'is-empty':status==='Bếp đang làm'?'is-cooking':'is-ready'}`} key={t.id} disabled={!lastSync} onClick={()=>{setSelected(t);setPosScreen(sessions.some(session=>session.table_id===t.id&&session.orders.length)?'order':'menu');setMessage('');}}><div className="table-card-heading"><strong>{t.name}</strong></div>{amount>0&&<span className="table-total">{money(amount)}</span>}<span className="table-state">{lastSync?status:'Đang tải…'}</span>{draftTotal>0&&!known&&<small>Có món chưa xác nhận</small>}</button>;
 })}</div>{!visibleTables.length&&<div className="empty-state"><h3>Không tìm thấy bàn</h3><p>Thử đổi từ khóa hoặc bộ lọc.</p></div>}</section></div>}
 {selected&&<ServiceWorkspace key={`${session!.user.id}:${selected.id}`} userId={session!.user.id} table={selected} sessionId={sessions.find(s=>s.table_id===selected.id)?.id??null} mode={posScreen} onMode={setPosScreen} products={menu} qty={qty} notes={notes[selected.id]??{}} orders={currentOrders} savedTotal={savedTotal(sessions,selected.id)} disabled={locked} sending={sending} retry={pending?.tableId===selected.id} requestId={pending?.tableId===selected.id?pending.requestId:undefined} pendingPaymentAmount={pendingPaymentAmount?.tableId===selected.id?pendingPaymentAmount.total:null} canCancel={canCancel} canPay={canPay} paymentReady={online&&paymentReady} paymentPending={paymentPending} tableActionsVisible={(canTransfer||canSplit||canCancelTable)&&!!(currentOrders.length||transferPending||billPending||cancelTablePending)} onClose={()=>setSelected(null)} onChange={changeQty} onNote={changeNote} onClear={()=>{setDrafts(current=>({...current,[selected.id]:{}}));setNotes(current=>({...current,[selected.id]:{}}));}} onSend={note=>void sendOrder(note)} onPay={()=>{if(navigator.onLine)paymentController.current?.open();}} onBusy={setItemCancelBusy} onSavedChanged={refresh} sendDisabled={!online||sending||paymentPending||transferPending||tablePending||menuPending||billPending||cancelTablePending||itemCancelBusy||(!pending&&(!count||!lastSync||unavailableDraft))||!!pending&&pending.tableId!==selected.id} feedback={<><OfflineNotice online={online}/>{pendingPaymentAmount&&pendingPaymentAmount.tableId!==selected.id&&<aside className="notice" role="status">Thanh toán {placeName(pendingPaymentAmount.tableId)} đang chờ. Mở Kiểm tra thanh toán để đối chiếu.</aside>}{error&&<aside className="notice error-notice" role="alert">{error}</aside>}{syncError&&<aside className="notice error-notice" role="alert">{syncError}</aside>}{message&&<aside className="notice" role="status">{message}<button className="dismiss-notice" aria-label="Ẩn thông báo" onClick={()=>setMessage('')}>×</button></aside>}{unavailableDraft&&!pending&&<aside role="alert" className="notice error-notice">Có món đã hết hoặc ngừng bán. Chọn lại trước khi gửi.</aside>}{pending&&<aside className="notice" role="status">Đơn chờ xác nhận — {placeName(pending.tableId)}. Giữ nguyên yêu cầu để tránh trùng đơn.</aside>}</>}/>}
 <div className="pos-legacy-operations"> <TableActions label={selected&&selected.id<0?'Thao tác đơn':'Thao tác bàn'} key={`table-actions:${session!.user.id}`} visible={(canTransfer||canSplit||canCancelTable)&&!!((selected&&currentOrders.length)||transferPending||billPending||cancelTablePending)} active={view==='service'} pending={transferPending||billPending||cancelTablePending} title={selected?.name??'Yêu cầu chờ'}>
 {canTransfer&&<TransferPanel key={`transfer:${session!.user.id}`} userId={session!.user.id} table={selected&&selected.id>0?selected:null} tables={dineTables} sessions={sessions} disabled={cancelTablePending||itemCancelBusy||billPending||tablePending||menuPending||paymentPending||!!pending||sending||!!syncError||!lastSync||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setTransferPending} onTransferred={async id=>{await refresh();setSelected(tables.find(t=>t.id===id)??null);}}/>}
 {canSplit&&<BillPanel key={`bill-move:${session!.user.id}`} userId={session!.user.id} table={selected} sessions={sessions} disabled={cancelTablePending||itemCancelBusy||tablePending||menuPending||paymentPending||transferPending||sending||!!pending||!!syncError||!lastSync||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setBillPending} onChanged={async id=>{await refresh();if(id)setSelected(tables.find(t=>t.id===id)??null);}}/>}
 {canCancelTable&&<CancelTablePanel key={`cancel-table:${session!.user.id}`} userId={session!.user.id} table={selected} sessions={sessions} disabled={itemCancelBusy||tablePending||menuPending||paymentPending||transferPending||billPending||sending||!!pending||!!syncError||!lastSync||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setCancelTablePending} onChanged={refresh} onMessage={setMessage}/>}
 </TableActions></div>
 <PaymentModal compact={!!selected} ref={paymentController} onPendingAmount={setPendingPaymentAmount} onReady={setPaymentReady} key={session!.user.id} userId={session!.user.id} table={selected} sessions={sessions} canPay={canPay} canDiscount={canDiscount} hasDraft={!online||cancelTablePending||itemCancelBusy||billPending||tablePending||menuPending||transferPending||!!count||!!pending||!!syncError||!lastSync} onPending={setPaymentPending} onPaid={refresh} receiptRequest={receiptRequest} onReceiptError={setError}/>
 </div>
 {view==='kitchen'&&<div className="kitchen-page"><nav className="kitchen-tabs" aria-label="Đơn bếp"><button aria-pressed={!history} onClick={()=>setHistory(false)}>Đang làm ({cooking.length})</button><button aria-pressed={history} onClick={()=>setHistory(true)}>Lịch sử</button></nav><p id="kitchen-swipe-help" className="visually-hidden">Vuốt đơn sang trái hoặc phải để hoàn thành.</p><section className="kitchen-grid" aria-describedby="kitchen-swipe-help">{kitchen.map((o,index)=><SwipeOrderCard disabled={!online||!!history||!canComplete||!!completing||cancelTablePending||itemCancelBusy||!!syncError} onComplete={()=>complete(o.id)} className={`kitchen-card ${!history&&index===0?'first-order':''} ${!history&&freshKitchenIds.includes(o.id)?'new-kitchen-order':''}`} key={o.id}><div className="order-heading"><h2 className="kitchen-table-path">{o.service_label||(o.table_path?.length?o.table_path:o.table_sessions.table_path?.length?o.table_sessions.table_path:[o.table_sessions.table_id]).map(placeName).join(' → ')}</h2><span>{new Date(o.created_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} · {Math.max(0,Math.floor((Date.now()-Date.parse(o.created_at))/60000))} phút</span></div>{!history&&freshKitchenIds.includes(o.id)&&<small><strong className="new-order-badge">Mới</strong></small>}<ul>{kitchenLines(o).map(i=><li key={i.id}><strong>{i.qty} × {i.name}</strong>{i.note&&<p className="item-note">{i.note}</p>}</li>)}</ul>{!history&&canComplete&&<button className="primary" disabled={!online||!!completing||cancelTablePending||itemCancelBusy||!!syncError} onClick={()=>void complete(o.id)}>{completing===o.id?'Đang lưu…':'Xong'}</button>}</SwipeOrderCard>)}{!kitchen.length&&<div className="empty-state"><h3>{history?'Chưa có đơn đã xong của các bàn đang mở.':'Chưa có món đang làm.'}</h3></div>}</section></div>}
 {permitted(profile,'employees.manage')&&view==='employees'&&<div className="management-page"><React.Suspense fallback={<p role="status">Đang tải quản lý nhân viên…</p>}><EmployeeManagement key={`employees:${session!.user.id}`} userId={session!.user.id} active/></React.Suspense></div>}
 {permitted(profile,'tables.manage')&&<div className="management-page" hidden={view!=='tables'}><TableManagement key={`tables:${session!.user.id}`} userId={session!.user.id} active={view==='tables'} disabled={menuPending||cancelTablePending||itemCancelBusy||billPending||paymentPending||transferPending||!!pending||sending||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setTablePending} onSaved={refresh}/></div>}
 {permitted(profile,'menu.manage')&&<div className="management-page" hidden={view!=='menu'}><MenuPanel key={`menu:${session!.user.id}`} active={view==='menu'} userId={session!.user.id} disabled={tablePending||cancelTablePending||itemCancelBusy||billPending||paymentPending||transferPending||!!pending||sending||Object.values(drafts).some(d=>Object.values(d).some(n=>n>0))} onPending={setMenuPending} onSaved={refresh}/></div>}
 {permitted(profile,'reports.read')&&(loadedViews.revenue||view==='revenue')&&<div className="management-page" hidden={view!=='revenue'}><DeferredPanel onBack={()=>navigate('service')}><RevenuePanel key={`revenue:${session!.user.id}`} active={view==='revenue'}/></DeferredPanel></div>}
 {permitted(profile,'audit.read')&&(loadedViews.audit||view==='audit')&&<div className="management-page" hidden={view!=='audit'}><DeferredPanel onBack={()=>navigate('service')}><AuditPanel active={view==='audit'}/></DeferredPanel></div>}
 {canReadInvoices&&(loadedViews.invoices||view==='invoices')&&<div className="management-page" hidden={view!=='invoices'}><DeferredPanel onBack={()=>navigate('service')}><InvoiceHistory key={`invoices:${session!.user.id}`} active={view==='invoices'} disabled={paymentPending} ownOnly={!permitted(profile,'receipts.read_all')} onOpen={id=>{setError('');setReceiptRequest(r=>({id,key:(r?.key??0)+1}));}}/></DeferredPanel></div>}
 </>}
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
