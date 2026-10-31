import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import PosIcon from './PosIcon';
import EmployeeCreate from './EmployeeCreate';
import EmployeeEditor from './EmployeeEditor';
import EmployeePasswordReset from './EmployeePasswordReset';
import EmployeeDelete from './EmployeeDelete';

type Employee={id:string;name:string;staff_code?:string|null;username?:string;role:string;is_active:boolean;created_at:string;staff_version?:number;password_reset_pending?:boolean;account_deletion_pending?:boolean};
type Filters={search:string;role:string;status:string};
const roleLabels:Record<string,string>={chu:'Owner',phuc_vu:'Waiter',bep:'Kitchen',thu_ngan:'Thu ngân (cũ)'};
const pageSize=20;
const createdLabel=(value:string)=>new Intl.DateTimeFormat('vi-VN',{
  timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric'
}).format(new Date(value));

export default function EmployeeManagement({active,userId}:{active:boolean;userId:string}){
 const [draft,setDraft]=useState<Filters>({search:'',role:'',status:''});
 const [filters,setFilters]=useState<Filters>({search:'',role:'',status:''});
 const [rows,setRows]=useState<Employee[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const sequence=useRef(0);
 const [editing,setEditing]=useState<Employee|null>(null);
 const [resetting,setResetting]=useState<Employee|null>(null);
 const [deleting,setDeleting]=useState<Employee|null>(null);

 useEffect(()=>{
  const request=++sequence.current;
  let cancelled=false;
  setRows([]);setTotal(0);setError('');
  if(!active){setBusy(false);return;}
  setBusy(true);
  const controller=new AbortController();
  const current=()=>!cancelled&&sequence.current===request;
  async function load(){
   try{
    if(!supabase)throw new Error('Chưa cấu hình kết nối Supabase.');
    const result=await supabase.rpc('list_employees',{
     p_search:filters.search,
     p_role:filters.role||null,
     p_active:filters.status===''?null:filters.status==='active',
     p_page:page,p_page_size:pageSize
    }).abortSignal(controller.signal);
    if(!current())return;
    if(result.error){
     if(['PGRST202','42883'].includes(result.error.code))throw new Error('Cần chạy SQL 025 để mở danh sách nhân viên.');
     throw new Error(result.error.code==='P0001'?result.error.message:'Không tải được danh sách nhân viên. Vui lòng thử lại.');
    }
    const data=result.data;
    if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<0)throw new Error('Dữ liệu nhân viên chưa hợp lệ. Vui lòng tải lại.');
    const lastPage=Math.max(1,Math.ceil(data.total/pageSize));
    if(page>lastPage){setPage(lastPage);return;}
    setRows(data.items as Employee[]);setTotal(data.total);
   }catch(e){if(current()){setRows([]);setTotal(0);setError(e instanceof Error?e.message:'Không tải được danh sách nhân viên.');}}
   finally{if(current())setBusy(false);}
  }
  void load();
  return()=>{cancelled=true;controller.abort();};
 },[active,userId,filters.search,filters.role,filters.status,page,reload]);

 function search(){setPage(1);setFilters({...draft,search:draft.search.trim()});setReload(n=>n+1);}
 const pages=Math.max(1,Math.ceil(total/pageSize));
 return <section className="employee-management" aria-label="Danh sách nhân viên">
  <EmployeeDelete employee={deleting} userId={userId} onClose={()=>setDeleting(null)} onChanged={()=>setReload(n=>n+1)}/>
  <EmployeePasswordReset employee={resetting} userId={userId} onClose={()=>setResetting(null)} onChanged={()=>setReload(n=>n+1)}/>
  <EmployeeEditor employee={editing} userId={userId} onClose={()=>setEditing(null)} onChanged={()=>setReload(n=>n+1)}/>
  <EmployeeCreate userId={userId} onCreated={()=>{setPage(1);setReload(n=>n+1);}}/>
  <div className="employee-toolbar"><span role="status">{busy?'Đang tải…':error?'Chưa tải được':`${total} nhân viên`}</span><button aria-label="Tải lại nhân viên" disabled={busy} onClick={()=>setReload(n=>n+1)}><PosIcon name="refresh"/>Tải lại</button></div>
  <form className="employee-filters" onSubmit={e=>{e.preventDefault();search();}}>
   <label>Tên hoặc tên đăng nhập<input type="search" maxLength={100} value={draft.search} placeholder="Tìm nhân viên…" onChange={e=>setDraft({...draft,search:e.target.value})}/></label>
   <div><label htmlFor="employee-role">Vai trò</label><select id="employee-role" value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value})}><option value="">Tất cả vai trò</option><option value="chu">Owner</option><option value="phuc_vu">Waiter</option><option value="bep">Kitchen</option></select></div>
   <div><label htmlFor="employee-status">Trạng thái</label><select id="employee-status" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></select></div>
   <button className="primary" type="submit" disabled={busy}>Tìm</button>
  </form>
  {busy?<p role="status">Đang tải nhân viên…</p>:error?<p role="alert">{error}</p>:!rows.length?<div className="empty-state"><h3>Không có nhân viên phù hợp</h3></div>:<>
   <div className="employee-list">{rows.map(employee=><article key={employee.id} aria-label={`Nhân viên ${employee.role==='chu'?'Bún Riêu Góc Phố':employee.name}`}>
    <div className="employee-identity"><h3>{employee.role==='chu'?'Bún Riêu Góc Phố':employee.name}</h3><p>{employee.username?`Đăng nhập: ${employee.username}`:'Chưa có tên đăng nhập'}</p></div>
    <dl><div><dt>Vai trò</dt><dd><span className="employee-role">{roleLabels[employee.role]??'Chưa xác định'}</span></dd></div><div><dt>Trạng thái</dt><dd><span className={`employee-status ${employee.is_active?'is-active':'is-locked'}`}>{employee.account_deletion_pending?'Đang xóa':employee.password_reset_pending?'Đang đặt lại mật khẩu':employee.is_active?'Đang hoạt động':'Đã khóa'}</span></dd></div><div><dt>Ngày tạo</dt><dd><time dateTime={employee.created_at}>{createdLabel(employee.created_at)}</time></dd></div></dl>
    <div className="employee-row-actions">{['phuc_vu','bep'].includes(employee.role)?<><button aria-label={`Sửa nhân viên ${employee.name}`} disabled={busy||employee.password_reset_pending||employee.account_deletion_pending} onClick={()=>setEditing(employee)}>Sửa</button><button aria-label={`Đặt lại mật khẩu ${employee.name}`} disabled={busy||employee.account_deletion_pending} onClick={()=>setResetting(employee)}>{employee.password_reset_pending?'Tiếp tục đặt lại':'Đặt lại mật khẩu'}</button><button className="danger" aria-label={`Xóa tài khoản ${employee.name}`} disabled={busy||employee.password_reset_pending} onClick={()=>setDeleting(employee)}>{employee.account_deletion_pending?'Tiếp tục xóa':'Xóa'}</button></>:<small>{employee.role==='chu'?'Owner được bảo vệ':'Vai trò cũ'}</small>}</div>
   </article>)}</div>
   {pages>1&&<nav className="employee-pagination" aria-label="Phân trang nhân viên"><button disabled={busy||page<=1} onClick={()=>setPage(n=>n-1)}>Trang trước</button><span>Trang {page} / {pages}</span><button disabled={busy||page>=pages} onClick={()=>setPage(n=>n+1)}>Trang sau</button></nav>}
  </>}
 </section>;
}
