import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from './supabase';
import type {EditableEmployee} from './EmployeeEditor';
type Pending={request_id:string;employee_id:string;expected_version:number;name:string;submitted:boolean};
export default function EmployeePasswordReset({employee,userId,onClose,onChanged}:{employee:EditableEmployee|null;userId:string;onClose:()=>void;onChanged:()=>void}){
 const key=`pos:password-reset:${userId}`;
 const [record,setRecord]=useState<Pending|null>(()=>{try{const p=JSON.parse(localStorage.getItem(key)||'null');return p&&typeof p.request_id==='string'&&typeof p.employee_id==='string'&&Number.isInteger(p.expected_version)&&typeof p.name==='string'?{...p,submitted:true}:null;}catch{return null;}});
 const initial=useRef(record),lock=useRef(false),dialog=useRef<HTMLDialogElement>(null);
 const [visible,setVisible]=useState(!!record),[busy,setBusy]=useState(false),[password,setPassword]=useState(''),[message,setMessage]=useState('');
 function done(){localStorage.removeItem(key);setRecord(null);setVisible(false);setPassword('');setMessage('Đã đặt lại mật khẩu. Cấp mật khẩu tạm mới cho nhân viên; nhân viên phải đăng nhập lại và đổi mật khẩu.');onClose();onChanged();}
 async function invoke(body:Record<string,unknown>){
  const result=await supabase!.functions.invoke('staff-admin',{body});let data=result.data;
  if(result.error){try{if(result.error.context instanceof Response)data=await result.error.context.json();}catch{/* Không hiển thị lỗi nội bộ. */}}
  return {data,error:result.error};
 }
 async function check(target:Pending){
  if(!supabase||lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{
   let result=await invoke({action:'check_password_reset',employee_id:target.employee_id,...(target.submitted?{request_id:target.request_id}:{})});
   if(result.error)throw Error('Chưa đọc được kết quả. Giữ yêu cầu và kiểm tra lại.');
   if(!result.data?.reset&&target.submitted)result=await invoke({action:'check_password_reset',employee_id:target.employee_id});
   if(result.error)throw Error('Chưa đọc được kết quả. Giữ yêu cầu và kiểm tra lại.');
   const reset=result.data?.reset;
   if(reset?.completed){done();return;}
   if(reset){const next={...target,request_id:reset.request_id,expected_version:reset.expected_version,submitted:true};localStorage.setItem(key,JSON.stringify(next));setRecord(next);setMessage('Yêu cầu chưa hoàn tất. Nhập mật khẩu tạm mới, khác lần thử trước, rồi tiếp tục.');}
   else{localStorage.removeItem(key);setRecord({...target,submitted:false});if(target.submitted){setMessage('Yêu cầu chưa bắt đầu. Đóng cửa sổ và tải lại danh sách trước khi thử lại.');onChanged();}}
  }catch(e){setMessage(e instanceof Error?e.message:'Chưa xác nhận được kết quả.');}
  finally{lock.current=false;setBusy(false);}
 }
 useEffect(()=>{if(initial.current)void check(initial.current);},[]);
 useEffect(()=>{if(employee){setVisible(true);setPassword('');if(!record||!record.submitted){const next={request_id:crypto.randomUUID(),employee_id:employee.id,expected_version:employee.staff_version??0,name:employee.name,submitted:false};setRecord(next);void check(next);}}},[employee]);
 useEffect(()=>{if(visible&&record&&!dialog.current?.open)dialog.current?.showModal();else if((!visible||!record)&&dialog.current?.open)dialog.current.close();},[visible,record]);
 function close(){if(busy)return;setVisible(false);setPassword('');if(!record?.submitted)setRecord(null);onClose();}
 async function apply(){
  if(!supabase||!record||lock.current||password.length<6||password.length>12)return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   const next={...record,submitted:true};localStorage.setItem(key,JSON.stringify(next));setRecord(next);
   const result=await invoke({action:'reset_password',request_id:record.request_id,employee_id:record.employee_id,expected_version:record.expected_version,password});setPassword('');
   if(result.data?.completed===true&&!result.error){done();return;}
   if(result.data?.reset){const r={...next,request_id:result.data.reset.request_id,expected_version:result.data.reset.expected_version};localStorage.setItem(key,JSON.stringify(r));setRecord(r);}
   setMessage(typeof result.data?.error==='string'?result.data.error:'Chưa xác nhận được kết quả. Kiểm tra lại trước khi thử mật khẩu tạm khác.');onChanged();
  }catch{setPassword('');setMessage('Chưa xác nhận được kết quả. Kiểm tra lại; không tạo yêu cầu khác.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <>
  {!visible&&message&&<p role="status">{message}</p>}
  {record?.submitted&&!visible&&<aside className="notice">Có yêu cầu đặt lại mật khẩu chờ xác nhận. <button onClick={()=>setVisible(true)}>Mở yêu cầu đặt lại</button></aside>}
  {createPortal(<dialog ref={dialog} className="confirm-dialog employee-editor" aria-label="Đặt lại mật khẩu nhân viên" onCancel={e=>{e.preventDefault();close();}}>
   {record&&<><h2>Đặt lại mật khẩu</h2><p><strong>{record.name}</strong></p><p>Thao tác sẽ vô hiệu hóa phiên cũ. Nhân viên phải đăng nhập bằng mật khẩu tạm mới và đổi mật khẩu trước khi sử dụng POS.</p>
   <form onSubmit={e=>{e.preventDefault();void apply();}}><label>Mật khẩu tạm mới<input type="password" autoComplete="new-password" required minLength={6} maxLength={12} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>
   {message&&<p role="status">{message}</p>}
   <div className="confirm-dialog-actions"><button type="button" disabled={busy} onClick={close}>Đóng</button>{record.submitted&&<button type="button" disabled={busy} onClick={()=>void check(record)}>Kiểm tra lại</button>}<button className="danger" type="submit" disabled={busy||password.length<6}>{busy?'Đang xử lý…':record.submitted?'Tiếp tục đặt lại':'Xác nhận đặt lại'}</button></div></form></>}
  </dialog>,document.body)}
 </>;
}
