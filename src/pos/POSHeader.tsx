import type { ReactNode } from 'react';
import POSIcon from './POSIcon';
export default function POSHeader({ title, back = false, onBack, actions }: {
    title: string;
    back?: boolean;
    onBack: () => void;
    actions?: ReactNode;
}) {
    return <header className="pos-screen-header"><button className="pos-icon-button pos-back" aria-label={back ? 'Quay lại danh sách bàn' : 'Đóng danh sách món'} onClick={onBack}><POSIcon name={back ? 'back' : 'close'}/></button><h1>{title}</h1><div className="pos-header-actions">{actions}</div></header>;
}
