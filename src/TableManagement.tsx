import {useEffect,useRef,useState} from 'react';
import DraggableTables from './DraggableTables';
import {supabase} from './supabase';
type Table={id:number;name:string;is_active:boolean;version:number;busy:boolean};
type OrderAttempt={requestId:string;expected:number[];ordered:number[]};
type Attempt={requestId:string;tableId:number|null;version:number;name:string;active:boolean};
export default function TableManagement({userId,active,disabled,onPending,onSaved}:{userId:string;active:boolean;disabled:boolean;onPending:(v:boolean)=>void;onSaved:()=>Promise<void>}){
 const key=`goc-pho-table-management-v1:${userId}`;
 const orderKey=`goc-pho-table-order-v1:${userId}`;
 const [baseIds,setBaseIds]=useState<number[]>([]),[orderPending,setOrderPending]=useState<OrderAttempt|null>(null);
 const [tables,setTables]=useState<Table[]>([]),[edit,setEdit]=useState<Attempt|null>(null),[pending,setPending]=useState<Attempt|null>(null),[busy,setBusy]=useState(false),[storageError,setStorageError]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const dirty=JSON.stringify(tables.map(t=>t.id))!==JSON.stringify(baseIds);
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;try{const raw=localStorage.getItem(key);if(raw){const p=JSON.parse(raw);if(!p.requestId||(p.tableId!==null&&(!Number.isInteger(p.tableId)||p.tableId<=0))||!Number.isInteger(p.version)||typeof p.name!=='string'||typeof p.active!=='boolean')throw new Error();setPending(p);setEdit(p);}}catch{setStorageError(true);}return()=>{alive.current=false;};},[key]);
 useEffect(()=>{try{const raw=localStorage.getItem(orderKey);if(raw){const p=JSON.parse(raw);if(!p.requestId||!Array.isArray(p.expected)||!Array.isArray(p.ordered)||!p.ordered.length||[...p.expected,...p.ordered].some((id:number)=>!Number.isInteger(id)||id<=0))throw new Error();setOrderPending(p);}}catch{setStorageError(true);}},[orderKey]);
 useEffect(()=>onPending(!!pending||!!orderPending||busy||storageError),[pending,orderPending,busy,storageError,onPending]);
 async function read(){const r=await supabase!.rpc('list_table_management');if(r.error)throw new Error(['PGRST202','42883'].includes(r.error.code)?'Cần chạy SQL 015_table_management.sql để dùng quản lý bàn.':'Không tải được danh sách bàn. Kiểm tra kết nối và quyền chủ quán.');if(alive.current){setTables(r.data as Table[]);setBaseIds((r.data as Table[]).map(t=>t.id));}}
 async function load(){if(!supabase||lock.current)return;lock.current=true;setBusy(true);setError('');try{await read();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Không tải được bàn.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 useEffect(()=>{if(active&&!dirty&&!orderPending)void load();},[active]);
 async function save(){
  if(!supabase||lock.current||storageError)return;let attempt=pending;
  if(!attempt){if(disabled||orderPending||dirty||!edit||!edit.name.trim()||edit.name.trim().length>80)return;attempt={...edit,name:edit.name.trim()};try{localStorage.setItem(key,JSON.stringify(attempt));}catch{setError('Không lưu được mã cập nhật bàn. Chưa gửi yêu cầu.');return;}setPending(attempt);}
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.rpc('save_restaurant_table',{p_request_id:attempt.requestId,p_table_id:attempt.tableId,p_expected_version:attempt.version,p_name:attempt.name,p_is_active:attempt.active});
   if(r.error){if(r.error.code==='P0001'&&r.error.message!=='Mã cập nhật bàn đã được sử dụng.'){localStorage.removeItem(key);if(alive.current){setPending(null);setEdit(null);}await read();throw new Error(r.error.message);}throw new Error(`Chưa xác nhận lưu bàn: ${r.error.message}. Thử lại cùng mã cập nhật bàn.`);}
   await onSaved();await read();localStorage.removeItem(key);if(alive.current){setPending(null);setEdit(null);setMessage(`Đã lưu ${attempt.name}. Danh sách bàn phục vụ đã cập nhật.`);}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa xác nhận lưu bàn. Thử lại cùng mã.');}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function saveOrder(){
  if(!supabase||lock.current||storageError)return;let attempt=orderPending;
  if(!attempt){if(disabled||edit||pending||!dirty)return;attempt={requestId:crypto.randomUUID(),expected:baseIds,ordered:tables.map(t=>t.id)};
   try{localStorage.setItem(orderKey,JSON.stringify(attempt));}catch{setError('Không lưu được mã sắp xếp. Chưa gửi yêu cầu.');return;}setOrderPending(attempt);}
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.rpc('reorder_restaurant_tables',{p_request_id:attempt.requestId,p_expected_ids:attempt.expected,p_ordered_ids:attempt.ordered});
   if(r.error){if(r.error.code==='P0001'&&r.error.message!=='Mã sắp xếp bàn đã được sử dụng.'){localStorage.removeItem(orderKey);if(alive.current)setOrderPending(null);await read();throw new Error(r.error.message);}throw new Error(['PGRST202','42883'].includes(r.error.code)?'Cần chạy SQL 016_table_order.sql rồi thử lại cùng mã sắp xếp.':`Chưa xác nhận thứ tự bàn: ${r.error.message}. Thử lại cùng mã sắp xếp.`);}
   await onSaved();await read();localStorage.removeItem(orderKey);if(alive.current){setOrderPending(null);setMessage('Đã lưu thứ tự bàn. Màn hình Phục vụ đã cập nhật.');}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa xác nhận thứ tự bàn. Thử lại cùng mã.');}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function start(t?:Table){setError('');setMessage('');setEdit({requestId:crypto.randomUUID(),tableId:t?.id??null,version:t?.version??0,name:t?.name??'',active:t?.is_active??true});}
 return <section className="table-management" aria-label="Quản lý bàn"><div className="panel-heading"><div><h2>Danh sách bàn</h2><p>Thêm bàn, đổi tên hoặc ngừng sử dụng. Bàn đang có khách hay còn món bếp chưa xong cần xử lý xong trước khi sửa.</p></div><button disabled={busy||dirty||!!orderPending} onClick={()=>void load()}>Tải lại bàn</button></div>
 {storageError&&<p role="alert">Không đọc được cập nhật bàn chờ. Không xóa dữ liệu trình duyệt; liên hệ hỗ trợ.</p>}
 {pending&&<aside role="status"><strong>Cập nhật bàn chờ xác nhận: {pending.name}</strong><p>Thử lại cùng mã để tránh thêm bàn trùng.</p><button disabled={busy} onClick={()=>void save()}>Thử lại cùng mã cập nhật bàn</button></aside>}
 <button className="primary" disabled={disabled||busy||dirty||!!orderPending||!!pending||storageError} onClick={()=>start()}>Thêm bàn</button>
 {disabled&&!pending&&<p>Gửi hoặc xóa các món đang chọn và xử lý yêu cầu chờ trước khi quản lý bàn.</p>}
 {edit&&<form className="table-edit-form" onSubmit={e=>{e.preventDefault();void save();}}><h3>{edit.tableId===null?'Thêm bàn':'Sửa bàn'}</h3><fieldset disabled={disabled||busy||dirty||!!orderPending||!!pending||storageError}><label>Tên bàn<input required maxLength={80} placeholder="Ví dụ: Bàn 14, Sân trước" value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label className="checkbox-label"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Đang sử dụng</label><button type="submit" className="primary" disabled={!edit.name.trim()}>Lưu bàn</button></fieldset><button type="button" disabled={busy||!!pending} onClick={()=>setEdit(null)}>Đóng sửa bàn</button></form>}
 <p id="table-sort-help">Kéo nút ⠿ cạnh tên bàn, rồi bấm Lưu thứ tự bàn. Có thể dùng phím ↑ / ↓ trên nút kéo. Bàn đang có khách vẫn sắp xếp được.</p>
 {orderPending&&<aside role="status"><strong>Thứ tự bàn chờ xác nhận.</strong><button disabled={busy} onClick={()=>void saveOrder()}>Thử lại cùng mã sắp xếp</button></aside>}
 <div className="table-order-controls" role="status"><span>{dirty?'Thứ tự mới chưa lưu.':'Thứ tự đã lưu.'}</span><button className="primary" disabled={!dirty||!!orderPending||disabled||busy||!!pending||!!edit||storageError} onClick={()=>void saveOrder()}>Lưu thứ tự bàn</button><button disabled={!dirty||busy||!!pending||!!orderPending} onClick={()=>void load()}>Hủy sắp xếp</button></div>
 <DraggableTables rows={tables} disabled={disabled||busy||!!pending||!!orderPending||storageError||!!edit} onChange={next=>{setTables(next);setError('');setMessage('');}} render={t=><><div className="sortable-table-name"><h3>{t.name}</h3><p>{!t.is_active?'Ngừng sử dụng':t.busy?'Đang phục vụ / bếp chưa xong':'Đang sử dụng · Trống'}</p></div><button disabled={disabled||busy||dirty||!!pending||!!orderPending||storageError||t.busy} onClick={()=>start(t)}>Sửa {t.name}</button></>}/>

 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</section>;
}
