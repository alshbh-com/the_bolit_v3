import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, StickyNote, FileText } from 'lucide-react';
import { toast } from 'sonner';
import JsBarcode from 'jsbarcode';

function barcodeDataUrl(value: string): string {
  if (!value) return '';
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 2,
      height: 60,
      displayValue: false,
      margin: 0,
    });
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

export default function PrintSticker() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => { loadAllOrders(); }, []);

  const loadAllOrders = async () => {
    const { data } = await supabase
      .from('orders')
      .select('*, offices(name)')
      .eq('is_closed', false)
      .order('created_at', { ascending: false })
      .limit(500);
    setResults(data || []);
  };

  const doSearch = async () => {
    if (!search.trim()) { loadAllOrders(); return; }
    const term = search.trim();
    const { data } = await supabase
      .from('orders')
      .select('*, offices(name)')
      .or(`barcode.ilike.%${term}%,customer_code.ilike.%${term}%,tracking_id.ilike.%${term}%,customer_phone.ilike.%${term}%,customer_name.ilike.%${term}%`)
      .order('created_at', { ascending: false })
      .limit(200);
    setResults(data || []);
    setSelected(new Set());
    if (!data?.length) toast.error('لم يتم العثور على نتائج');
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === results.length) setSelected(new Set());
    else setSelected(new Set(results.map(o => o.id)));
  };

  const selectedOrders = results.filter(o => selected.has(o.id));

  const generateBarcodeStripes = (barcode: string) => {
    return barcode.split('').map((c: string) => {
      const w = (parseInt(c) || 1) + 1;
      return `<div style="width:${w}px;height:30px;background:#000;margin:0 0.5px;display:inline-block"></div>`;
    }).join('');
  };

  const printStickers = () => {
    if (selectedOrders.length === 0) { toast.error('اختر أوردرات للطباعة'); return; }
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;

    const stickers = selectedOrders.map(order => {
      const total = Number(order.price) + Number(order.delivery_price);
      const barcode = order.barcode || '';
      const tracking = order.tracking_id || '';
      const barImg = barcodeDataUrl(barcode);
      return `
        <div class="sticker">
          <div class="header">The Pilito</div>
          <div class="date">${new Date(order.created_at).toLocaleDateString('ar-EG')}</div>
          ${barImg ? `<img class="bar-img" src="${barImg}" alt="barcode"/>` : ''}
          <div class="barcode-num">${barcode}</div>
          ${tracking ? `<div class="tracking">رقم التتبع: <b>${tracking}</b></div>` : ''}
          <div class="row"><span>الكود: <b>${order.customer_code || '-'}</b></span></div>
          <div class="info">العميل: <b>${order.customer_name}</b></div>
          <div class="info">المكتب: <b>${order.offices?.name || '-'}</b></div>
          <div class="info">هاتف: <b dir="ltr">${order.customer_phone}</b></div>
          <div class="info">العنوان: <b>${order.address || '-'}</b></div>
          <div class="info">قطع: <b>${order.quantity || 1}</b> ${order.size ? `| مقاس: <b>${order.size}</b>` : ''} ${order.color ? `| لون: <b>${order.color}</b>` : ''}</div>
          <div class="total">${total} ج.م</div>
        </div>`;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
      <style>
        @page { size: 50mm 100mm; margin: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; }
        .sticker { width: 50mm; height: 100mm; padding: 4mm 1.5mm 4mm 10mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; direction: rtl; text-align: right; }
        .sticker:last-child { page-break-after: auto; }
        .header { text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 1px; direction: ltr; }
        .date { text-align: center; font-size: 8px; margin-bottom: 3px; color: #333; }
        .bar-img { display: block; width: 90%; height: 14mm; margin: 1mm auto 1mm; }
        .barcode-num { font-family: monospace; font-size: 14px; font-weight: bold; margin-bottom: 2px; text-align: center; letter-spacing: 1px; }
        .tracking { font-size: 9px; text-align: center; margin-bottom: 3px; color: #111; }
        .info { margin: 2px 0; font-size: 10px; line-height: 1.4; text-align: right; word-wrap: break-word; overflow-wrap: break-word; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; font-size: 10px; }
        .total { font-size: 15px; font-weight: bold; text-align: center; border: 1.5px solid #000; padding: 3px; margin-top: auto; }
      </style></head><body>${stickers}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const printInvoice = () => {
    if (selectedOrders.length === 0) { toast.error('اختر أوردرات للطباعة'); return; }
    const printWindow = window.open('', '_blank', 'width=900,height=1100');
    if (!printWindow) return;

    const today = new Date().toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const invoicesHtml = selectedOrders.map((order, i) => {
      const price = Number(order.price) || 0;
      const shipping = Number(order.delivery_price) || 0;
      const total = price + shipping;
      const barcode = order.barcode || '';
      const tracking = order.tracking_id || '';
      const barImg = barcodeDataUrl(barcode);
      const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString('ar-EG') : '-';
      return `
        <section class="invoice">
          <!-- Brand bar -->
          <header class="brand-bar">
            <div class="brand">
              <div class="brand-mark">TP</div>
              <div class="brand-text">
                <h1>The Pilito</h1>
                <p>نظام التوصيل والشحن</p>
              </div>
            </div>
            <div class="meta">
              <div class="meta-row"><span>فاتورة رقم</span><b>#${barcode || (i + 1)}</b></div>
              <div class="meta-row"><span>تاريخ الطباعة</span><b>${today}</b></div>
              <div class="meta-row"><span>تاريخ الأوردر</span><b>${orderDate}</b></div>
            </div>
          </header>

          <!-- Barcode strip -->
          ${barImg ? `
          <div class="barcode-strip">
            <img src="${barImg}" alt="barcode"/>
            <div class="barcode-num">${barcode}</div>
            ${tracking ? `<div class="tracking">رقم التتبع: <b>${tracking}</b></div>` : ''}
          </div>` : ''}

          <!-- Two-column details -->
          <div class="details">
            <div class="card">
              <h3>بيانات العميل</h3>
              <div class="row"><span>الاسم</span><b>${order.customer_name || '-'}</b></div>
              <div class="row"><span>الهاتف</span><b dir="ltr">${order.customer_phone || '-'}</b></div>
              <div class="row"><span>الكود</span><b>${order.customer_code || '-'}</b></div>
              <div class="row full"><span>العنوان</span><b>${order.address || '-'}</b></div>
            </div>
            <div class="card">
              <h3>بيانات الشحنة</h3>
              <div class="row"><span>المكتب</span><b>${order.offices?.name || '-'}</b></div>
              <div class="row"><span>المنتج</span><b>${order.product_name || '-'}</b></div>
              <div class="row"><span>الكمية</span><b>${order.quantity || 1}</b></div>
              <div class="row"><span>المقاس</span><b>${order.size || '-'}</b></div>
              <div class="row"><span>اللون</span><b>${order.color || '-'}</b></div>
              ${order.notes ? `<div class="row full"><span>ملاحظات</span><b>${order.notes}</b></div>` : ''}
            </div>
          </div>

          <!-- Totals -->
          <div class="totals">
            <div class="t-line"><span>سعر الأوردر</span><b>${price.toLocaleString()} ج.م</b></div>
            <div class="t-line"><span>الشحن</span><b>${shipping.toLocaleString()} ج.م</b></div>
            <div class="t-line grand"><span>الإجمالي المطلوب تحصيله</span><b>${total.toLocaleString()} ج.م</b></div>
          </div>

          <!-- Signatures -->
          <div class="signs">
            <div class="sign"><span>توقيع المندوب</span><div class="line"></div></div>
            <div class="sign"><span>توقيع العميل</span><div class="line"></div></div>
            <div class="sign"><span>الختم</span><div class="line"></div></div>
          </div>

          <footer class="foot">شكراً لتعاملكم مع The Pilito — للاستفسار يرجى ذكر رقم التتبع</footer>
        </section>`;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>فواتير - The Pilito</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        @page { size: A4; margin: 0; }
        * { box-sizing: border-box; }
        body { font-family: 'Cairo', 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #1a1a1a; }
        .invoice { width: 210mm; min-height: 297mm; padding: 14mm 12mm; page-break-after: always; display: flex; flex-direction: column; }
        .invoice:last-child { page-break-after: auto; }

        /* Brand bar */
        .brand-bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-radius: 14px; background: linear-gradient(135deg, #f97316, #fb923c); color: #fff; box-shadow: 0 6px 18px rgba(249,115,22,0.25); }
        .brand { display: flex; align-items: center; gap: 14px; }
        .brand-mark { width: 56px; height: 56px; border-radius: 14px; background: #fff; color: #f97316; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; letter-spacing: -1px; }
        .brand-text h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
        .brand-text p { margin: 2px 0 0; font-size: 12px; opacity: 0.9; }
        .meta { display: flex; flex-direction: column; gap: 4px; text-align: left; font-size: 12px; }
        .meta-row { display: flex; gap: 8px; justify-content: flex-end; }
        .meta-row span { opacity: 0.85; }
        .meta-row b { background: rgba(255,255,255,0.18); padding: 2px 8px; border-radius: 6px; }

        /* Barcode strip */
        .barcode-strip { margin: 16px 0 14px; padding: 12px; border: 1.5px dashed #f97316; border-radius: 12px; text-align: center; background: #fff7ed; }
        .barcode-strip img { height: 56px; max-width: 60%; }
        .barcode-num { font-family: 'Courier New', monospace; font-size: 16px; font-weight: 700; letter-spacing: 3px; margin-top: 4px; color: #1a1a1a; }
        .tracking { font-size: 12px; color: #444; margin-top: 4px; }

        /* Details */
        .details { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; background: #fafafa; }
        .card h3 { margin: 0 0 8px; font-size: 13px; color: #f97316; font-weight: 700; padding-bottom: 6px; border-bottom: 2px solid #fed7aa; }
        .row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 12.5px; border-bottom: 1px dotted #e5e7eb; }
        .row:last-child { border-bottom: none; }
        .row span { color: #6b7280; }
        .row b { color: #111; font-weight: 600; text-align: left; }
        .row.full { flex-direction: column; gap: 4px; }
        .row.full b { text-align: right; line-height: 1.5; }

        /* Totals */
        .totals { margin-top: auto; border: 1.5px solid #1a1a1a; border-radius: 12px; overflow: hidden; }
        .t-line { display: flex; justify-content: space-between; padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #e5e7eb; }
        .t-line:last-child { border-bottom: none; }
        .t-line span { color: #444; }
        .t-line b { font-weight: 700; }
        .t-line.grand { background: #1a1a1a; color: #fff; font-size: 18px; padding: 14px 16px; }
        .t-line.grand span { color: #fed7aa; }
        .t-line.grand b { color: #fff; font-size: 22px; }

        /* Signatures */
        .signs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 20px; }
        .sign { text-align: center; font-size: 12px; color: #6b7280; }
        .sign .line { margin-top: 28px; border-top: 1.5px solid #1a1a1a; }

        /* Footer */
        .foot { margin-top: 16px; text-align: center; font-size: 11px; color: #9ca3af; padding-top: 10px; border-top: 1px dashed #e5e7eb; }
      </style></head><body>${invoicesHtml}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl sm:text-2xl font-bold">الطباعة</h1>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-lg">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="بحث بالباركود / الكود / الاسم / الهاتف..." value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            className="pr-9 bg-secondary border-border" />
        </div>
        <Button onClick={doSearch}>بحث</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium">تم تحديد {selected.size} أوردر</span>
        <Button size="sm" onClick={printStickers} disabled={selected.size === 0}>
          <StickyNote className="h-4 w-4 ml-1" />ملصقات صغيرة
        </Button>
        <Button size="sm" variant="outline" onClick={printInvoice} disabled={selected.size === 0}>
          <FileText className="h-4 w-4 ml-1" />فاتورة (A4)
        </Button>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="w-10"><Checkbox checked={results.length > 0 && selected.size === results.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead className="text-right">الباركود</TableHead>
                  <TableHead className="text-right">الكود</TableHead>
                  <TableHead className="text-right">العميل</TableHead>
                  <TableHead className="text-right">العنوان</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">الهاتف</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">المكتب</TableHead>
                  <TableHead className="text-right">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">لا توجد أوردرات</TableCell></TableRow>
                ) : results.map(order => (
                  <TableRow key={order.id} className="border-border">
                    <TableCell><Checkbox checked={selected.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></TableCell>
                    <TableCell className="font-mono text-xs">{order.barcode || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{order.customer_code || '-'}</TableCell>
                    <TableCell className="text-sm">{order.customer_name}</TableCell>
                    <TableCell className="text-sm truncate max-w-[120px]">{order.address || '-'}</TableCell>
                    <TableCell dir="ltr" className="hidden sm:table-cell text-sm">{order.customer_phone}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">{order.offices?.name || '-'}</TableCell>
                    <TableCell className="font-bold text-sm">{Number(order.price) + Number(order.delivery_price)} ج.م</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
