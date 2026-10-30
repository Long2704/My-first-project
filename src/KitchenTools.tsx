import {useCallback,useEffect,useRef,useState} from 'react';
import PosIcon from './PosIcon';
type Props={orders:{id:string}[];ready:boolean;onFreshChange:(ids:string[])=>void;onShowQueue:()=>void};
const audioConstructor=()=>window.AudioContext??(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
export default function KitchenTools({orders,ready,onFreshChange,onShowQueue}:Props){
 const [fresh,setFresh]=useState<string[]>([]),[sound,setSound]=useState(false),[audioBusy,setAudioBusy]=useState(false),[soundError,setSoundError]=useState('');
 const [visible,setVisible]=useState(()=>document.visibilityState==='visible');
 const known=useRef(new Set<string>()),initialized=useRef(false),audio=useRef<AudioContext|null>(null),soundEnabled=useRef(false),audioLock=useRef(false),alive=useRef(true);
 const soundSupported=!!audioConstructor();
 const chime=useCallback(()=>{
  const context=audio.current;
  if(!context||context.state!=='running'){
   soundEnabled.current=false;setSound(false);setSoundError('Chuông đang tạm dừng. Bấm Bật chuông đơn mới để kích hoạt lại.');return;
  }
  try{
   [880,660].forEach((frequency,index)=>{
    const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*0.18;
    oscillator.type='sine';oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(0.18,start+0.015);gain.gain.exponentialRampToValueAtTime(0.001,start+0.14);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+0.15);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
   });
  }catch{soundEnabled.current=false;setSound(false);setSoundError('Chưa phát được chuông. Kiểm tra âm lượng rồi bật lại.');}
 },[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;soundEnabled.current=false;if(audio.current){void audio.current.close().catch(()=>{});audio.current=null;}};},[]);
 useEffect(()=>{
  const change=()=>setVisible(document.visibilityState==='visible');
  document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);
 },[]);
 useEffect(()=>{
  if(!ready)return;
  const current=new Set(orders.map(o=>o.id));
  if(!initialized.current){known.current=current;initialized.current=true;return;}
  const incoming=[...current].filter(id=>!known.current.has(id));
  incoming.forEach(id=>known.current.add(id));
  setFresh(old=>{const kept=old.filter(id=>current.has(id));return incoming.length||kept.length!==old.length?[...kept,...incoming]:old;});
  if(incoming.length&&soundEnabled.current&&document.visibilityState==='visible')chime();
 },[orders,ready,chime]);
 useEffect(()=>{onFreshChange(fresh);},[fresh,onFreshChange]);
 useEffect(()=>{
  if(visible&&soundEnabled.current&&audio.current?.state==='suspended'){
   void audio.current.resume().then(()=>{if(alive.current&&audio.current?.state!=='running'){soundEnabled.current=false;setSound(false);setSoundError('Bấm Bật chuông đơn mới để kích hoạt lại âm thanh.');}}).catch(()=>{if(alive.current){soundEnabled.current=false;setSound(false);setSoundError('Bấm Bật chuông đơn mới để kích hoạt lại âm thanh.');}});
  }
 },[visible]);
 async function enableSound(){
  if(audioLock.current||!soundSupported)return;audioLock.current=true;setAudioBusy(true);setSoundError('');
  try{
   const Audio=audioConstructor()!;
   if(!audio.current||audio.current.state==='closed')audio.current=new Audio();
   await audio.current.resume();
   if(!alive.current)return;
   if(audio.current.state!=='running')throw new Error();
   soundEnabled.current=true;setSound(true);chime();
  }catch{if(alive.current){soundEnabled.current=false;setSound(false);setSoundError('Chưa bật được chuông. Kiểm tra âm lượng và thử lại.');}}
  finally{audioLock.current=false;if(alive.current)setAudioBusy(false);}
 }
 function mute(){soundEnabled.current=false;setSound(false);setSoundError('');if(audio.current?.state==='running')void audio.current.suspend().catch(()=>{});}
 const soundLabel=audioBusy?'Đang bật chuông…':sound?'Tắt chuông đơn mới':'Bật chuông đơn mới';
 const soundHint=!soundSupported?'Thiết bị chưa hỗ trợ chuông trong trình duyệt.':soundError||soundLabel;
 return <div className="kitchen-tools" role="group" aria-label="Tiện ích bếp">
  <button className={`kitchen-bell${soundError?' has-error':''}`} disabled={!soundSupported||audioBusy}
   aria-label={soundLabel} title={soundHint} aria-pressed={sound} aria-busy={audioBusy}
   onClick={()=>sound?mute():void enableSound()}>
   <PosIcon name={sound?'bell':'bellOff'}/>
  </button>
  {!!fresh.length&&<div className="new-kitchen-alert" role="status">
   <button className="kitchen-fresh-count" aria-label={`Có ${fresh.length} đơn bếp mới chưa xem`} title="Xem đơn đang làm" onClick={onShowQueue}>
    <strong>{fresh.length}</strong> mới
   </button>
   <button className="kitchen-acknowledge" aria-label="Đánh dấu đã xem" title="Đánh dấu đã xem" onClick={()=>setFresh([])}><PosIcon name="check"/></button>
  </div>}
  <span className="visually-hidden" role="status">{!soundSupported?'Thiết bị chưa hỗ trợ chuông trong trình duyệt.':sound?'Đã bật âm thanh đơn mới.':'Đã tắt âm thanh đơn mới.'}</span>
  {soundError&&<span className="kitchen-sound-error" role="alert">{soundError}</span>}
 </div>;
}
