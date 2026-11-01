import {useEffect,useRef,useState} from 'react';
import type {PrivateImages} from './private-images';
export default function PrivateImage({path,cache,full=false,ratio=1}:{path:string;cache:PrivateImages;full?:boolean;ratio?:number}){
 const ref=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(full),[src,setSrc]=useState(''),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(full||!ref.current)return;const observer=new IntersectionObserver(entries=>{setVisible(entries.some(e=>e.isIntersecting));},{rootMargin:'200px'});observer.observe(ref.current);return()=>observer.disconnect();},[full]);
 useEffect(()=>{
  if(!visible){setSrc('');return;}let alive=true;setError(false);setSrc('');const lease=cache.acquire(path);
  void lease.promise.then(url=>{if(alive)setSrc(url);}).catch(()=>{if(alive)setError(true);});
  return()=>{alive=false;lease.release();};
 },[cache,path,visible,retry]);
 return <div className={`kitchen-private-image${full?' full-image':''}`} ref={ref} style={full?undefined:{aspectRatio:String(ratio),maxHeight:480}}>{src?<img src={src} alt="Nội dung phiếu ảnh bếp" draggable={false}/>:error?<><span>Chưa tải được ảnh.</span><button onClick={()=>setRetry(n=>n+1)}>Thử tải lại ảnh</button></>:<span role="status">{visible?'Đang tải ảnh…':'Ảnh xem trước'}</span>}</div>;
}
