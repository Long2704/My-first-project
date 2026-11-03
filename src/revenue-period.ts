// Local wall-clock values, always interpreted in Vietnam by the reporting RPC.
// Never use the browser's timezone to convert a selected report boundary.
export function reportTimestamp(day:string,time:string):string|null{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number(day.slice(0,4))<1000)return null;
 const date=Date.parse(day+'T00:00:00Z');
 if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==day)return null;
 const match=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
 if(!match||Number(match[1])>23||Number(match[2])>59||Number(match[3]??0)>59)return null;
 return `${day}T${match[1]}:${match[2]}:${match[3]??'00'}`;
}
export function validReportPeriod(from:string|null,to:string|null):boolean{
 if(!from||!to||from>to)return false;
 const days=(Date.parse(to.slice(0,10)+'T00:00:00Z')-Date.parse(from.slice(0,10)+'T00:00:00Z'))/86400000;
 return Number.isFinite(days)&&days>=0&&days<=365;
}
export function reportPeriodLabel(value:string):string{
 const [day,time]=value.split('T');
 return day.split('-').reverse().join('/')+(time?' '+time:'');
}
