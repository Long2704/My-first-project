// Public immutable library asset only. No user data, JWT or API key is sent to the CDN.
export const WASM_URL='https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.45/dist/x86/magick.wasm';
export const WASM_SIZE=15425791;
export const WASM_SHA256='54629cbcf06dd10db38b4d87fa6ab241b248c09c94f2d9689506e5f994ac5f0c';
export async function loadVerifiedWasm(fetcher:typeof fetch=fetch):Promise<Uint8Array<ArrayBuffer>>{
 const response=await fetcher(WASM_URL,{signal:AbortSignal.timeout(20000),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
 if(!response.ok||!response.body)throw new Error('Không tải được bộ xử lý ảnh. Giữ ảnh để thử lại sau.');
 const bytes=new Uint8Array(WASM_SIZE),reader=response.body.getReader();let offset=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   if(value.length>WASM_SIZE-offset)throw new Error('Bộ xử lý ảnh có dung lượng không hợp lệ.');
   bytes.set(value,offset);offset+=value.length;
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(offset!==WASM_SIZE)throw new Error('Bộ xử lý ảnh tải chưa đủ.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!==WASM_SHA256)throw new Error('Bộ xử lý ảnh không khớp phiên bản đã duyệt.');
 return bytes;
}
