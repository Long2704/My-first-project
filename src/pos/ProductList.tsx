import ProductItem from './ProductItem';
import type { Product } from './types';
export default function ProductList({ products, qty, disabled, onChange }: {
    products: Product[];
    qty: Record<string, number>;
    disabled: boolean;
    onChange: (id: string, delta: number) => void;
}) {
    return <div className="pos-product-list">{products.map(product => <ProductItem key={product.id} product={product} qty={qty[product.id] ?? 0} disabled={disabled} onChange={delta => onChange(product.id, delta)}/>)}{!products.length && <div className="pos-empty"><h2>Không tìm thấy món</h2><p>Thử tên khác hoặc chọn danh mục khác.</p></div>}</div>;
}
