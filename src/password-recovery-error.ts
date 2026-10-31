type RecoveryError={name?:string;code?:string;status?:number;message?:string;reasons?:string[]};
export function isRecoverySessionError(error:RecoveryError){return error.name==='AuthSessionMissingError'||['session_not_found','session_expired','bad_jwt','no_authorization','refresh_token_not_found','refresh_token_already_used','reauthentication_needed','reauthentication_not_valid'].includes(error.code??'')||error.status===401||error.status===403;}
export const uncertainPasswordChange='Chưa xác nhận được kết quả. Về đăng nhập và thử mật khẩu mới trước khi yêu cầu đặt lại lần nữa.';
export function passwordRecoveryError(error:RecoveryError):string{
 const code=error.name==='AuthSessionMissingError'?'session_not_found':typeof error.code==='string'&&/^[a-z_0-9]{1,64}$/.test(error.code)?error.code:'unknown';
 const status=typeof error.status==='number'&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:null;
 const diagnostic=` [${code}${status?`; HTTP ${status}`:''}]`;
 if(code==='same_password')return 'Mật khẩu mới đang trùng mật khẩu hiện tại. Hãy chọn một mật khẩu khác.'+diagnostic;
 if(['reauthentication_needed','reauthentication_not_valid'].includes(code))return 'Supabase yêu cầu xác thực lại. Gửi email khôi phục mới và mở liên kết mới nhất trong cửa sổ ẩn danh.'+diagnostic;
 if(['session_not_found','session_expired','bad_jwt','no_authorization','refresh_token_not_found','refresh_token_already_used'].includes(code)||status===401||status===403)return 'Phiên khôi phục đã hết hiệu lực. Gửi email khôi phục mới trong Supabase.'+diagnostic;
 if(['over_request_rate_limit','over_email_send_rate_limit'].includes(code)||status===429)return 'Đã thử quá nhiều lần. Chờ một lúc trước khi lưu lại mật khẩu.'+diagnostic;
 if(code==='weak_password'||code==='validation_failed'){
  const match=error.message?.match(/(?:at least|minimum(?: of)?)\s+(\d{1,3})\s+characters/i);
  const minimum=match?Number(match[1]):0;
  if(minimum>12&&minimum<=128)return `Supabase đang yêu cầu ít nhất ${minimum} ký tự, vượt giới hạn 12 ký tự của app. Cần điều chỉnh giới hạn cho thống nhất trước khi thử lại.`+diagnostic;
  if(minimum>=6&&minimum<=12)return `Supabase yêu cầu mật khẩu tối thiểu ${minimum} ký tự. Nhập ${minimum}–12 ký tự và xác nhận giống nhau.`+diagnostic;
  if(error.reasons?.includes('pwned'))return 'Supabase phát hiện mật khẩu này từng bị lộ. Chọn mật khẩu riêng khác, dù mật khẩu hiện tại đủ số ký tự.'+diagnostic;
  if(error.reasons?.includes('characters'))return 'Chính sách Supabase yêu cầu thêm loại ký tự. Chọn 6–12 ký tự gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'+diagnostic;
  if(code==='weak_password')return 'Mật khẩu chưa đạt chính sách bảo mật trên Supabase. Đủ 6–12 ký tự chưa chắc đáp ứng chính sách; chọn mật khẩu riêng gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'+diagnostic;
 }
 if(status&&status>=500)return uncertainPasswordChange+diagnostic;
 return 'Supabase chưa chấp nhận yêu cầu đổi mật khẩu. Gửi mã lỗi dưới đây để kiểm tra; chưa thể kết luận do độ mạnh mật khẩu.'+diagnostic;
}
