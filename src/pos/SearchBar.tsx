import POSIcon from './POSIcon';
export default function SearchBar({ value, onChange }: {
    value: string;
    onChange: (value: string) => void;
}) { return <label className="pos-product-search"><POSIcon name="search"/><input aria-label="Tìm món" type="search" autoFocus placeholder="Tìm tên món…" value={value} onChange={e => onChange(e.target.value)}/></label>; }
