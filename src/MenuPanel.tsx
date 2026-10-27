import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
const groups=[{id:'bun',name:'Món chính'},{id:'an_them',name:'Món thêm'},{id:'do_uong',name:'Nước giải khát'}];
type MenuItem={id:string;name:string;price:number;category:string;is_active:boolean;is_out:boolean;sort:number;version:number};
type Edit={id:string;version:number;name:string;price:string;category:string;active:boolean;out:boolean;sort:string};
type Attempt={requestId:string;itemId:string;version:number;name:string;price:number;category:string;active:boolean;out:boolean;sort:number};
const integer=(s:string)=>/^\d+$/.test(s)?Number(s):NaN;
const asEdit=(p:Attempt):Edit=>({id:p.itemId,version:p.version,name:p.name,price:String(p.price),category:p.category,active:p.active,out:p.out,sort:String(p.sort)});
export default function MenuPanel({userId,disabled,onPending,onSaved,active}:{userId:string;disabled:boolean;onPending:(v:boolean)=>void;onSaved:()=>Promise<void>;active?:boolean}){
 const key=`goc-pho-menu-v1:${userId}`;
 const [open,setOpen]=useState(false),[items,setItems]=useState<MenuItem[]>([]),[edit,setEdit]=useState<Edit|null>(null);
 const [pending,setPending]=useState<Attempt|null>(null),[storageError,setStorageError]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw) as Attempt;if(!p.requestId||!p.itemId||!Number.isInteger(p.version)||p.version<0||typeof p.name!=='string'||!Number.isInteger(p.price)||!Number.isInteger(p.sort)||typeof p.active!=='boolean'||typeof p.out!=='boolean')throw new Error();setPending(p);setEdit(asEdit(p));setOpen(true);}}catch{setStorageError(true);}return()=>{alive.current=false;};},[key]);
 useEffect(()=>{onPending(!!pending||storageError||busy);},[pending,storageError,busy,onPending]);
 const valid=!!edit&&edit.name.trim().length>0&&edit.name.trim().length<=120&&Number.isSafeInteger(integer(edit.price))&&integer(edit.price)<=10000000&&Number.isSafeInteger(integer(edit.sort))&&integer(edit.sort)<=9999;
 async function readMenu(){
  const r=await supabase!.rpc('list_menu_management');
  if(r.error)throw new Error(['PGRST202','42883'].includes(r.error.code)?'Database chưa có quản lý thực đơn. Cần chạy migration 008_menu_management.sql.':'Không tải được thực đơn quản lý. Kiểm tra quyền chủ quán và kết nối.');
  if(alive.current)setItems(r.data as MenuItem[]);
 }
 async function load(){if(!supabase||lock.current)return;lock.current=true;setBusy(true);setOpen(true);setError('');try{await readMenu();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Không tải được thực đơn.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 useEffect(()=>{if(active)void load();},[active]);
 async function save(){
  if(!supabase||lock.current||storageError)return;
  let attempt=pending;
  if(!attempt){if(disabled||!edit||!valid)return;attempt={requestId:crypto.randomUUID(),itemId:edit.id,version:edit.version,name:edit.name.trim(),price:integer(edit.price),category:edit.category,active:edit.active,out:edit.out,sort:integer(edit.sort)};
   try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã cập nhật. Chưa gửi yêu cầu.');return;}setPending(attempt);
  }
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const r=await supabase.rpc('save_menu_item',{p_request_id:attempt.requestId,p_item_id:attempt.itemId,p_expected_version:attempt.version,p_name:attempt.name,p_price:attempt.price,p_category:attempt.category,p_is_active:attempt.active,p_is_out:attempt.out,p_sort:attempt.sort});
   if(r.error){
    if(r.error.code==='P0001'&&r.error.message!=='Mã cập nhật thực đơn đã được sử dụng.'){
     localStorage.removeItem(key);if(alive.current)setPending(null);
     if(r.error.message==='Món đã được cập nhật ở nơi khác. Tải lại thực đơn rồi kiểm tra lại.'){if(alive.current)setEdit(null);await readMenu();}
     throw new Error(r.error.message);
    }
    throw new Error(['PGRST202','42883'].includes(r.error.code)?'Cần chạy migration 008_menu_management.sql rồi Thử lại cùng mã cập nhật.':`Chưa xác nhận lưu: ${r.error.message}. Thử lại cùng mã cập nhật, không tạo món lần nữa.`);
   }
   await onSaved();await readMenu();localStorage.removeItem(key);
   if(alive.current){setPending(null);setEdit(null);setMessage('Đã lưu thực đơn. Đơn và hóa đơn đã lưu giữ nguyên giá cũ.');}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa xác nhận lưu. Thử lại cùng mã cập nhật.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function start(item?:MenuItem){setMessage('');setError('');setEdit(item?{id:item.id,version:item.version,name:item.name,price:String(item.price),category:item.category,active:item.is_active,out:item.is_out,sort:String(item.sort??0)}:{id:crypto.randomUUID(),version:0,name:'',price:'0',category:'bun',active:true,out:false,sort:'0'});}
 return <section className="menu-management" aria-label="Quản lý thực đơn">
 {active===undefined&&<button disabled={busy} aria-expanded={open} onClick={()=>{if(open&&!pending)setOpen(false);else void load();}}>Quản lý thực đơn</button>}
 {storageError&&<p role="alert">Không đọc được cập nhật thực đơn chờ. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ.</p>}
 {pending&&<aside role="status"><strong>Cập nhật thực đơn chờ xác nhận: {pending.name}</strong><p>{pending.price.toLocaleString('vi-VN')}đ · Giữ nguyên mã để tránh tạo trùng món.</p><button disabled={busy} onClick={()=>void save()}>{busy?'Đang lưu…':'Thử lại cùng mã cập nhật'}</button></aside>}
 {open&&<>{active===undefined&&<h2>Quản lý thực đơn</h2>}<p>Giá mới chỉ áp dụng cho đơn gửi sau khi cập nhật. Ngừng bán sẽ ẩn món khỏi gọi món; dữ liệu cũ vẫn được giữ.</p>
 {disabled&&!pending&&<p>Xử lý các yêu cầu chờ và gửi hoặc xóa món đang chọn trước khi sửa thực đơn.</p>}
 <button disabled={disabled||busy||!!pending||storageError} onClick={()=>start()}>Thêm món mới</button>
 {edit&&<form className="menu-edit-form" onSubmit={e=>{e.preventDefault();void save();}}><h3>{edit.version===0?'Thêm món mới':'Sửa món'}</h3><fieldset disabled={disabled||busy||!!pending||storageError}>
 <label>Tên món<input maxLength={120} required value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label>
 <label>Giá bán (đồng)<input inputMode="numeric" required value={edit.price} onChange={e=>setEdit({...edit,price:e.target.value})}/></label>
 <label htmlFor="edit-category">Nhóm món</label><select id="edit-category" value={edit.category} onChange={e=>setEdit({...edit,category:e.target.value})}>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>
 <label>Thứ tự hiển thị<input inputMode="numeric" required value={edit.sort} onChange={e=>setEdit({...edit,sort:e.target.value})}/></label>
 <label className="checkbox-label"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Đang bán</label>
 <label className="checkbox-label"><input type="checkbox" checked={edit.out} onChange={e=>setEdit({...edit,out:e.target.checked})}/>Hết món tạm thời</label>
 {!valid&&<p role="alert">Nhập tên món và giá nguyên từ 0 đến 10.000.000đ; thứ tự từ 0 đến 9999, không dấu phân cách.</p>}
 <button className="primary" disabled={!valid} type="submit">Lưu thực đơn</button></fieldset><button type="button" disabled={busy||!!pending} onClick={()=>setEdit(null)}>Đóng chỉnh sửa</button></form>}
 <div className="managed-menu-list">{items.map(i=><article key={i.id}><div><h3>{i.name}</h3><p>{i.price.toLocaleString('vi-VN')}đ · {groups.find(g=>g.id===i.category)?.name} · {!i.is_active?'Ngừng bán':i.is_out?'Hết món':'Đang bán'}</p></div><button disabled={disabled||busy||!!pending||storageError} onClick={()=>start(i)}>Sửa {i.name}</button></article>)}</div>
 {!busy&&!items.length&&!error&&<p>Chưa có món trong thực đơn.</p>}
 </>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
