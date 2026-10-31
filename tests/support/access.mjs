// Kỳ vọng UI độc lập với SQL; kiểm thử SQL kiểm chứng cùng ma trận quyền.
export function mockAccess({name,role,is_active=true}) {
 const service=['orders.read','orders.create','payments.collect','tables.transfer','tables.cancel','bills.split','receipts.read_own'];
 const owner=[...service,'orders.cancel','payments.discount','kitchen.complete','menu.manage','tables.manage','reports.read','audit.read','employees.manage','settings.manage','receipts.read_all'];
 return {name,role,is_active,permissions:!is_active?[]:role==='chu'?owner:role==='bep'?[...service,'kitchen.complete']:role==='phuc_vu'?service:[]};
}
