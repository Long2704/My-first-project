import POSIcon from './POSIcon';
export default function FloatingAddButton({ onClick }: {
    onClick: () => void;
}) { return <button className="pos-floating-add" aria-label="Thêm món" title="Thêm món" onClick={onClick}><POSIcon name="plus"/></button>; }
