import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import POSIcon from './POSIcon';
import type { TableContext } from './types';
export default function CustomerInfoChips({ value, takeaway, onSave }: {
    value: TableContext;
    takeaway: boolean;
    onSave: (value: TableContext) => void;
}) {
    const [open, setOpen] = useState(false), [draft, setDraft] = useState(value);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { if (open && !dialog.current?.open)
        dialog.current?.showModal();
    else if (!open && dialog.current?.open)
        dialog.current.close(); }, [open]);
    function edit() { setDraft(value); setOpen(true); }
    return <><div className="pos-info-chips"><button onClick={edit}><POSIcon name="person"/>{value.guests} khách</button><span><POSIcon name="bag"/>{takeaway ? 'Mang về' : 'Ăn tại chỗ'}</span><button onClick={edit}><POSIcon name="person"/>{value.customer || 'Khách lẻ'}</button><button onClick={edit}><POSIcon name="note"/>{value.note ? 'Có ghi chú' : 'Ghi chú'}</button></div>{createPortal(<dialog ref={dialog} className="pos-info-dialog" aria-label="Thông tin bàn" onCancel={() => setOpen(false)}><section className="pos-info-sheet"><header><h2>Thông tin bàn</h2><button aria-label="Đóng thông tin bàn" onClick={() => setOpen(false)}><POSIcon name="close"/></button></header><form onSubmit={e => { e.preventDefault(); onSave(draft); setOpen(false); }}><label>Số khách<input type="number" min={1} max={30} required value={draft.guests} onChange={e => setDraft({ ...draft, guests: Number(e.target.value) })}/></label><label>Tên khách<input maxLength={80} placeholder="Khách lẻ" value={draft.customer} onChange={e => setDraft({ ...draft, customer: e.target.value })}/></label><label>Ghi chú đơn<input maxLength={300} placeholder="Ghi chú cho các món chưa gửi" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })}/></label><button className="primary" type="submit">Lưu thông tin</button></form></section></dialog>, document.body)}</>;
}
