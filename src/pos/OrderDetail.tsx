import type { Order } from '../order-model';
import { CancelItem } from '../OperationsPanel';
import type { DraftLine } from './types';
import { formatMoney } from './types';
import POSIcon from './POSIcon';
import OrderItem from './OrderItem';
export default function OrderDetail({ lines, orders, disabled, canCancel, onChange, onNote, onRemove, onBusy, onSavedChanged }: {
    lines: DraftLine[];
    orders: Order[];
    disabled: boolean;
    canCancel: boolean;
    onChange: (id: string, delta: number) => void;
    onNote: (id: string, note: string) => void;
    onRemove: (id: string) => void;
    onBusy: (value: boolean) => void;
    onSavedChanged: () => Promise<void>;
}) {
    return <div className="pos-order-lines">{orders.length > 0 && <><h2 className="pos-lines-label">Đã gửi bếp</h2>{orders.map(order => <div className="pos-saved-batch" key={order.id}>{order.order_items.map(line => <article key={line.id} className={`pos-saved-line${line.cancelled_at ? ' is-cancelled' : ''}`}><span className="pos-order-art"><POSIcon name={line.category === 'do_uong' ? 'cup' : 'plate'}/></span><div className="pos-order-item-body"><div className="pos-order-item-heading"><h3>{line.name}</h3><small>{line.cancelled_at ? 'Đã hủy' : line.paid ? 'Đã thanh toán' : order.status === 'done' ? 'Đã ra món' : 'Đang làm'}</small></div><div className="pos-order-item-bottom"><strong>{formatMoney(line.price * line.qty)}</strong><span className="pos-saved-qty">{line.qty} × {formatMoney(line.price)}</span></div>{line.note && <p className="pos-saved-note">{line.note}</p>}{canCancel && !line.cancelled_at && !line.paid && <div className="pos-saved-actions"><CancelItem compact item={line} disabled={disabled} onBusy={onBusy} onChanged={onSavedChanged}/></div>}</div></article>)}</div>)}</>}{lines.length > 0 && <><h2 className="pos-lines-label">Chưa gửi · {lines.reduce((sum, line) => sum + line.qty, 0)} món</h2>{lines.map(line => <OrderItem key={line.product.id} line={line} disabled={disabled} onChange={delta => onChange(line.product.id, delta)} onNote={note => onNote(line.product.id, note)} onRemove={() => onRemove(line.product.id)}/>)}</>}{!orders.length && !lines.length && <div className="pos-empty"><h2>Chưa có món</h2><p>Bấm dấu + để chọn món.</p></div>}</div>;
}
