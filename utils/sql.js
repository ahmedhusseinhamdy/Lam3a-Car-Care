// جزء SQL مشترك: خصم الزيارة = (مجموع الخدمات + مجموع العروض) - السعر المسجّل (مش أقل من صفر)
// alias = اسم جدول الزيارات في الاستعلام (مثلاً v)
function visitDiscountSql(alias = 'v') {
  return `MAX(0,
    COALESCE((SELECT SUM(vs.price) FROM visit_services vs WHERE vs.visit_id = ${alias}.id), 0)
    + COALESCE((SELECT SUM(vo.price) FROM visit_offers vo WHERE vo.visit_id = ${alias}.id), 0)
    - ${alias}.total_price)`;
}
module.exports = { visitDiscountSql };
