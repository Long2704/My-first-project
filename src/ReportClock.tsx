import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
const pad=(n:number)=>String(n).padStart(2,'0');
export default function ReportClock({label,value,onChange,disabled}:{label:string;value:string;onChange:(value:string)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(value);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 const units=[['Giờ',24],['Phút',60],['Giây',60]] as const;
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();if(!open&&dialog.current?.open){dialog.current.close();trigger.current?.focus();}},[open]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 function close(){setOpen(false);}
 return <div className="report-clock"><span id={id} className="report-clock-label">{label}</span><button ref={trigger} type="button" className="report-clock-trigger" aria-label={label} aria-labelledby={`${id} ${id}-value`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{setDraft(value);setOpen(true);}}><span id={`${id}-value`}>{value}</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button>
 {createPortal(<dialog ref={dialog} className="report-clock-dialog" aria-label={`Chọn ${label.toLowerCase()}`} onCancel={event=>{event.preventDefault();close();}} onClose={close} onClick={event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}}><h2>Chọn {label.toLowerCase()}</h2><output className="report-clock-preview" aria-live="polite">{draft}</output><div className="report-clock-parts">{units.map(([name,count],index)=><label key={name}><span>{name}</span><select aria-label={`${label} · ${name.toLowerCase()}`} value={draft.split(':')[index]??'00'} onChange={event=>{const next=draft.split(':');next[index]=event.target.value;setDraft(next.join(':'));}}>{Array.from({length:count},(_,n)=><option key={n} value={pad(n)}>{pad(n)}</option>)}</select></label>)}</div><div className="report-clock-actions"><button type="button" onClick={close}>Hủy</button><button type="button" className="primary" onClick={()=>{onChange(draft);close();}}>Áp dụng</button></div></dialog>,document.body)}
 </div>;
}
