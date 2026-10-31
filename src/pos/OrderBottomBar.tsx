import type { ReactNode } from 'react';
import { formatMoney } from './types';
export default function OrderBottomBar({ total, count, children }: {
    total: number;
    count: number;
    children: ReactNode;
}) { return <footer className="pos-bottom-bar"><div className="pos-total-line"><span>Tổng tiền <small>{count}</small></span><strong aria-live="polite">{formatMoney(total)}</strong></div><div className="pos-bottom-actions">{children}</div></footer>; }
