import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import './pwa.css';

type InstallEvent = Event & {
 prompt: () => Promise<void>;
 userChoice: Promise<{outcome: 'accepted'|'dismissed'}>;
};
const production = (import.meta as ImportMeta & {env: {PROD: boolean}}).env.PROD;

export function useOnline(){
 const [online,setOnline]=useState(navigator.onLine);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 return online;
}
export function OfflineNotice({online}:{online:boolean}){
 return online?null:<aside className="pwa-offline" role="status">Mất kết nối. Kết nối mạng để gửi món, cập nhật bếp và thanh toán.</aside>;
}
export default function PWAControls(){
 const [standalone,setStandalone]=useState(()=>matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?:boolean}).standalone===true);
 const [dismissed,setDismissed]=useState(()=>{try{return sessionStorage.getItem('goc-pho-install-dismissed')==='1';}catch{return false;}});
 const [install,setInstall]=useState<InstallEvent|null>(null),[help,setHelp]=useState(false),[waiting,setWaiting]=useState(false),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(help&&!dialog.current?.open)dialog.current?.showModal();if(!help&&dialog.current?.open)dialog.current.close();},[help]);
 useEffect(()=>{
  const mode=matchMedia('(display-mode: standalone)');
  const modeChanged=()=>setStandalone(mode.matches || (navigator as Navigator & {standalone?:boolean}).standalone===true);
  const ready=(event:Event)=>{event.preventDefault();setInstall(event as InstallEvent);};
  const installed=()=>{setStandalone(true);setInstall(null);setHelp(false);};
  mode.addEventListener('change',modeChanged);window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',installed);
  return()=>{mode.removeEventListener('change',modeChanged);window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',installed);};
 },[]);
 useEffect(()=>{
  if(!production || !window.isSecureContext || !('serviceWorker' in navigator))return;
  let active=true,registration:ServiceWorkerRegistration|undefined,lastCheck=0;
  const workers=new Set<ServiceWorker>();
  const checkWaiting=()=>{if(active)setWaiting(!!registration?.waiting);};
  const stateChanged=()=>checkWaiting();
  const found=()=>{const worker=registration?.installing;if(worker){workers.add(worker);worker.addEventListener('statechange',stateChanged);}checkWaiting();};
  const check=()=>{if(!registration||!navigator.onLine||document.visibilityState==='hidden'||Date.now()-lastCheck<60000)return;lastCheck=Date.now();void registration.update().catch(()=>{/* Retry on the next focus/online event. */});};
  void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(value=>{
   if(!active)return;registration=value;registration.addEventListener('updatefound',found);found();checkWaiting();check();
  }).catch(()=>{/* POS remains usable online when installation is unavailable. */});
  window.addEventListener('focus',check);window.addEventListener('online',check);
  const timer=window.setInterval(check,5*60000);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('online',check);registration?.removeEventListener('updatefound',found);workers.forEach(worker=>worker.removeEventListener('statechange',stateChanged));};
 },[]);
 async function installApp(){
  if(!install){setHelp(true);return;}
  setBusy(true);
  try{await install.prompt();await install.userChoice;setInstall(null);}catch{setHelp(true);}finally{setBusy(false);}
 }
 return <><div className="pwa-controls">
 {waiting&&<aside className="pwa-update" role="status"><strong>Có bản cập nhật mới</strong><span>Hoàn tất và xác nhận các thao tác đang chờ, sau đó đóng tất cả cửa sổ POS và mở lại để cập nhật. Món chưa gửi cần gửi hoặc chọn lại trước khi đóng.</span></aside>}
 {!standalone&&!dismissed&&<aside className="pwa-install"><img src="/icons/icon-192.png" alt="" width={40} height={40}/><span><strong>Góc Phố POS</strong><small>Mở nhanh từ màn hình chính</small></span><button disabled={busy} onClick={()=>void installApp()}>Cài app</button><button className="pwa-dismiss" aria-label="Ẩn gợi ý cài app" onClick={()=>{setDismissed(true);try{sessionStorage.setItem('goc-pho-install-dismissed','1');}catch{/* Session-only dismissal still works. */}}}>×</button></aside>}
 </div>{createPortal(<dialog ref={dialog} className="confirm-dialog pwa-help" aria-label="Cài POS ra màn hình chính" onCancel={()=>setHelp(false)}><h2>Cài POS ra màn hình chính</h2><p><strong>iPhone / iPad:</strong> mở app bằng Safari, nhấn Chia sẻ, chọn Thêm vào Màn hình chính rồi nhấn Thêm.</p><p><strong>Android:</strong> mở bằng Chrome, nhấn ⋮, chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính.</p><p><strong>Máy tính:</strong> trong Chrome hoặc Edge, chọn biểu tượng cài ứng dụng ở thanh địa chỉ hoặc mục cài ứng dụng trong menu trình duyệt.</p><p>App cần mạng để gọi món, cập nhật bếp và thanh toán.</p><button className="primary" onClick={()=>setHelp(false)}>Đã hiểu</button></dialog>,document.body)}</>;
}
