import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Order } from '../order-model';
import ConfirmDialog from '../ConfirmDialog';
import POSIcon from './POSIcon';
import POSHeader from './POSHeader';
import CategoryTabs from './CategoryTabs';
import SearchBar from './SearchBar';
import ProductList from './ProductList';
import OrderDetail from './OrderDetail';
import CustomerInfoChips from './CustomerInfoChips';
import FloatingAddButton from './FloatingAddButton';
import OrderBottomBar from './OrderBottomBar';
import { categories, draftAmount, searchProducts } from './types';
import type { Product, TableContext } from './types';
type Props = {
    userId: string;
    table: {
        id: number;
        name: string;
    };
    sessionId: string | null;
    mode: 'menu' | 'order';
    onMode: (mode: 'menu' | 'order') => void;
    products: Product[];
    qty: Record<string, number>;
    notes: Record<string, string>;
    orders: Order[];
    savedTotal: number;
    disabled: boolean;
    sendDisabled: boolean;
    sending: boolean;
    retry: boolean;
    requestId?: string;
    pendingPaymentAmount?: number | null;
    canCancel: boolean;
    paymentReady: boolean;
    canPay: boolean;
    paymentPending: boolean;
    tableActionsVisible: boolean;
    feedback: ReactNode;
    onClose: () => void;
    onChange: (id: string, delta: number) => void;
    onNote: (id: string, note: string) => void;
    onClear: () => void;
    onSend: (note: string) => void;
    onPay: () => void;
    onBusy: (value: boolean) => void;
    onSavedChanged: () => Promise<void>;
};
const emptyContext: TableContext = { guests: 1, customer: '', note: '' };
export default function ServiceWorkspace(p: Props) {
    const [category, setCategory] = useState('all'), [query, setQuery] = useState(''), [search, setSearch] = useState(false), [removing, setRemoving] = useState<string | null>(null), [clearing, setClearing] = useState(false), [more, setMore] = useState(false);
    const key = `goc-pho-table-info:${p.userId}:${p.table.id}`;
    const [info, setInfo] = useState<TableContext>(() => { try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved && (!saved.session_id || saved.session_id === p.sessionId) && saved.value && Number.isInteger(saved.value.guests) && saved.value.guests >= 1 && saved.value.guests <= 30 && typeof saved.value.customer === 'string' && typeof saved.value.note === 'string')
            return saved.value;
    }
    catch { /* Giữ giá trị mặc định. */ } return { ...emptyContext }; });
    const [infoError, setInfoError] = useState('');
    const previousSession = useRef(p.sessionId);
    useEffect(() => { if (previousSession.current && !p.sessionId && !Object.values(p.qty).some(n => n > 0))
        setInfo({ ...emptyContext }); previousSession.current = p.sessionId; }, [p.sessionId]);
    useEffect(() => { try {
        localStorage.setItem(key, JSON.stringify({ session_id: p.sessionId, value: info }));
        setInfoError('');
    }
    catch {
        setInfoError('Chưa lưu được thông tin bàn trên thiết bị.');
    } }, [key, info, p.sessionId]);
    const lines = p.products.filter(product => (p.qty[product.id] ?? 0) > 0).map(product => ({ product, qty: p.qty[product.id], note: p.notes[product.id] ?? '' }));
    const count = Object.values(p.qty).reduce((sum, n) => sum + n, 0), draftTotal = draftAmount(lines);
    const knownRequest = !!p.requestId && p.orders.some(order => order.request_id === p.requestId);
    const savedCount = p.orders.flatMap(order => order.order_items).filter(line => !line.cancelled_at && !line.paid).reduce((sum, line) => sum + line.qty, 0);
    const displayCount = savedCount + (knownRequest ? 0 : count);
    const total = p.pendingPaymentAmount ?? (p.savedTotal + (knownRequest ? 0 : draftTotal));
    const visible = useMemo(()=>searchProducts(p.products, category, query),[p.products,category,query]);
    const removeName = p.products.find(product => product.id === removing)?.name ?? '';
    const qtyRef=useRef(p.qty);qtyRef.current=p.qty;
    const change=useCallback((id: string, delta: number) => { if (p.disabled)
        return; if (delta < 0 && qtyRef.current[id] === 1) {
        setRemoving(id);
        return;
    } p.onChange(id, delta); },[p.disabled,p.onChange]);
    function toOrder() { setMore(false); p.onMode('order'); }
    return <div className={`pos-order-workspace pos-mode-${p.mode}`}>
  <POSHeader title={p.table.name.toLocaleUpperCase('vi-VN')} back={p.mode === 'order'} onBack={() => p.mode === 'menu' && (count || p.orders.length) ? toOrder() : p.onClose()} actions={p.mode === 'menu' ? <><button className="pos-icon-button" aria-label="Tìm kiếm món" aria-expanded={search} onClick={() => setSearch(v => !v)}><POSIcon name="search"/></button><button className="pos-icon-button" aria-label="Xem đơn hàng" onClick={toOrder}><POSIcon name="receipt"/></button></> : p.tableActionsVisible ? <span className="pos-header-external-actions"/> : <button className="pos-icon-button" aria-label="Thao tác đơn" aria-expanded={more} onClick={() => setMore(v => !v)}><POSIcon name="more"/></button>}/>
  <div className="pos-workspace-feedback">{p.feedback}{infoError && <p role="alert">{infoError}</p>}</div>
  {more && <div className="pos-draft-menu"><button disabled={!count || p.disabled} onClick={() => { setMore(false); setClearing(true); }}>Xóa món chưa gửi</button></div>}
  {p.mode === 'menu' ? <><div className="pos-menu-controls">{search && <SearchBar value={query} onChange={setQuery}/>}<CategoryTabs categories={categories} value={category} onChange={setCategory}/></div><div className="pos-pane pos-menu-pane"><ProductList products={visible} qty={p.qty} notes={p.notes} onNote={p.onNote} disabled={p.disabled} onChange={change}/></div>{(displayCount > 0 || p.orders.length > 0) && <footer className="pos-menu-bottom"><button disabled={!count || p.disabled} onClick={() => setClearing(true)}>Chọn lại</button><button className="primary" onClick={toOrder}>Xem đơn <span>{displayCount}</span></button></footer>}</> : <><CustomerInfoChips value={info} takeaway={/mang\s*về/i.test(p.table.name)} onSave={setInfo}/><div className="pos-pane pos-order-pane"><OrderDetail lines={knownRequest ? [] : lines} orders={p.orders} disabled={p.disabled} canCancel={p.canCancel} onChange={change} onNote={p.onNote} onRemove={setRemoving} onBusy={p.onBusy} onSavedChanged={p.onSavedChanged}/></div><FloatingAddButton onClick={() => p.onMode('menu')}/><OrderBottomBar total={total} count={displayCount}>{count > 0 || p.retry ? <><button disabled={p.disabled || !count} onClick={() => setClearing(true)}>Chọn lại</button><button className="primary" disabled={p.sendDisabled} onClick={() => p.onSend(info.note)}>{p.sending ? 'Đang gửi…' : p.retry ? 'Thử gửi lại' : 'Gửi bếp'}</button></> : p.canPay ? <button className="primary" disabled={!p.paymentReady} onClick={p.onPay}>{p.paymentPending ? 'Kiểm tra thanh toán' : 'Thanh toán'}</button> : <button className="primary" onClick={() => p.onMode('menu')}>Thêm món</button>}</OrderBottomBar></>}
  <ConfirmDialog open={!!removing} title="Xóa món khỏi đơn?" busy={false} confirmLabel="Xóa món" onClose={() => setRemoving(null)} onConfirm={() => { if (removing && !p.disabled)
        p.onChange(removing, -(p.qty[removing] ?? 0)); setRemoving(null); }}><p>Xóa <strong>{removeName}</strong> khỏi các món chưa gửi?</p></ConfirmDialog>
  <ConfirmDialog open={clearing} title="Chọn lại món?" busy={false} confirmLabel="Xóa món chưa gửi" onClose={() => setClearing(false)} onConfirm={() => { if (!p.disabled)
        p.onClear(); setClearing(false); }}><p>Các món đã gửi bếp vẫn được giữ nguyên.</p></ConfirmDialog>
 </div>;
}
