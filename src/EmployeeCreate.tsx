import {useRef,useState} from 'react';
import {supabase} from './supabase';
type Draft={request_id:string;name:string;staff_code:string;email:string;role:string};
export default function EmployeeCreate({userId,onCreated}:{userId:string;onCreated:()=>void}){
 const key=`pos:employee-create:${userId}`;
 const [draft,setDraft]=useState<Draft|null>(()=>{
  try{const value=JSON.parse(localStorage.getItem(key)||'null');return value&&typeof value.request_id==='string'&&typeof value.name==='string'&&typeof value.staff_code==='string'&&typeof value.email==='string'&&['phuc_vu','bep'].includes(value.role)?value:null;}catch{return null;}
 });
 const [open,setOpen]=useState(!!draft),[name,setName]=useState(''),[code,setCode]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('phuc_vu');
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false);
 async function send(check=false,cancel=false){
  if(!supabase||lock.current)return;
  const input=draft??{request_id:crypto.randomUUID(),name:name.trim(),staff_code:code.trim().toUpperCase(),email:email.trim().toLowerCase(),role};
  lock.current=true;setBusy(true);setMessage('');
  try{
   // Chỉ giữ thông tin yêu cầu để phục hồi. Không lưu mật khẩu.
   try{localStorage.setItem(key,JSON.stringify(input));}
   catch{setMessage('Không lưu được yêu cầu trên thiết bị. Cho phép lưu trữ rồi thử lại.');return;}
   setDraft(input);
   const result=await supabase.functions.invoke('staff-admin',{body:{...input,action:cancel?'cancel_creation':check?'check_creation':'create_employee',...(!check?{password}:{})}});
   setPassword('');
   let body=result.data;
   if(result.error){
    try{if(result.error.context instanceof Response)body=await result.error.context.json();}catch{/* Không lộ lỗi nội bộ. */}
    if(body?.pending!==false&&!body?.error)throw new Error('Chưa xác nhận kết quả. Bấm Kiểm tra lại trước khi tạo lại.');
   }
   if(body?.ok===true){localStorage.removeItem(key);setDraft(null);setOpen(false);setName('');setCode('');setEmail('');setMessage('Đã tạo nhân viên. Cấp email và mật khẩu tạm cho đúng nhân viên; nhân viên phải đổi ở lần đăng nhập đầu.');onCreated();return;}
   if(body?.released===true){localStorage.removeItem(key);setDraft(null);}
   setMessage(typeof body?.error==='string'?body.error:typeof body?.message==='string'?body.message:'Chưa xác nhận kết quả. Bấm Kiểm tra lại.');
  }catch{setPassword('');setMessage('Chưa xác nhận kết quả hoặc không lưu được yêu cầu. Bấm Kiểm tra lại; không tạo yêu cầu khác.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <div className="employee-create">
  {!open&&<button className="primary" onClick={()=>{setMessage('');setOpen(true);}}>Thêm nhân viên</button>}
  {message&&<p role="status">{message}</p>}
  {open&&<form aria-label="Thêm nhân viên" onSubmit={e=>{e.preventDefault();void send();}}>
   <h3>Thêm nhân viên</h3>
   <fieldset disabled={busy||!!draft}>
    <label>Tên nhân viên<input required maxLength={100} value={draft?.name??name} onChange={e=>setName(e.target.value)}/></label>
    <label>Mã nhân viên<input required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" maxLength={32} value={draft?.staff_code??code} onChange={e=>setCode(e.target.value)}/></label>
    <label>Email đăng nhập<input required type="email" maxLength={254} value={draft?.email??email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Vai trò nhân viên<select aria-label="Vai trò nhân viên" value={draft?.role??role} onChange={e=>setRole(e.target.value)}><option value="phuc_vu">Waiter — Phục vụ</option><option value="bep">Kitchen — Bếp</option></select></label>
   </fieldset>
   <label>Mật khẩu tạm<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <small>12–128 ký tự. Nhân viên phải đổi khi đăng nhập lần đầu.</small>
   <div className="employee-create-actions"><button className="primary" type="submit" disabled={busy}>{busy?'Đang xử lý…':draft?'Thử lại cùng yêu cầu':'Tạo tài khoản'}</button>
   {draft?<><button type="button" disabled={busy} onClick={()=>void send(true)}>Kiểm tra lại</button><button type="button" disabled={busy} onClick={()=>void send(true,true)}>Hủy yêu cầu</button></>:<button type="button" disabled={busy} onClick={()=>{setPassword('');setOpen(false);}}>Đóng</button>}</div>
  </form>}
 </div>;
}
