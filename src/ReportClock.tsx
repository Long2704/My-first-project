const pad=(n:number)=>String(n).padStart(2,'0');
export default function ReportClock({label,value,onChange,disabled}:{label:string;value:string;onChange:(value:string)=>void;disabled:boolean}){
 const parts=value.split(':');
 const units=[['Giờ',24],['Phút',60],['Giây',60]] as const;
 return <fieldset className="report-clock" disabled={disabled}><legend>{label}</legend><div className="report-clock-parts">{units.map(([name,count],index)=><label key={name}><span>{name}</span><select aria-label={`${label} · ${name.toLowerCase()}`} value={parts[index]??'00'} onChange={event=>{const next=[...parts];next[index]=event.target.value;onChange(next.join(':'));}}>{Array.from({length:count},(_,n)=><option key={n} value={pad(n)}>{pad(n)}</option>)}</select></label>)}</div></fieldset>;
}
