import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
type Row={id:number;name:string};
export default function DraggableTables<T extends Row>({rows,disabled,onChange,render}:{rows:T[];disabled:boolean;onChange:(rows:T[])=>void;render:(row:T)=>ReactNode}){
 const root=useRef<HTMLDivElement>(null);
 const [dragged,setDragged]=useState<number|null>(null);
 const current=useRef(rows),change=useRef(onChange),drag=useRef<{id:number;pointer:number;before:T[];x:number;y:number}|null>(null),frame=useRef<number|null>(null);
 current.current=rows;change.current=onChange;
 function stop(rollback=false){if(rollback&&drag.current)change.current(drag.current.before);drag.current=null;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;setDragged(null);}
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 useEffect(()=>{if(disabled&&drag.current)stop(true);},[disabled]);
 function hover(x:number,y:number){
  const target=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-sort-table]');
  const id=Number(target?.dataset.sortTable),from=current.current.findIndex(t=>t.id===drag.current?.id),to=current.current.findIndex(t=>t.id===id);
  if(from<0||to<0||from===to)return;const next=[...current.current];next.splice(to,0,...next.splice(from,1));current.current=next;change.current(next);
 }
 function scroll(){const d=drag.current;if(!d)return;const offset=d.y<70?-12:d.y>innerHeight-70?12:0;if(offset){window.scrollBy(0,offset);hover(d.x,d.y);}frame.current=requestAnimationFrame(scroll);}
 return <div ref={root} className="managed-menu-list sortable-tables"
 onPointerMove={e=>{if(drag.current?.pointer!==e.pointerId)return;drag.current.x=e.clientX;drag.current.y=e.clientY;hover(e.clientX,e.clientY);}}
 onPointerUp={e=>{if(drag.current?.pointer===e.pointerId)stop();}}
 onPointerCancel={()=>stop(true)} onLostPointerCapture={e=>{if(drag.current?.pointer===e.pointerId)stop();}}>{rows.map((t,index)=><article key={t.id} data-sort-table={t.id} className={dragged===t.id?'sorting-table':''}><button className="table-drag-handle" type="button" aria-label={`Di chuyển ${t.name}`} aria-describedby="table-sort-help" disabled={disabled}
 onPointerDown={e=>{if(disabled||e.button!==0||drag.current)return;e.preventDefault();e.currentTarget.focus({preventScroll:true});root.current?.setPointerCapture(e.pointerId);drag.current={id:t.id,pointer:e.pointerId,before:[...rows],x:e.clientX,y:e.clientY};setDragged(t.id);frame.current=requestAnimationFrame(scroll);}}
 onKeyDown={e=>{if(e.key==='Escape'&&drag.current){e.preventDefault();stop(true);}else if(!disabled&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();const to=index+(e.key==='ArrowUp'?-1:1);if(to>=0&&to<rows.length){const next=[...rows];next.splice(to,0,...next.splice(index,1));onChange(next);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-sort-table="${t.id}"] .table-drag-handle`)?.focus({preventScroll:true}));}}}}><span aria-hidden="true">⠿</span></button>{render(t)}</article>)}</div>;
}
