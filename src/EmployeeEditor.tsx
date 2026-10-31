import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from './supabase';
export type EditableEmployee={id:string;name:string;staff_code?:string|null;username?:string;role:string;is_active:boolean;staff_version?:number};
type Pending={p_request_id:string;p_employee_id:string;p_expected_version:number;p_name:string;p_staff_code?:string;p_username?:string;p_role:string;p_is_active:boolean};
export default function EmployeeEditor({employee,userId,onClose,onChanged}:{employee:EditableEmployee|null;userId:string;onClose:()=>void;onChanged:()=>void}){
 const storageKey=`pos:employee-update:${userId}`;
 const [pending,setPending]=useState<Pending|null>(()=>{try{const p=JSON.parse(localStorage.getItem(storageKey)||'null');return p&&typeof p.p_request_id==='string'&&typeof p.p_employee_id==='string'&&Number.isInteger(p.p_expected_version)&&typeof p.p_name==='string'&&(typeof p.p_username==='string'||typeof p.p_staff_code==='string')&&['phuc_vu','bep'].includes(p.p_role)&&typeof p.p_is_active==='boolean'?p:null;}catch{return null;}});
 const [name,setName]=useState(''),[code,setCode]=useState(''),[role,setRole]=useState('phuc_vu'),[active,setActive]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[hidden,setHidden]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),form=useRef<HTMLFormElement>(null),lock=useRef(false);
 useEffect(()=>{if(employee)setHidden(false);if(employee&&!pending){setName(employee.name);setCode(employee.username??'');setRole(employee.role);setActive(employee.is_active);setError('');setHidden(false);}},[employee]);
 const open=!!(employee||pending)&&!hidden;
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 function close(){if(busy)return;setHidden(true);setError('');onClose();}
 async function save(){
  if(!supabase||lock.current||(!pending&&!form.current?.reportValidity()))return;
  if(!pending&&(!employee||!Number.isInteger(employee.staff_version))){setError('Cần cập nhật database 028 và tải lại danh sách.');return;}
  const payload=pending??{p_request_id:crypto.randomUUID(),p_employee_id:employee!.id,p_expected_version:employee!.staff_version!,p_name:name.trim(),p_username:code.trim().toLowerCase(),p_role:role,p_is_active:active};
  lock.current=true;setBusy(true);setError('');
  try{
   try{localStorage.setItem(storageKey,JSON.stringify(payload));}catch{setError('Không lưu được yêu cầu trên thiết bị. Cho phép lưu trữ rồi thử lại.');return;}
   setPending(payload);
   const result=await supabase.rpc(payload.p_username!==undefined?'update_employee_account':'update_employee',payload);
   if(result.error){
    const certain=result.error.code==='23505'||result.error.code==='P0001'&&/đã thay đổi|không hợp lệ|đang đặt lại mật khẩu|đã xóa hoặc đang xóa|(?:Mã nhân viên|Tên đăng nhập) đã/.test(result.error.message);
    if(certain){localStorage.removeItem(storageKey);setPending(null);onChanged();}
    throw new Error(result.error.code==='P0001'?result.error.message:result.error.code==='23505'?'Tên đăng nhập đã tồn tại.':'Chưa xác nhận được kết quả. Bấm Thử lại cùng yêu cầu.');
   }
   if(result.data?.ok!==true)throw new Error('Chưa xác nhận được kết quả. Bấm Thử lại cùng yêu cầu.');
   localStorage.removeItem(storageKey);setPending(null);setHidden(true);onClose();onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Chưa xác nhận được kết quả. Bấm Thử lại cùng yêu cầu.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <>
  {pending&&!open&&<aside className="notice" role="status">Có cập nhật nhân viên chờ xác nhận. <button onClick={()=>setHidden(false)}>Mở yêu cầu chờ</button></aside>}
  {createPortal(<dialog ref={dialog} className="confirm-dialog employee-editor" aria-label="Sửa nhân viên" onCancel={e=>{e.preventDefault();close();}}>
   <h2>Sửa nhân viên</h2>
   <form ref={form} onSubmit={e=>{e.preventDefault();void save();}}>
    <fieldset disabled={busy||!!pending}>
     <label>Tên nhân viên<input required maxLength={100} value={pending?.p_name??name} onChange={e=>setName(e.target.value)}/></label>
     <label>Tên đăng nhập<input required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,39}" autoCapitalize="none" spellCheck={false} maxLength={40} value={pending?.p_username??(pending?'Yêu cầu cũ':code)} onChange={e=>setCode(e.target.value)}/></label>
     <label>Vai trò nhân viên<select aria-label="Vai trò nhân viên" value={pending?.p_role??role} onChange={e=>setRole(e.target.value)}><option value="phuc_vu">Waiter — Phục vụ</option><option value="bep">Kitchen — Bếp</option></select></label>
     <label>Trạng thái tài khoản<select aria-label="Trạng thái tài khoản" value={(pending?.p_is_active??active)?'active':'locked'} onChange={e=>setActive(e.target.value==='active')}><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></select></label>
    </fieldset>
    {!(pending?.p_is_active??active)&&<p>Khóa sẽ ngăn nhân viên tiếp tục gọi món, thanh toán và cập nhật bếp, kể cả phiên đăng nhập cũ.</p>}
    {pending&&<p role="status">Giữ nguyên thông tin để xác nhận cùng yêu cầu; không tạo cập nhật trùng.</p>}
    {error&&<p role="alert">{error}</p>}
    <div className="confirm-dialog-actions"><button type="button" disabled={busy} onClick={close}>Đóng</button><button className="primary" type="submit" disabled={busy}>{busy?'Đang lưu…':pending?'Thử lại cùng yêu cầu':!active?'Xác nhận khóa và lưu':'Lưu thay đổi'}</button></div>
   </form>
  </dialog>,document.body)}
 </>;
}
