export type ImageTicket={id:string;request_id:string;image_path:string;preview_path:string;status:'cooking'|'done';created_at:string;created_by:string;completed_at:string|null;completed_by:string|null;width:number;height:number};
export const imageTicketFields='id,request_id,image_path,preview_path,status,created_at,created_by,completed_at,completed_by,width,height';
