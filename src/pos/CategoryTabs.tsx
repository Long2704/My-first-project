import type { Category } from './types';
export default function CategoryTabs({ categories, value, onChange }: {
    categories: Category[];
    value: string;
    onChange: (id: string) => void;
}) { return <nav className="pos-category-tabs" aria-label="Nhóm món">{categories.map(c => <button key={c.id} aria-pressed={value === c.id} onClick={() => onChange(c.id)}>{c.name}</button>)}</nav>; }
