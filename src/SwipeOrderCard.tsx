import {useRef,useState} from 'react';
import type {PointerEvent,ReactNode} from 'react';
export default function SwipeOrderCard({disabled,className,onComplete,children}:{disabled:boolean;className:string;onComplete:()=>Promise<void>;children:ReactNode}){
 const [offset,setOffset]=useState(0),[dragging,setDragging]=useState(false);
 const gesture=useRef<{id:number;x:number;y:number;horizontal:boolean}|null>(null),lock=useRef(false),width=useRef(300);
 const threshold=()=>Math.min(150,Math.max(85,width.current*.3));
 function down(e:PointerEvent<HTMLElement>){
  if(disabled||lock.current||e.button!==0||(e.target as HTMLElement).closest('button,a,input,select,textarea,summary'))return;
  width.current=e.currentTarget.getBoundingClientRect().width;gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,horizontal:false};
 }
 function move(e:PointerEvent<HTMLElement>){
  const g=gesture.current;if(!g||g.id!==e.pointerId||disabled)return;
  const dx=e.clientX-g.x,dy=e.clientY-g.y;
  if(!g.horizontal&&Math.abs(dy)>15&&Math.abs(dy)>Math.abs(dx)){gesture.current=null;setOffset(0);return;}
  if(!g.horizontal&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.4){g.horizontal=true;try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}setDragging(true);}
  if(g.horizontal)setOffset(Math.max(-170,Math.min(170,dx)));
 }
 function reset(){gesture.current=null;setOffset(0);setDragging(false);}
 function up(e:PointerEvent<HTMLElement>){
  const g=gesture.current;const complete=!!g&&g.id===e.pointerId&&g.horizontal&&Math.abs(e.clientX-g.x)>=threshold()&&Math.abs(e.clientX-g.x)>Math.abs(e.clientY-g.y)*1.4;
  reset();if(!complete||disabled||lock.current)return;lock.current=true;void onComplete().finally(()=>{lock.current=false;});
 }
 return <div className={`swipe-order ${!disabled?'can-swipe':''} ${dragging?'is-dragging':''}`}><div className="swipe-order-backdrop" style={{justifyItems:offset<0?'end':'start'}} aria-hidden="true">{Math.abs(offset)>=threshold()?'Thả để hoàn thành':'Vuốt ngang để hoàn thành'}</div><article className={className} style={{transform:`translateX(${offset}px)`}} onDragStart={e=>e.preventDefault()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={reset}>{children}</article></div>;
}
