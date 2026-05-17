
# قسم "قراءة الباركود" (Bulk Barcode Scanning)

## نظرة عامة
صفحة جديدة `/barcode-scan` تستخدم جهاز الـ Scanner (يعمل ككيبورد) لقراءة عدة أوردرات في Session واحدة، ثم تطبيق Actions جماعية عليها مع تحديث فوري (Realtime) لكل النظام.

## ملاحظات مهمة قبل البناء
نظامك الحالي يحتوي بالفعل على:
- جدول `orders` فيه `barcode`, `tracking_id`, `qr_value` يتم توليدها تلقائياً عبر trigger ✅
- جدول `order_statuses` لإدارة الحالات (لذلك لن أفرض حالات ثابتة، بل سأقرأها من قاعدة البيانات) ✅
- جدول `activity_logs` للسجلات ✅
- مكوّن `BarcodeScanner` للكاميرا و`PrintSticker` للطباعة ✅
- نظام صلاحيات `usePermissions`

لذلك سأبني فوق الموجود وليس تكراره.

## ما سيتم بناؤه

### 1. قاعدة البيانات (migration واحدة)
- `scan_sessions`: id, user_id, started_at, ended_at, total_count, notes
- `scan_session_items`: session_id, order_id, scanned_at, unique(session_id, order_id) لمنع التكرار
- `order_status_history`: order_id, old_status_id, new_status_id, changed_by, changed_at, source (`scan`/`manual`/`bulk`)
- تفعيل Realtime على `orders`, `scan_session_items`, `order_status_history`
- RLS: authenticated فقط (متوافق مع باقي النظام)

### 2. الصفحة الجديدة `src/pages/BarcodeScan.tsx`
- زر كبير "ابدأ الاسكان" → يفتح وضع الاسكان
- Input ضخم auto-focus يستقبل قراءات المسدس (Enter = نهاية الكود)
- Live counter + جدول بالأوردرات الممسوحة (رقم/عميل/مندوب/حالة/مبلغ/عنوان)
- صوت نجاح/خطأ (Web Audio API، بدون ملفات)
- منع: التكرار، الأوردرات المقفلة، غير الموجودة، المرتجعة (مع Toast واضح)
- زر "انتهيت" → يفتح Dialog الـ Bulk Actions

### 3. Bulk Actions Dialog
- تغيير الحالة (من `order_statuses` ديناميكياً)
- قفل الأوردرات (`is_closed=true`)
- إرجاع للراسل (`returned_to_sender=true`)
- تعيين/إلغاء تعيين مندوب
- طباعة فواتير/ستيكرات جماعية (يعيد استخدام منطق `PrintSticker`)
- تصدير PDF (jsPDF) و Excel (xlsx — موجود بالفعل في المشروع)
- حذف من القائمة الحالية

كل Action:
- يُحدث `orders` (مع `last_modified_by` عبر الـ trigger الموجود)
- يكتب صف في `order_status_history` (للتغييرات الحالاتية)
- يكتب `activity_logs` للسجل
- Realtime يحدّث باقي الصفحات (Orders, ClosedOrders, CourierFollowup) تلقائياً

### 4. الـ Sidebar
إضافة بند جديد "قراءة الباركود" في مجموعة "الأدوات" مع أيقونة `ScanBarcode`.

### 5. الـ Routing
تسجيل المسار في `App.tsx` تحت `AppLayout` المحمي.

## ما لن أبنيه (لتجنّب التضخّم)
- `order_items`: نظامك الحالي يعتمد على صف واحد لكل أوردر (`product_id`, `quantity`); لن أغيّر هذا الـ schema الكبير.
- `courier_daily_reports`: عندك بالفعل `courier_closings` + `courier_wallets` تؤدي نفس الغرض.
- إعادة توليد Barcode/QR: يتم بالفعل تلقائياً عبر trigger `generate_order_barcode`.

## التقنيات
- Realtime: `supabase.channel().on('postgres_changes')`
- Sounds: Web Audio API (بدون assets خارجية)
- Export: مكتبة `xlsx` (موجودة) + `jspdf` (موجودة)
- UI: shadcn + Tailwind + الـ design tokens (Neon Cyberpunk) الحالية

## خطوات التنفيذ
1. Migration واحدة (الجداول + Realtime + RLS)
2. إنشاء `src/pages/BarcodeScan.tsx` + `src/components/BulkActionsDialog.tsx` + hook `src/hooks/useScanSession.ts`
3. تحديث `AppSidebar` + `App.tsx`

موافق أبدأ التنفيذ؟
