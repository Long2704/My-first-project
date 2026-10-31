import POSIcon from './POSIcon';
import QuantityControl from './QuantityControl';
import type { Product } from './types';
import { formatMoney } from './types';
export default function ProductItem({ product, qty, disabled, onChange }: {
    product: Product;
    qty: number;
    disabled: boolean;
    onChange: (delta: number) => void;
}) {
    return <article className={`pos-product-row${qty ? ' is-selected' : ''}`}><span className="pos-product-art"><POSIcon name={product.category === 'do_uong' ? 'cup' : 'plate'}/>{qty > 0 && <span className="pos-product-selected"><POSIcon name="check"/></span>}</span><div className="pos-product-copy"><h2>{product.name}</h2><span>{formatMoney(product.price)}</span></div><div className="pos-product-counter">{qty > 0 ? <QuantityControl name={product.name} qty={qty} disabled={disabled} onIncrease={() => onChange(1)} onDecrease={() => onChange(-1)}/> : <button className="pos-product-add" aria-label={`Thêm ${product.name}`} disabled={disabled} onClick={() => onChange(1)}><POSIcon name="plus"/></button>}</div></article>;
}
