import type {RevenueReport,RevenueSlot} from './revenue-export';
type Cell=string|number;
const xml=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const enc=new TextEncoder();
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
// OOXML ZIP with stored entries: small reports need no runtime dependency or CDN.
function zip(files:[string,string][]):Uint8Array{
 const chunks:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
 for(const [name,content] of files){const n=enc.encode(name),data=enc.encode(content),sum=crc(data),header=new Uint8Array(30+n.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,sum,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,n.length,true);header.set(n,30);chunks.push(header,data);
  const c=new Uint8Array(46+n.length),v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);v.setUint32(16,sum,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);c.set(n,46);central.push(c);offset+=header.length+data.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer),size=central.reduce((n,b)=>n+b.length,0);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
 const out=new Uint8Array(offset+size+22);let at=0;for(const b of [...chunks,...central,end]){out.set(b,at);at+=b.length;}return out;
}
function column(n:number):string{let s='';for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function worksheet(rows:Cell[][]):string{
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="23" customWidth="1"/><col min="2" max="2" width="23" customWidth="1"/><col min="3" max="12" width="19" customWidth="1"/></cols><sheetData>'+rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((cell,c)=>{const ref=column(c)+(r+1),style=r===0?1:typeof cell==='number'?2:0;if(typeof cell==='number'){if(!Number.isSafeInteger(cell))throw Error('Số tiền không hợp lệ');return `<c r="${ref}" s="${style}" t="n"><v>${cell}</v></c>`;}return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;}).join('')+'</row>').join('')+'</sheetData></worksheet>';
}
export function revenueWorkbook(report:RevenueReport):{filename:string;bytes:Uint8Array}{
 if(!report.slots_complete||!report.slots?.length)throw Error('Thiếu dữ liệu theo khung giờ');
 const slots=report.slots,keys=['invoices','gross','discount','total','cash','transfer'] as const;
 for(const key of keys)if(slots.reduce((n,s)=>n+s[key],0)!==report[key])throw Error('Tổng khung giờ không khớp báo cáo');
 const amounts=(s:Pick<RevenueSlot,typeof keys[number]>)=>keys.map(k=>s[k]);
 const headers=['Số hóa đơn','Trước giảm giá (VND)','Giảm giá (VND)','Thực thu (VND)','Tiền mặt (VND)','Chuyển khoản (VND)'];
 const totals=Array.from({length:7},(_,i)=>{const rows=slots.filter(s=>s.slot_index===i+1);return {slot:rows[0]?.slot??'',...Object.fromEntries(keys.map(k=>[k,rows.reduce((n,s)=>n+s[k],0)]))} as RevenueSlot;});
 const sheets:{name:string;rows:Cell[][]}[]=[
  {name:'Theo ngày và khung',rows:[['Ngày (Việt Nam)','Khung giờ',...headers],...slots.map(s=>[s.day,s.slot,...amounts(s)]),['TỔNG CỘNG','',...amounts(report)]]},
  {name:'Tổng theo khung',rows:[['Khung giờ',...headers],...totals.map(s=>[s.slot,...amounts(s)]),['TỔNG CỘNG',...amounts(report)]]},
  {name:'Tổng theo ngày',rows:[['Ngày (Việt Nam)',...headers],...report.days.map(s=>[s.day,...amounts(s)]),['TỔNG CỘNG',...amounts(report)]]},
  {name:'Món ăn',rows:[['Tên món','Số lượng','Tiền trước giảm giá (VND)'],...report.products.map(p=>[p.name,p.qty,p.gross])]},
  {name:'Thông tin',rows:[['Nội dung','Giá trị'],['Từ ngày giờ (Việt Nam)',report.from],['Đến ngày giờ (Việt Nam)',report.to],['Múi giờ','Asia/Ho_Chi_Minh'],['Thời điểm tính','Thời điểm thanh toán'],['Quy tắc','06–09 gồm 06:00:00 đến trước 09:00:00; các khung tiếp theo tương tự.'],['Ngoài khung','Trước 06:00:00 hoặc từ 22:00:00; giữ để tổng tiền không bị thiếu.'],['Khoảng lọc','Chỉ tính phần giao giữa khung giờ và khoảng lọc đã chọn; bao gồm cả giây kết thúc.'],['Cập nhật',new Date(report.generated_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})]]}
 ];
 const prefix='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const files:[string,string][]=[
  ['[Content_Types].xml',prefix+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'],
  ['_rels/.rels',prefix+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',prefix+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels',prefix+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
  ['xl/styles.xml',prefix+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,worksheet(s.rows)] as [string,string])
 ];
 return {filename:`goc-pho-khung-gio_${report.from.replaceAll(':','-')}_${report.to.replaceAll(':','-')}.xlsx`,bytes:zip(files)};
}
export async function downloadRevenueWorkbook(report:RevenueReport){
 const file=revenueWorkbook(report),url=URL.createObjectURL(new Blob([new Uint8Array(file.bytes).buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');try{a.href=url;a.download=file.filename;document.body.append(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
