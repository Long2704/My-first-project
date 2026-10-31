import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';

const marker='goc-pho-password-recovery-user';
const callback=new URLSearchParams(window.location.hash.slice(1));
export const recoveryCallback=callback.get('type')==='recovery'||callback.has('error_code');
export function recoveryUser(){try{return sessionStorage.getItem(marker);}catch{return null;}}
export function rememberRecovery(userId:string|null){try{if(userId)sessionStorage.setItem(marker,userId);else sessionStorage.removeItem(marker);}catch{/* The current page can still complete recovery. */}}

export default function PasswordRecovery({hasSession,onExit}:{hasSession:boolean;onExit:()=>Promise<void>}){
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const valid=password.length>=6&&password.length<=12&&password===confirm;
 async function save(){
  if(lock.current||!valid||!hasSession||!supabase)return;
  if(!navigator.onLine){setError('Kết nối mạng trước khi lưu mật khẩu mới.');return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const result=await supabase.auth.updateUser({password});
   if(result.error){
    if(result.error.status===401||result.error.status===403)throw new Error('Phiên khôi phục đã hết hiệu lực. Gửi email khôi phục mới trong Supabase.');
    if(result.error.status&&result.error.status>=400&&result.error.status<500)throw new Error('Mật khẩu chưa được chấp nhận. Chọn mật khẩu mạnh hơn, khác mật khẩu cũ, từ 6 đến 12 ký tự.');
    throw new Error('Chưa xác nhận được kết quả. Về đăng nhập và thử mật khẩu mới trước khi yêu cầu đặt lại lần nữa.');
   }
   if(alive.current){setSaved(true);setPassword('');setConfirm('');}
  }catch(e){if(alive.current){setPassword('');setConfirm('');setError(e instanceof Error&&(e.message.startsWith('Mật khẩu')||e.message.startsWith('Phiên'))?e.message:'Chưa xác nhận được kết quả. Về đăng nhập và thử mật khẩu mới trước khi yêu cầu đặt lại lần nữa.');}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function exit(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{await onExit();}catch{if(alive.current)setError('Chưa thoát được phiên khôi phục. Kiểm tra kết nối rồi thử lại.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <div className="login-shell"><form className="initial-password-form" onSubmit={event=>{event.preventDefault();void save();}}>
  <h2>{saved?'Đã đổi mật khẩu':'Đặt lại mật khẩu'}</h2>
  {saved?<p>Mật khẩu mới đã được lưu. Về đăng nhập để sử dụng POS. Tên đăng nhập Owner vẫn là owner.</p>:!hasSession?<p role="alert">Liên kết khôi phục không hợp lệ hoặc đã hết hạn. Trong Supabase, gửi email khôi phục mới và mở liên kết mới nhất.</p>:<><p>Nhập mật khẩu mới cho tài khoản nhận email khôi phục.</p><fieldset disabled={busy}>
   <label>Mật khẩu mới<input type="password" autoComplete="new-password" minLength={6} maxLength={12} required value={password} onChange={event=>setPassword(event.target.value)}/></label>
   <label>Nhập lại mật khẩu<input type="password" autoComplete="new-password" minLength={6} maxLength={12} required value={confirm} onChange={event=>setConfirm(event.target.value)}/></label>
   <small>Từ 6 đến 12 ký tự. Chọn mật khẩu riêng và không chia sẻ cho nhân viên.</small>
   {!!confirm&&password!==confirm&&<p role="alert">Hai mật khẩu chưa khớp.</p>}
  </fieldset></>}
  {error&&<p role="alert">{error}</p>}
  {!saved&&hasSession&&<button className="primary" type="submit" disabled={busy||!valid}>{busy?'Đang lưu…':'Lưu mật khẩu mới'}</button>}
  <button type="button" disabled={busy} className={saved?'primary':''} onClick={()=>void exit()}>Về đăng nhập</button>
 </form></div>;
}
