export type RevenueDay={day:string;invoices:number;gross:number;discount:number;total:number;cash:number;transfer:number};
export type RevenueReport={from:string;to:string;generated_at:string;invoices:number;gross:number;discount:number;total:number;cash:number;transfer:number;days:RevenueDay[];products:{name:string;qty:number;gross:number}[]};
type Cell=string|number;
// BOM preserves Vietnamese in Excel. Quote fields and neutralize spreadsheet formulas in text.
export function csv(rows:Cell[][]){
 return '\uFEFF'+rows.map(row=>row.map(value=>{
  let text=String(value);
  if(typeof value==='string'&&(/^[\s\u0000-\u001f]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n')+'\r\n';
}
export function revenueExport(report:RevenueReport,kind:'revenue'|'products'){
 const stamp=new Date(report.generated_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
 const meta=[report.from,report.to,stamp];
 if(kind==='products')return {
  filename:`goc-pho-top-20-mon_${report.from}_${report.to}.csv`,
  content:csv([
   ['Món (tối đa 20 món bán nhiều nhất)','Số lượng','Tiền món trước giảm giá hóa đơn (VND)','Từ ngày','Đến ngày','Cập nhật (giờ Việt Nam)'],
   ...report.products.map(p=>[p.name,p.qty,p.gross,...meta])
  ])
 };
 const amounts=(r:Pick<RevenueDay,'invoices'|'gross'|'discount'|'total'|'cash'|'transfer'>)=>[r.invoices,r.gross,r.discount,r.total,r.cash,r.transfer];
 return {
  filename:`goc-pho-doanh-thu_${report.from}_${report.to}.csv`,
  content:csv([
   ['Loại dòng','Ngày thanh toán (giờ Việt Nam)','Số hóa đơn','Trước giảm giá (VND)','Giảm giá (VND)','Thực thu (VND)','Tiền mặt (VND)','Chuyển khoản (VND)','Từ ngày','Đến ngày','Cập nhật (giờ Việt Nam)'],
   ...report.days.map(d=>['Theo ngày',d.day,...amounts(d),...meta]),
   ['Tổng cộng','',...amounts(report),...meta]
  ])
 };
}
export function downloadCsv(file:{filename:string;content:string}){
 const url=URL.createObjectURL(new Blob([file.content],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 try{link.href=url;link.download=file.filename;link.hidden=true;document.body.append(link);link.click();}
 finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
