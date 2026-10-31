export type Product = {
    id: string;
    name: string;
    price: number;
    category: string;
    is_out: boolean;
};
export type Category = {
    id: string;
    name: string;
};
export type TableContext = {
    guests: number;
    customer: string;
    note: string;
};
export type DraftLine = {
    product: Product;
    qty: number;
    note: string;
};
export const categories: Category[] = [{ id: 'all', name: 'Tất cả' }, { id: 'bun', name: 'Món chính' }, { id: 'an_them', name: 'Món thêm' }, { id: 'do_uong', name: 'Đồ uống' }];
export const formatMoney = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + 'đ';
export const draftAmount = (lines: DraftLine[]) => lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
export function searchProducts(products: Product[], category: string, query: string) {
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi-VN');
    const needle = normalize(query.trim());
    return products.filter(p => !p.is_out && (category === 'all' || p.category === category) && normalize(p.name).includes(needle));
}
