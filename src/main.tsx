import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import './style.css';
const groups = [{id:'bun',name:'Món chính'},{id:'an_them',name:'Món thêm'},{id:'do_uong',name:'Nước giải khát'}];
type Item = {id:string;name:string;price:number;category:string;is_out:boolean};
type DiningTable = {id:number;name:string};
type Profile = {name:string;role:string};
const roles:Record<string,string> = {chu:'Chủ quán',thu_ngan:'Thu ngân',phuc_vu:'Phục vụ',bep:'Bếp'};
const money=(n:number)=>new Intl.NumberFormat('vi-VN').format(n)+'đ';
function App(){
 const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true);
 const [profile,setProfile]=useState<Profile|null>(null),[menu,setMenu]=useState<Item[]>([]);
 const [error,setError]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 const [group,setGroup]=useState('bun'),[drafts,setDrafts]=useState<Record<number,Record<string,number>>>({}),[reload,setReload]=useState(0);
 const [tables,setTables]=useState<DiningTable[]>([]),[selectedTable,setSelectedTable]=useState<DiningTable|null>(null);
 const qty=selectedTable ? drafts[selectedTable.id]??{} : {};
 function setQty(update:React.SetStateAction<Record<string,number>>){if(!selectedTable)return;const id=selectedTable.id;setDrafts(d=>({...d,[id]:typeof update==='function'?update(d[id]??{}):update}));}
 useEffect(()=>{
  if(!supabase){setError('Chưa cấu hình kết nối Supabase.');setLoading(false);return;}
  let active=true,changed=false;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{changed=true;if(active){setSession(s);setLoading(false);}});
  supabase.auth.getSession().then(({data,error})=>{if(active&&!changed){setSession(data.session);if(error)setError('Không thể khôi phục phiên đăng nhập.');setLoading(false);}}).catch(()=>{if(active){setError('Không thể kết nối. Vui lòng tải lại trang.');setLoading(false);}});
  return ()=>{active=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  setProfile(null);setMenu([]);setDrafts({});setTables([]);setSelectedTable(null);setError('');
  if(!session||!supabase)return;
  let active=true;setLoading(true);
  async function load(){
   try{
    const p=await supabase!.from('profiles').select('name,role').eq('id',session!.user.id).maybeSingle();
    if(p.error)throw new Error('Không đọc được hồ sơ. Kiểm tra kết nối và chính sách RLS.');
    if(!p.data||!roles[p.data.role])throw new Error('Tài khoản chưa được cấp vai trò nhân viên. Liên hệ chủ quán.');
    const m=await supabase!.from('menu_items').select('id,name,price,category,is_out').eq('is_active',true).order('sort').order('id');
    if(m.error)throw new Error('Không tải được thực đơn. Kiểm tra kết nối và chính sách RLS.');
    const t=await supabase!.from('restaurant_tables').select('id,name').eq('is_active',true).order('id');
    if(t.error)throw new Error('Không tải được danh sách bàn. Kiểm tra bảng restaurant_tables và quyền RLS.');
    if(active){setProfile(p.data);setMenu(m.data??[]);setTables(t.data??[]);}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Không thể tải dữ liệu.');}
   finally{if(active)setLoading(false);}
  }
  void load();return ()=>{active=false;};
 },[session?.user.id,reload]);
 async function login(e:React.FormEvent){
  e.preventDefault();if(!supabase)return;setBusy(true);setError('');
  try{const r=await supabase.auth.signInWithPassword({email:email.trim(),password});if(r.error)setError('Đăng nhập thất bại. Kiểm tra email, mật khẩu và kết nối.');else setPassword('');}
  catch{setError('Không thể kết nối Supabase. Vui lòng thử lại.');}finally{setBusy(false);}
 }
 async function logout(){if(!supabase)return;setBusy(true);try{const r=await supabase.auth.signOut({scope:'local'});if(r.error)setError('Chưa đăng xuất được. Vui lòng thử lại.');}catch{setError('Chưa đăng xuất được.');}finally{setBusy(false);}}
 const total=menu.reduce((s,m)=>s+m.price*(qty[m.id]||0),0);
 return <><header><small>ỨNG DỤNG NỘI BỘ CỦA QUÁN</small><h1>Bún Riêu Góc Phố</h1><p>Nóng hổi từng tô, đậm đà vị cua.</p>{session&&<div className="account"><span>{profile?`${profile.name} · ${roles[profile.role]}`:'Tài khoản nhân viên'}</span><button disabled={busy} onClick={logout}>Đăng xuất</button></div>}</header><main>
 {error&&<aside role="alert">{error}{session&&<p><button onClick={()=>setReload(r=>r+1)}>Thử tải lại</button></p>}</aside>}
 {loading?<p role="status">Đang tải…</p>:!session?<form onSubmit={login}><h2>Đăng nhập nhân viên</h2><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy||!supabase} type="submit">{busy?'Đang đăng nhập…':'Đăng nhập'}</button><p>Dùng tài khoản do chủ quán cấp.</p></form>:profile&&<><aside><strong>Gọi món — bản dùng thử</strong><p>Lựa chọn từng bàn chỉ giữ trong trang đang mở, mất khi tải lại hoặc đăng xuất. Chưa gửi bếp hay lưu đơn hàng.</p></aside>{!selectedTable?<><h2 className="section-title">Chọn bàn</h2><div className="table-grid">{tables.map(t=>{const count=Object.values(drafts[t.id]??{}).reduce((a,b)=>a+b,0);return <button className="table-card" key={t.id} onClick={()=>{setSelectedTable(t);setGroup('bun');}}><strong>{t.name}</strong><span>{count?`${count} món chọn thử`:'Chưa chọn món'}</span></button>;})}</div>{!tables.length&&<p>Chưa có bàn đang hoạt động.</p>}</>:<><div className="table-heading"><button onClick={()=>setSelectedTable(null)}>← Danh sách bàn</button><h2>{selectedTable.name}</h2></div><nav aria-label="Nhóm món">{groups.map(g=><button key={g.id} aria-pressed={group===g.id} onClick={()=>setGroup(g.id)}>{g.name}</button>)}</nav><section>{menu.filter(m=>m.category===group&&!m.is_out).map(m=><article key={m.id}><div><h2>{m.name}</h2><strong>{money(m.price)}</strong></div><div className="counter"><button aria-label={'Bớt '+m.name} disabled={!qty[m.id]} onClick={()=>setQty(q=>({...q,[m.id]:Math.max(0,(q[m.id]||0)-1)}))}>−</button><output aria-live="polite">{qty[m.id]||0}</output><button aria-label={'Thêm '+m.name} onClick={()=>setQty(q=>({...q,[m.id]:(q[m.id]||0)+1}))}>+</button></div></article>)}{!menu.some(m=>m.category===group&&!m.is_out)&&<p>Chưa có món đang bán trong nhóm này.</p>}</section></>}</>}
 </main>{profile&&!loading&&selectedTable&&<footer><div><small>{selectedTable.name} · {Object.values(qty).reduce((a,b)=>a+b,0)} món đã chọn</small><strong>{money(total)}</strong></div><button disabled={!total} onClick={()=>setQty({})}>Xóa lựa chọn</button></footer>}</>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
