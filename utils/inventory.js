// منطق المخزن البسيط (حالة المخزون + تسميات الفئات) — مفصول عشان يتختبر لوحده
const CATEGORIES = {
  chemicals: { label: 'المنظفات والمواد الكيميائية', short: 'منظفات', prefix: 'CHM' },
  consumables: { label: 'المستهلكات والتغليف', short: 'مستهلكات', prefix: 'CON' },
  supplies: { label: 'المستلزمات', short: 'مستلزمات', prefix: 'SUP' },
};

// out = نفدت الكمية، low = مخزون منخفض (الكمية أقل من أو تساوي الحد الأدنى)، ok = متوفر
function stockStatus(quantity, minQuantity) {
  if (quantity <= 0) return 'out';
  if (minQuantity > 0 && quantity <= minQuantity) return 'low';
  return 'ok';
}

module.exports = { CATEGORIES, stockStatus };
