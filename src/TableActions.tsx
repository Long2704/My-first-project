import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import PosIcon from './PosIcon';
export default function TableActions({visible,active,pending,title,children,label="Thao tác bàn"}:{visible:boolean;active:boolean;pending:boolean;title:string;children:ReactNode;label?:string}){
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(pending)setOpen(true);else if(!visible)setOpen(false);},[pending,visible]);
 useEffect(()=>{if(open&&active&&visible){if(!dialog.current?.open)dialog.current?.showModal();}else dialog.current?.close();},[open,active,visible]);
 return <><button className="table-actions-trigger" hidden={!visible} aria-label={label} title={label} onClick={()=>setOpen(true)}><PosIcon name="actions"/><span className="visually-hidden">{label}</span></button>{createPortal(<dialog ref={dialog} className="table-actions-dialog" aria-label={`${label} · ${title}`} onCancel={()=>setOpen(false)}><header><div><small>{title}</small><h2>{label}</h2></div><button aria-label={`Đóng ${label.toLocaleLowerCase('vi-VN')}`} onClick={()=>setOpen(false)}>×</button></header><div className="table-operations">{children}</div></dialog>,document.body)}</>;
}
