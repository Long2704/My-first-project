import {useEffect,useRef} from 'react';
import type {PrivateImages} from './private-images';
import PrivateImage from './PrivateImage';
export default function KitchenImageZoom({path,cache,onClose}:{path:string;cache:PrivateImages;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;const previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="kitchen-image-zoom" aria-label="Xem phiếu ảnh" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><button autoFocus className="image-zoom-close" onClick={onClose}>Đóng ảnh</button><PrivateImage path={path} cache={cache} full/></dialog>;
}
