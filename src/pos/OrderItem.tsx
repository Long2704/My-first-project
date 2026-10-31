import { useRef, useState } from 'react';
import POSIcon from './POSIcon';
import QuantityControl from './QuantityControl';
import type { DraftLine } from './types';
import { formatMoney } from './types';
export default function OrderItem({ line, disabled, onChange, onNote, onRemove }: {
    line: DraftLine;
    disabled: boolean;
    onChange: (delta: number) => void;
    onNote: (note: string) => void;
    onRemove: () => void;
}) {
    const [actions, setActions] = useState(false);
    const noteInput = useRef<HTMLInputElement>(null);
    return <article className="pos-draft-row"><span className="pos-order-art"><POSIcon name={line.product.category === 'do_uong' ? 'cup' : 'plate'}/></span><div className="pos-order-item-body"><div className="pos-order-item-heading"><h2>{line.product.name}</h2><button className="pos-line-more" aria-label={`Thao tác ${line.product.name}`} aria-expanded={actions} onClick={() => setActions(v => !v)}><POSIcon name="more"/></button></div>{actions && <div className="pos-line-actions"><button onClick={() => { noteInput.current?.focus(); setActions(false); }}>Ghi chú món</button><button disabled={disabled} className="pos-text-danger" onClick={() => { setActions(false); onRemove(); }}>Xóa món</button></div>}<div className="pos-order-item-bottom"><strong>{formatMoney(line.product.price * line.qty)}</strong><QuantityControl name={line.product.name} qty={line.qty} disabled={disabled} increaseDisabled={line.product.is_out} onIncrease={() => onChange(1)} onDecrease={() => onChange(-1)}/></div>{<label className="pos-line-note">Ghi chú món<input ref={noteInput} maxLength={500} disabled={disabled} placeholder="Ít bún, không hành…" value={line.note} onChange={e => onNote(e.target.value)}/></label>}</div></article>;
}
