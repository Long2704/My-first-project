import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';

export default function InitialPasswordSetup({onCompleted,onBusy}:{onCompleted:()=>void;onBusy:(busy:boolean)=>void}){
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[verificationPending,setVerificationPending]=useState(false);
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onBusy(false);};},[onBusy]);
 const valid=password.length>=6&&password.length<=12&&password===confirm;

 async function verify(){
  let result;
  try{result=await supabase!.rpc('get_my_access');}
  catch{if(alive.current)setVerificationPending(true);throw new Error('Chưa xác nhận được kết quả. Bấm Kiểm tra lại, không cần nhập lại mật khẩu.');}
  if(!alive.current)return;
  if(result.error){setVerificationPending(true);throw new Error('Chưa xác nhận được kết quả. Bấm Kiểm tra lại, không cần nhập lại mật khẩu.');}
  if(!result.data||result.data.is_active!==true){onCompleted();return;}
  if(result.data.must_change_password===false){onCompleted();return;}
  setVerificationPending(false);
  throw new Error('Chưa hoàn tất thiết lập mật khẩu. Vui lòng thử lại hoặc liên hệ Chủ quán.');
 }

 async function submit(checkOnly=false){
  if(!supabase||lock.current||(!checkOnly&&!valid))return;
  lock.current=true;setBusy(true);onBusy(true);setError('');
  try{
   if(!checkOnly){
    let result;
    try{result=await supabase.auth.updateUser({password});}
    catch{if(alive.current){setPassword('');setConfirm('');setVerificationPending(true);}throw new Error('Chưa xác nhận được kết quả. Bấm Kiểm tra lại trước khi thử đổi lần nữa.');}
    if(!alive.current)return;
    if(result.error){
     const status=result.error.status;
     if(status&&status>=400&&status<500){
      throw new Error('Mật khẩu chưa được chấp nhận. Chọn mật khẩu mạnh hơn và khác mật khẩu tạm.');
     }
     setPassword('');setConfirm('');setVerificationPending(true);
     throw new Error('Chưa xác nhận được kết quả. Bấm Kiểm tra lại trước khi thử đổi lần nữa.');
    }
    setPassword('');setConfirm('');setVerificationPending(true);
   }
   await verify();
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Chưa thiết lập được mật khẩu. Vui lòng thử lại.');}
  finally{lock.current=false;if(alive.current){setBusy(false);onBusy(false);}}
 }

 return <div className="login-shell"><form className="initial-password-form" onSubmit={e=>{e.preventDefault();void submit(verificationPending);}}>
  <h2>Đặt mật khẩu riêng</h2><p>Đổi mật khẩu tạm trước khi sử dụng POS.</p>
  {!verificationPending&&<fieldset disabled={busy}>
   <label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={6} maxLength={12} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <label>Nhập lại mật khẩu<input type="password" autoComplete="new-password" minLength={6} maxLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
   <small>Từ 6 đến 12 ký tự. Không dùng lại mật khẩu tạm.</small>
   {!!confirm&&password!==confirm&&<p role="alert">Hai mật khẩu chưa khớp.</p>}
  </fieldset>}
  {error&&<p role="alert">{error}</p>}
  <button className="primary" type="submit" disabled={busy||(!verificationPending&&!valid)}>{busy?'Đang xử lý…':verificationPending?'Kiểm tra lại':'Lưu mật khẩu mới'}</button>
 </form></div>;
}
