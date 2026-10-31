import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from './supabase';
import type {EditableEmployee} from './EmployeeEditor';
type Pending={request_id:string;employee_id:string;expected_version:number;name:string;submitted:boolean};
export default function EmployeeDelete({employee,userId,onClose,onChanged}:{employee:EditableEmployee|null;userId:string;onClose:()=>void;onChanged:()=>void}){
 const key=`pos:employee-delete:${userId}`;
 const [record,setRecord]=useState<Pending|null>(()=>{try{const p=JSON.parse(localStorage.getItem(key)||'null');return p&&typeof p.request_id==='string'&&typeof p.employee_id==='string'&&Number.isInteger(p.expected_version)&&typeof p.name==='string'?{...p,submitted:true}:null;}catch{return null;}});
 const initial=useRef(record),lock=useRef(false),dialog=useRef<HTMLDialogElement>(null);
 const [visible,setVisible]=useState(!!record),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 function done(){localStorage.removeItem(key);setRecord(null);setVisible(false);setMessage('Đã xóa quyền đăng nhập của nhân viên. Đơn hàng, thanh toán và nhật ký vẫn được giữ.');onClose();onChanged();}
 async function invoke(body:Record<string,unknown>){const r=await supabase!.functions.invoke('staff-admin',{body});let data=r.data;try{if(r.error?.context instanceof Response)data=await r.error.context.json();}catch{/* Không lộ lỗi nội bộ. */}return {data,error:r.error};}
 async function check(target:Pending){
  if(!supabase||lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{
   let r=await invoke({action:'check_employee_deletion',employee_id:target.employee_id,...(target.submitted?{request_id:target.request_id}:{})});
   if(r.error)throw Error('Chưa đọc được kết quả xóa. Giữ yêu cầu và kiểm tra lại.');
   if(!r.data?.deletion&&target.submitted)r=await invoke({action:'check_employee_deletion',employee_id:target.employee_id});
   if(r.error)throw Error('Chưa đọc được kết quả xóa. Giữ yêu cầu và kiểm tra lại.');
   const d=r.data?.deletion;if(d?.completed){done();return;}
   if(d){const next={...target,request_id:d.request_id,expected_version:d.expected_version,submitted:true};localStorage.setItem(key,JSON.stringify(next));setRecord(next);setMessage('Yêu cầu chưa hoàn tất. Tài khoản vẫn bị chặn.');}
   else{localStorage.removeItem(key);setRecord({...target,submitted:false});if(target.submitted){setMessage('Yêu cầu chưa bắt đầu. Đóng và tải lại danh sách trước khi thử lại.');onChanged();}}
  }catch(e){setMessage(e instanceof Error?e.message:'Chưa xác nhận được kết quả.');}
  finally{lock.current=false;setBusy(false);}
 }
 useEffect(()=>{if(initial.current)void check(initial.current);},[]);
 useEffect(()=>{if(employee){setVisible(true);if(!record||!record.submitted){const next={request_id:crypto.randomUUID(),employee_id:employee.id,expected_version:employee.staff_version??0,name:employee.name,submitted:false};setRecord(next);void check(next);}}},[employee]);
 useEffect(()=>{if(visible&&record&&!dialog.current?.open)dialog.current?.showModal();else if((!visible||!record)&&dialog.current?.open)dialog.current.close();},[visible,record]);
 function close(){if(busy)return;setVisible(false);if(!record?.submitted)setRecord(null);onClose();}
 async function apply(){
  if(!supabase||!record||lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{const next={...record,submitted:true};localStorage.setItem(key,JSON.stringify(next));setRecord(next);
   const r=await invoke({action:'delete_employee',request_id:record.request_id,employee_id:record.employee_id,expected_version:record.expected_version,confirmed:true});
   if(!r.error&&r.data?.completed){done();return;}
   if(r.data?.deletion){const d={...next,request_id:r.data.deletion.request_id,expected_version:r.data.deletion.expected_version};localStorage.setItem(key,JSON.stringify(d));setRecord(d);}
   setMessage(typeof r.data?.error==='string'?r.data.error:'Chưa xác nhận kết quả. Bấm Kiểm tra lại.');onChanged();
  }catch{setMessage('Chưa xác nhận kết quả. Giữ yêu cầu và bấm Kiểm tra lại.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <>
  {!visible&&message&&<p role="status">{message}</p>}
  {record?.submitted&&!visible&&<aside className="notice">Có yêu cầu xóa tài khoản chờ xác nhận. <button onClick={()=>setVisible(true)}>Mở yêu cầu xóa</button></aside>}
  {createPortal(<dialog ref={dialog} className="confirm-dialog employee-editor" aria-label="Xóa tài khoản nhân viên" onCancel={e=>{e.preventDefault();close();}}>{record&&<><h2>Xóa tài khoản?</h2><p><strong>{record.name}</strong></p><p>Nhân viên sẽ không đăng nhập được nữa và bị ẩn khỏi danh sách. Không thể khôi phục quyền đăng nhập bằng nút mở khóa.</p><p>Đơn hàng, thanh toán và nhật ký cũ vẫn được giữ để đối chiếu.</p>{message&&<p role="status">{message}</p>}<div className="confirm-dialog-actions"><button disabled={busy} onClick={close}>Đóng</button>{record.submitted&&<button disabled={busy} onClick={()=>void check(record)}>Kiểm tra lại</button>}<button className="danger" disabled={busy} onClick={()=>void apply()}>{busy?'Đang xử lý…':record.submitted?'Tiếp tục xóa':'Xác nhận xóa tài khoản'}</button></div></>}</dialog>,document.body)}
 </>;
}
