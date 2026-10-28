import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
export default function ConfirmDialog({open,title,busy,error,danger=true,confirmLabel,onConfirm,onClose,children}:{open:boolean;title:string;busy:boolean;error?:string;danger?:boolean;confirmLabel:string;onConfirm:()=>void;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 return createPortal(<dialog className="confirm-dialog" aria-label={title} ref={dialog} onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><h2>{title}</h2>{children}{error&&<p role="alert">{error}</p>}<div className="confirm-dialog-actions"><button disabled={busy} onClick={onClose}>Quay lại</button><button className={danger?'danger':'primary'} disabled={busy} onClick={onConfirm}>{busy?'Đang xử lý…':confirmLabel}</button></div></dialog>,document.body);
}
