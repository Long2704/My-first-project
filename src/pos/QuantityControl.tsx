import POSIcon from './POSIcon';
export default function QuantityControl({ name, qty, disabled, increaseDisabled = false, onIncrease, onDecrease }: {
    name: string;
    qty: number;
    disabled: boolean;
    increaseDisabled?: boolean;
    onIncrease: () => void;
    onDecrease: () => void;
}) {
    return <div className="pos-quantity-control" aria-label={`Số lượng ${name}`}><button aria-label={`Bớt ${name}`} disabled={disabled || qty < 1} onClick={onDecrease}><POSIcon name="minus"/></button><output aria-label={`Số lượng ${name}`} aria-live="polite">{qty}</output><button aria-label={`Thêm ${name}`} disabled={disabled || increaseDisabled || qty >= 99} onClick={onIncrease}><POSIcon name="plus"/></button></div>;
}
