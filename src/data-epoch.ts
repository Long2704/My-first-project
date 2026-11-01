// A server-issued reset generation prevents old TEST retries from resurfacing after
// the explicit one-off reset. Never clear jobs for normal refreshes or generation 0.
export function syncDataEpoch(userId:string,epoch:unknown,storage:Storage=localStorage):boolean{
 if(epoch===undefined||epoch===null)return false;
 if(typeof epoch!=='number'||!Number.isSafeInteger(epoch)||epoch<0)throw new Error('Không xác nhận được phiên dữ liệu.');
 const key=`goc-pho-data-epoch:${userId}`,old=storage.getItem(key);
 if(epoch===0){if(old===null)storage.setItem(key,'0');return false;}
 if(old!==null&&Number(old)>epoch)throw new Error('Phiên dữ liệu cũ. Tải lại ứng dụng.');
 if(old===String(epoch))return false;
 const exact=['pending','payment','transfer','bill-move','cancel-table'].map(name=>`goc-pho-${name}-v1:${userId}`);
 const prefixes=[`goc-pho-image-upload:${userId}:`,`goc-pho-table-info:${userId}:`];
 const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((value):value is string=>!!value);
 for(const name of keys)if(exact.includes(name)||prefixes.some(prefix=>name.startsWith(prefix)))storage.removeItem(name);
 storage.setItem(key,String(epoch));return true;
}
