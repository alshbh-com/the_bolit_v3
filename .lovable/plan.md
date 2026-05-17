## نظام التقفيل اليومي والمحاسبة المتكامل

سأبني نظام متكامل للتقفيل اليومي للمندوبين مع الخزنة والتقارير، مربوط بنظام الشحن الحالي.

### ملاحظات على الوضع الحالي

النظام بالفعل يحتوي على:
- باركود تلقائي عبر `generate_order_barcode()` (trigger موجود) — متسلسل رقمي عبر `order_barcode_seq`، و `tracking_id` = `TP-<barcode>`. سأكتفي بإضافة عمود `qr_value` فقط (نفس قيمة tracking_id) بدون تغيير منطق الترقيم القائم لأن الـ memory تنص على "Strictly numeric sequential barcodes" — **لن أغيّر صيغة الترقيم الحالية**، سأعرض الباركود/QR في الفواتير فقط.
- صفحات قائمة: `CourierCollections`, `CourierFollowup`, `ClosedOrders`, `OfficeAccounts` — تتعامل مع تقفيل جزئي للمندوب. سأبني فوقها نظام تقفيل رسمي مُؤرشف.

### الجداول الجديدة (Migration)

```text
courier_closings
  id, courier_id, closing_date, closed_by, closed_at, status (open|closed|reopened)
  total_orders, delivered_count, returned_count, postponed_count, failed_count
  total_collected, courier_commission, shipping_fees, deposited_amount
  shortage, surplus, net_due, notes

courier_closing_items
  id, closing_id, order_id, final_status, collected_amount, commission, shipping, is_returned, scanned_at

treasury_transactions
  id, type (deposit|withdraw|adjustment), source (closing|manual|office),
  reference_id, amount, balance_after, notes, created_by, created_at

financial_logs
  id, entity_type, entity_id, action, before_json, after_json, user_id, created_at

courier_wallets
  id, courier_id, balance, total_collected, total_commission, total_shortage, updated_at

account_statements (view أو cached table)
  generated on-demand per courier/customer/company
```

كل الجداول مع RLS (authenticated) + indices مناسبة + triggers للـ audit.

### الصفحات الجديدة

1. **`/courier-closing`** — صفحة التقفيل الرئيسية:
   - اختيار المندوب + اليوم
   - عرض كل أوردرات المندوب غير المقفلة
   - مدخل باركود (BarcodeScanner موجود) — يحدد الأوردر ويغير حالته (مسلم/مرتجع/مؤجل)
   - حساب لحظي: إجمالي تحصيل، عمولات، شحن، عجز/زيادة، صافي
   - مدخل "المبلغ المُسلَّم للخزنة" → يحسب العجز/الزيادة تلقائيًا
   - زر "إغلاق وتقفيل" → ينشئ `courier_closing` + items، يقفل الأوردرات، يدخل المبلغ للخزنة، يحدّث المحفظة، يسجل log

2. **`/closings-archive`** — أرشيف التقفيلات (يومي/شهري) مع فلترة بالمندوب والتاريخ، زر "فتح التقفيل" (صلاحية owner فقط).

3. **`/treasury`** — الخزنة: الرصيد الحالي، حركة الأموال، فلترة بالنوع/التاريخ، تصدير.

4. **`/courier-statement/:courierId`** — كشف حساب المندوب: رصيد سابق، تحصيل، عمولات، مرتجعات، صافي.

5. **`/closings-report`** — تقرير التقفيلات (مع تقارير الأرباح/التحصيل/المرتجعات في صفحات منفصلة موجودة بالفعل).

### Realtime

استخدام `supabase.channel()` على `courier_closings` و `treasury_transactions` — يحدّث الواجهات (الإدارة، الحسابات، الخزنة) لحظيًا.

### الصلاحيات

استخدام `user_permissions` الموجود + إضافة sections جديدة:
- `closing_create` (تقفيل)
- `closing_reopen` (فتح تقفيل)
- `closed_order_edit` (تعديل أوردر مقفل)
- `closing_delete` (حذف تقفيلة)
- `closing_approve` (اعتماد)

الـ Owner يحصل على كل الصلاحيات تلقائيًا.

### الحماية

- DB constraint: `UNIQUE(courier_id, closing_date)` لمنع تقفيل مكرر لنفس اليوم.
- Trigger يمنع UPDATE على orders إذا الأوردر داخل closing مُغلق (إلا لـ owner عبر setting).
- كل عملية تكتب في `financial_logs` مع before/after.

### تكامل الباركود

عمود `qr_value` يُضاف للـ orders ويُملأ تلقائيًا بنفس `tracking_id` (عبر trigger). صفحة التقفيل تستخدم `BarcodeScanner` لقراءة `tracking_id`/`barcode` → جلب الأوردر فورًا.

### الواجهة

نفس الـ neon cyberpunk theme الحالي — `glass-effect`, `neon-text`, `gradient-neon`, Cairo/Orbitron.

### الحجم

هذا تغيير ضخم: **migration واحدة + ~6 صفحات جديدة + روابط في AppSidebar + إضافات صلاحيات + realtime hooks**. سأنفذها على دفعات متتالية بعد الموافقة.