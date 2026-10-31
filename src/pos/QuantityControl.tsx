import POSIcon from './POSIcon';
export default function QuantityControl({ name, qty, disabled, increaseDisabled = false, decreaseDisabled = false, maxQty = 99, onIncrease, onDecrease }: {
    name: string;
    qty: number;
    disabled: boolean;
    increaseDisabled?: boolean;
    decreaseDisabled?: boolean;
    maxQty?: number;
    onIncrease: () => void;
    onDecrease: () => void;
}) {
    return <div className="pos-quantity-control" aria-label={`Số lượng ${name}`}><button type="button" aria-label={`Bớt ${name}`} disabled={disabled || decreaseDisabled || qty < 1} onClick={onDecrease}><POSIcon name="minus"/></button><output aria-label={`Số lượng ${name}`} aria-live="polite">{qty}</output><button type="button" aria-label={`Thêm ${name}`} disabled={disabled || increaseDisabled || qty >= maxQty} onClick={onIncrease}><POSIcon name="plus"/></button></div>;
}
