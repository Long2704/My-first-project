import {memo} from 'react';
import POSIcon from './POSIcon';
import QuantityControl from './QuantityControl';
import type { Product } from './types';
import { formatMoney } from './types';
function ProductItem({ product, qty, disabled, note, onNote, onChange }: {
    product: Product;
    qty: number;
    disabled: boolean;
    note: string;
    onNote: (id: string, note: string) => void;
    onChange: (id: string, delta: number) => void;
}) {
    return <article className={`pos-product-row${qty ? ' is-selected' : ''}`}><span className="pos-product-art"><POSIcon name={product.category === 'do_uong' ? 'cup' : 'plate'}/>{qty > 0 && <span className="pos-product-selected"><POSIcon name="check"/></span>}</span><div className="pos-product-copy"><h2>{product.name}</h2><span>{formatMoney(product.price)}</span></div><div className="pos-product-counter">{qty > 0 ? <QuantityControl name={product.name} qty={qty} disabled={disabled} onIncrease={() => onChange(product.id,1)} onDecrease={() => onChange(product.id,-1)}/> : <button className="pos-product-add" aria-label={`Thêm ${product.name}`} disabled={disabled} onClick={() => onChange(product.id,1)}><POSIcon name="plus"/></button>}</div>{qty > 0 && <label className="pos-line-note pos-menu-note">Ghi chú món<input maxLength={500} disabled={disabled} placeholder="Ít bún, không hành…" value={note} onChange={e => onNote(product.id,e.target.value)}/></label>}</article>;
}

export default memo(ProductItem);
