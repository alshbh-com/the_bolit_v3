import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Download, Share2, Lock, Unlock, Ban, Check, Save } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';

interface SettlementRow {
  id: string;
  code: string;
  name: string;
  status_id: string;
  pieces: string;
  amount: string;
  shipping: string;
  arrived: string;
  courier_id?: string;
  is_settled?: boolean;
  returned_to_sender?: boolean;
}

const newRow = (): SettlementRow => ({
  id: crypto.randomUUID(),
  code: '',
  name: '',
  status_id: '',
  pieces: '',
  amount: '',
  shipping: '',
  arrived: '',
});

export default function OfficeSettlement() {
  const [rows, setRows] = useState<SettlementRow[]>([newRow()]);
  const [pickupRate, setPickupRate] = useState('');
  const [offices, setOffices] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [couriers, setCouriers] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<string>('all');
  const [closingDate, setClosingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [closingId, setClosingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Diary-like controls
  const [isLocked, setIsLocked] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [preventAdd, setPreventAdd] = useState(false);
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);

  // Auto-save with debounce
  const triggerAutoSave = useCallback(() => {
    if (!selectedOffice || selectedOffice === 'all' || isLoadingRef.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveToDbSilent();
    }, 1500);
  }, [selectedOffice, closingDate, rows, pickupRate, isLocked, isClosed, preventAdd]);

  useEffect(() => {
    supabase.from('offices').select('id, name').order('name').then(({ data }) => setOffices(data || []));
    supabase.from('order_statuses').select('id, name').order('sort_order').then(({ data }) => setStatuses(data || []));
    const loadCouriers = async () => {
      const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'courier');
      if (roles && roles.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, commission_amount')
          .in('id', roles.map(r => r.user_id));
        setCouriers(profiles || []);
      }
    };
    loadCouriers();
  }, []);

  // Trigger auto-save when data changes
  useEffect(() => {
    if (selectedOffice && selectedOffice !== 'all' && !isLoadingRef.current) {
      triggerAutoSave();
    }
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [rows, pickupRate, isLocked, isClosed, preventAdd]);

  // Load saved closing data
  useEffect(() => {
    if (selectedOffice && selectedOffice !== 'all') {
      loadClosingData();
    } else {
      resetState();
    }
  }, [selectedOffice, closingDate]);

  const resetState = () => {
    setRows([newRow()]);
    setPickupRate('');
    setIsLocked(false);
    setIsClosed(false);
    setPreventAdd(false);
    setClosingId(null);
  };

  const loadClosingData = async () => {
    isLoadingRef.current = true;
    // Try to load from DB first
    const { data, error } = await supabase
      .from('office_daily_closings')
      .select('*')
      .eq('office_id', selectedOffice)
      .eq('closing_date', closingDate)
      .maybeSingle();
    if (error) { console.error('Load error:', error); }

    if (data) {
      const saved = data as any;
      setClosingId(saved.id);
      setPickupRate(String(saved.pickup_rate || ''));
      setIsLocked(saved.is_locked);
      setIsClosed(saved.is_closed);
      setPreventAdd(saved.prevent_add);
      const jsonData = saved.data_json;
      if (jsonData && Array.isArray(jsonData) && jsonData.length > 0) {
        setRows(jsonData);
        isLoadingRef.current = false;
        return;
      }
    } else {
      setClosingId(null);
    }

    // If no saved data, load from orders
    const { data: orderData } = await supabase.from('orders').select('*, order_statuses(name, color)')
      .eq('office_id', selectedOffice)
      .eq('is_closed', false)
      .eq('is_settled', false)
      .order('created_at', { ascending: false });

    if (orderData && orderData.length > 0) {
      setRows(orderData.map(o => ({
        id: o.id,
        code: o.customer_code || '',
        name: o.customer_name || '',
        status_id: o.status_id || '',
        pieces: String(o.quantity || 1),
        amount: String(Number(o.price) || 0),
        shipping: String(Number(o.delivery_price) || 0),
        arrived: '0',
        courier_id: o.courier_id || '',
        is_settled: Boolean(o.is_settled),
        returned_to_sender: Boolean(o.returned_to_sender),
      })));
    } else {
      setRows([newRow()]);
    }
    isLoadingRef.current = false;
  };

  // Silent auto-save (no toast unless error)
  const saveToDbSilent = async () => {
    if (!selectedOffice || selectedOffice === 'all') return;
    try {
      const payload = {
        office_id: selectedOffice,
        closing_date: closingDate,
        data_json: rows,
        pickup_rate: parseFloat(pickupRate) || 0,
        is_locked: isLocked,
        is_closed: isClosed,
        prevent_add: preventAdd,
        updated_at: new Date().toISOString(),
      };
      if (closingId) {
        await supabase.from('office_daily_closings').update(payload as any).eq('id', closingId);
      } else {
        const { data } = await supabase.from('office_daily_closings').insert(payload as any).select().single();
        if (data) setClosingId((data as any).id);
      }
    } catch { /* silent */ }
  };

  const saveToDb = async () => {
    if (!selectedOffice || selectedOffice === 'all') {
      toast.error('اختر مكتب أولاً');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        office_id: selectedOffice,
        closing_date: closingDate,
        data_json: rows,
        pickup_rate: parseFloat(pickupRate) || 0,
        is_locked: isLocked,
        is_closed: isClosed,
        prevent_add: preventAdd,
        updated_at: new Date().toISOString(),
      };

      if (closingId) {
        const { error } = await supabase.from('office_daily_closings').update(payload as any).eq('id', closingId);
        if (error) { toast.error('فشل التحديث: ' + error.message); setSaving(false); return; }
      } else {
        const { data, error } = await supabase.from('office_daily_closings').insert(payload as any).select().single();
        if (error) { toast.error('فشل الحفظ: ' + error.message); setSaving(false); return; }
        if (data) setClosingId((data as any).id);
      }
      toast.success('تم حفظ البيانات');
    } catch (e: any) {
      toast.error('فشل الحفظ: ' + (e?.message || ''));
    }
    setSaving(false);
  };

  const addRow = () => {
    if (preventAdd) { toast.error('الإضافة ممنوعة'); return; }
    setRows(prev => [...prev, newRow()]);
  };

  const removeRow = (id: string) => {
    if (rows.length <= 1 || isLocked) return;
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const updateRow = (id: string, field: keyof SettlementRow, value: string) => {
    if (isLocked) return;
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const getCourierCommissionForRow = (row: SettlementRow) => {
    const courier = couriers.find(c => c.id === row.courier_id);
    return Number(courier?.commission_amount || 0);
  };

  const getOfficeShippingNet = (row: SettlementRow) => (parseFloat(row.shipping) || 0) - getCourierCommissionForRow(row);

  const getOfficeOutcome = (row: SettlementRow) => {
    if (row.returned_to_sender) return 'returned';
    if (row.is_settled) return 'collected';
    return 'pending';
  };

  const getOfficeOutcomeLabel = (row: SettlementRow) => {
    if (row.returned_to_sender) return 'تم ارتجاع للراسل';
    if (row.is_settled) return 'تم التحصيل';
    return 'لم يتم التحديد';
  };

  const updateOfficeOutcome = async (rowId: string, outcome: 'pending' | 'collected' | 'returned') => {
    if (isLocked) return;
    const previous = rows.find(r => r.id === rowId);
    const next = outcome === 'returned'
      ? { returned_to_sender: true, is_settled: false }
      : outcome === 'collected'
        ? { returned_to_sender: false, is_settled: true }
        : { returned_to_sender: false, is_settled: false };

    setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...next } : r));
    const { error } = await supabase.from('orders').update(next as any).eq('id', rowId);
    if (error) {
      toast.error('فشل تحديث حالة الحساب');
      if (previous) setRows(prev => prev.map(r => r.id === rowId ? previous : r));
      return;
    }
    toast.success(outcome === 'returned' ? 'تم تحديد ارتجاع للراسل' : outcome === 'collected' ? 'تم تحديد تم التحصيل' : 'تم إلغاء حالة الحساب');
  };

  const usedRows = rows.filter(r =>
    r.code.trim() !== '' || r.name.trim() !== '' || r.status_id || r.amount.trim() !== '' || r.shipping.trim() !== '' || r.arrived.trim() !== ''
  );

  // Status filter helpers
  const statusFilterNames = ['تم التسليم', 'تسليم جزئي', 'دفع الشحن', 'رفض ودفع شحن', 'المرتجع', 'رفض', 'الشحن على الراسل'];
  const toggleStatusFilter = (name: string) => {
    setStatusFilters(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  };

  const displayRows = useMemo(() => {
    if (statusFilters.size === 0) return rows;
    return rows.filter(r => {
      const sName = statuses.find(s => s.id === r.status_id)?.name || '';
      return statusFilters.has(sName);
    });
  }, [rows, statusFilters, statuses]);

  // Dynamic summary based on filters
  const filterSummary = useMemo(() => {
    const collectionStatuses = ['تم التسليم', 'تسليم جزئي', 'دفع الشحن', 'رفض ودفع شحن', 'الشحن على الراسل'];
    const returnStatuses = ['المرتجع', 'رفض'];
    const activeCollection = [...statusFilters].filter(s => collectionStatuses.includes(s));
    const activeReturn = [...statusFilters].filter(s => returnStatuses.includes(s));

    let collectionTotal = 0;
    let returnTotal = 0;

    displayRows.forEach(r => {
      const sName = statuses.find(s => s.id === r.status_id)?.name || '';
      if (activeCollection.includes(sName)) {
        collectionTotal += parseFloat(r.amount) || 0;
      }
      if (activeReturn.includes(sName)) {
        returnTotal += parseFloat(r.amount) || 0;
      }
    });

    return {
      hasCollectionFilter: activeCollection.length > 0,
      hasReturnFilter: activeReturn.length > 0,
      collectionTotal,
      returnTotal,
      collectionShipping: displayRows.filter(r => activeCollection.includes(statuses.find(s => s.id === r.status_id)?.name || '')).reduce((s, r) => s + (parseFloat(r.shipping) || 0), 0),
      returnCount: displayRows.filter(r => activeReturn.includes(statuses.find(s => s.id === r.status_id)?.name || '')).length,
    };
  }, [displayRows, statusFilters, statuses]);

  const officeName = offices.find(o => o.id === selectedOffice)?.name || 'تقفيلة';
  const pickupUnits = usedRows.length;
  const totalPieces = displayRows.reduce((sum, r) => sum + (parseFloat(r.pieces) || 0), 0);
  const totalAmount = displayRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const totalShipping = displayRows.reduce((sum, r) => sum + (parseFloat(r.shipping) || 0), 0);
  const totalCourierCommission = displayRows.reduce((sum, r) => sum + getCourierCommissionForRow(r), 0);
  const totalOfficeShippingNet = totalShipping - totalCourierCommission;
  const totalArrived = displayRows.reduce((sum, r) => sum + (parseFloat(r.arrived) || 0), 0);

  const pickupRateNum = parseFloat(pickupRate) || 0;
  const pickupTotal = pickupUnits * pickupRateNum;
  const due = (totalAmount + totalOfficeShippingNet) - (totalArrived + pickupTotal);

  const exportToPDF = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const statusName = (sid: string) => statuses.find(s => s.id === sid)?.name || '-';
    const tableRows = displayRows.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${r.code}</td><td>${r.name}</td><td>${statusName(r.status_id)}</td>
      <td>${r.pieces}</td><td>${r.amount}</td><td>${r.shipping}</td><td>${getCourierCommissionForRow(r)}</td><td>${getOfficeShippingNet(r)}</td><td>${r.arrived}</td><td>${getOfficeOutcomeLabel(r)}</td>
    </tr>`).join('');

    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
    <title>تقفيلة ${officeName}</title>
    <style>
      @page { size: A4 landscape; margin: 8mm; }
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11px; margin: 0; padding: 10px; }
      .header { text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #333; padding: 4px 6px; text-align: right; font-size: 10px; }
      th { background: #f0f0f0; font-weight: bold; }
      .total-row { background: #e8f4e8; font-weight: bold; }
      .summary { margin-top: 12px; border: 2px solid #000; padding: 8px; font-size: 12px; }
    </style></head><body>
    <div class="header">تقفيلة ${officeName} | ${format(new Date(closingDate), 'dd/MM/yyyy')}</div>
    <table>
      <thead><tr><th>#</th><th>الكود</th><th>الاسم</th><th>الحالة</th><th>القطع</th><th>سعر الأوردر</th><th>سعر الشحن</th><th>عمولة المندوب</th><th>الصافي للمكتب من الشحن</th><th>الواصل</th><th>حالة الحساب</th></tr></thead>
      <tbody>${tableRows}
        <tr class="total-row"><td colspan="4">الإجمالي (${displayRows.length} أوردر)</td><td>${totalPieces}</td><td>${totalAmount}</td><td>${totalShipping}</td><td>${totalCourierCommission}</td><td>${totalOfficeShippingNet}</td><td>${totalArrived}</td><td></td></tr>
      </tbody>
    </table>
    <div class="summary">
      <div>إجمالي سعر الأوردر: <strong>${totalAmount}</strong> | إجمالي الشحن: <strong>${totalShipping}</strong></div>
      <div>إجمالي عمولة المناديب: <strong>${totalCourierCommission}</strong> | إجمالي الصافي للمكتب من الشحن: <strong>${totalOfficeShippingNet}</strong></div>
      <div>البيك اب = ${pickupUnits} × ${pickupRateNum} = <strong>${pickupTotal}</strong></div>
      <div>المستحق = (سعر الأوردر + صافي الشحن) - (الواصل + البيك اب) = <strong>${due}</strong></div>
    </div>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const exportToExcel = () => {
    const statusName = (sid: string) => statuses.find(s => s.id === sid)?.name || '-';
    const data = displayRows.map((r, i) => ({
      '#': i + 1, 'الكود': r.code, 'الاسم': r.name, 'الحالة': statusName(r.status_id),
      'القطع': r.pieces, 'سعر الأوردر': r.amount, 'سعر الشحن': r.shipping,
      'عمولة المندوب': getCourierCommissionForRow(r), 'الصافي للمكتب من الشحن': getOfficeShippingNet(r),
      'الواصل': r.arrived, 'حالة الحساب': getOfficeOutcomeLabel(r),
    }));
    data.push({ '#': '' as any, 'الكود': '', 'الاسم': 'الإجمالي', 'الحالة': '', 'القطع': String(totalPieces), 'سعر الأوردر': String(totalAmount), 'سعر الشحن': String(totalShipping), 'عمولة المندوب': String(totalCourierCommission), 'الصافي للمكتب من الشحن': String(totalOfficeShippingNet), 'الواصل': String(totalArrived), 'حالة الحساب': '' });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقفيلة');
    XLSX.writeFile(wb, `تقفيلة-${officeName}-${closingDate}.xlsx`);
  };

  const shareWhatsApp = () => {
    const statusName = (sid: string) => statuses.find(s => s.id === sid)?.name || '-';
    let text = `📋 *تقفيلة ${officeName}*\n📅 ${format(new Date(closingDate), 'dd/MM/yyyy')}\n━━━━━━━━━━━━━━━━━━\n\n`;
    displayRows.forEach((r, i) => {
      if (r.name || r.code) text += `${i + 1}. ${r.name} | ${r.code} | ${statusName(r.status_id)} | سعر الأوردر: ${r.amount} | شحن: ${r.shipping} | عمولة مندوب: ${getCourierCommissionForRow(r)} | صافي الشحن: ${getOfficeShippingNet(r)} | ${getOfficeOutcomeLabel(r)} | واصل: ${r.arrived}\n`;
    });
    text += `\n━━━━━━━━━━━━━━━━━━\n`;
    text += `📊 *الإجمالي* (${pickupUnits} أوردر)\n`;
    text += `💰 سعر الأوردر: ${totalAmount} | الشحن: ${totalShipping} | عمولة المناديب: ${totalCourierCommission} | صافي الشحن: ${totalOfficeShippingNet} | الواصل: ${totalArrived}\n`;
    text += `📦 البيك اب: ${pickupUnits} × ${pickupRateNum} = ${pickupTotal}\n`;
    text += `✅ المستحق: ${due}\n`;
    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl sm:text-2xl font-bold">تقفيلة المكاتب</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <Input type="date" value={closingDate} onChange={e => setClosingDate(e.target.value)} className="w-40 bg-secondary border-border" />
          <Select value={selectedOffice} onValueChange={setSelectedOffice}>
            <SelectTrigger className="w-[200px] bg-secondary border-border"><SelectValue placeholder="اختر مكتب..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المكاتب</SelectItem>
              {offices.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={addRow} disabled={preventAdd}>
            <Plus className="h-4 w-4 ml-1" />إضافة صف
          </Button>
        </div>
      </div>

      {/* Controls toolbar */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" onClick={saveToDb} disabled={saving || !selectedOffice || selectedOffice === 'all'}>
          <Save className="h-4 w-4 ml-1" />{saving ? 'جاري الحفظ...' : 'حفظ'}
        </Button>
        <Button size="sm" variant={isClosed ? 'default' : 'secondary'} onClick={() => setIsClosed(!isClosed)}>
          {isClosed ? <Unlock className="h-4 w-4 ml-1" /> : <Lock className="h-4 w-4 ml-1" />}
          {isClosed ? 'إعادة فتح' : 'قفل الشيت'}
        </Button>
        <Button size="sm" variant={isLocked ? 'destructive' : 'outline'} onClick={() => setIsLocked(!isLocked)}>
          {isLocked ? <Unlock className="h-4 w-4 ml-1" /> : <Lock className="h-4 w-4 ml-1" />}
          {isLocked ? 'إلغاء التجميد' : 'تجميد'}
        </Button>
        <Button size="sm" variant={preventAdd ? 'secondary' : 'outline'} onClick={() => setPreventAdd(!preventAdd)}>
          {preventAdd ? <Check className="h-4 w-4 ml-1" /> : <Ban className="h-4 w-4 ml-1" />}
          {preventAdd ? 'السماح بالإضافة' : 'منع الإضافة'}
        </Button>
        <Button size="sm" variant="outline" onClick={exportToPDF}>
          <Download className="h-4 w-4 ml-1" /> PDF
        </Button>
        <Button size="sm" variant="outline" onClick={exportToExcel}>
          <Download className="h-4 w-4 ml-1" /> Excel
        </Button>
        <Button size="sm" variant="outline" onClick={shareWhatsApp}>
          <Share2 className="h-4 w-4 ml-1" /> واتساب
        </Button>
      </div>

      {/* Status Filters */}
      {selectedOffice && selectedOffice !== 'all' && (
        <Card className="bg-card border-border">
          <CardContent className="p-3 space-y-2">
            <p className="text-sm font-medium">فلتر حسب الحالة:</p>
            <div className="flex flex-wrap gap-3">
              {statusFilterNames.map(name => (
                <label key={name} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox checked={statusFilters.has(name)} onCheckedChange={() => toggleStatusFilter(name)} />
                  {name}
                </label>
              ))}
            </div>
            {(filterSummary.hasCollectionFilter || filterSummary.hasReturnFilter) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
                {filterSummary.hasCollectionFilter && (
                  <div className="bg-primary/10 rounded-lg p-3">
                    <p className="text-sm font-bold text-primary">التحصيل</p>
                    <p className="text-lg font-bold">{filterSummary.collectionTotal} ج.م</p>
                    <p className="text-xs text-muted-foreground">العمولة (شحن): {filterSummary.collectionShipping} ج.م</p>
                    <p className="text-xs font-medium">الصافي: {filterSummary.collectionTotal - filterSummary.collectionShipping} ج.م</p>
                  </div>
                )}
                {filterSummary.hasReturnFilter && (
                  <div className="bg-destructive/10 rounded-lg p-3">
                    <p className="text-sm font-bold text-destructive">المرتجع</p>
                    <p className="text-lg font-bold">{filterSummary.returnTotal} ج.م</p>
                    <p className="text-xs text-muted-foreground">{filterSummary.returnCount} أوردر مرتجع</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {closingId && (
        <p className="text-xs text-muted-foreground">✅ البيانات محفوظة في قاعدة البيانات</p>
      )}

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-right w-10">#</TableHead>
                  <TableHead className="text-right">الكود</TableHead>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">عدد القطع</TableHead>
                    <TableHead className="text-right">سعر الأوردر</TableHead>
                    <TableHead className="text-right">سعر الشحن</TableHead>
                    <TableHead className="text-right">عمولة المندوب</TableHead>
                    <TableHead className="text-right">الصافي للمكتب من الشحن</TableHead>
                  <TableHead className="text-right">الواصل</TableHead>
                    <TableHead className="text-right">تم التحصيل / تم ارتجاع للراسل</TableHead>
                  <TableHead className="text-right w-10">حذف</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((row, idx) => (
                  <TableRow key={row.id} className="border-border">
                    <TableCell className="text-sm text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <Input value={row.code} onChange={e => updateRow(row.id, 'code', e.target.value)} className="bg-secondary border-border h-8 w-28" placeholder="-" disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Input value={row.name} onChange={e => updateRow(row.id, 'name', e.target.value)} className="bg-secondary border-border h-8 w-36" placeholder="-" disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Select value={row.status_id} onValueChange={(v) => updateRow(row.id, 'status_id', v)} disabled={isLocked}>
                        <SelectTrigger className="bg-secondary border-border h-8 w-36"><SelectValue placeholder="الحالة" /></SelectTrigger>
                        <SelectContent>
                          {statuses.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={row.pieces} onChange={e => updateRow(row.id, 'pieces', e.target.value)} className="bg-secondary border-border h-8 w-24" placeholder="0" disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={row.amount} onChange={e => updateRow(row.id, 'amount', e.target.value)} className="bg-secondary border-border h-8 w-32" placeholder="0" disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={row.shipping} onChange={e => updateRow(row.id, 'shipping', e.target.value)} className="bg-secondary border-border h-8 w-28" placeholder="0" disabled={isLocked} />
                    </TableCell>
                    <TableCell className="font-bold text-sm text-amber-500">{getCourierCommissionForRow(row)} ج.م</TableCell>
                    <TableCell className="font-bold text-sm text-primary">{getOfficeShippingNet(row)} ج.م</TableCell>
                    <TableCell>
                      <Input type="number" value={row.arrived} onChange={e => updateRow(row.id, 'arrived', e.target.value)} className="bg-secondary border-border h-8 w-28" placeholder="0" disabled={isLocked} />
                    </TableCell>
                    <TableCell>
                      <Select value={getOfficeOutcome(row)} onValueChange={(v) => updateOfficeOutcome(row.id, v as 'pending' | 'collected' | 'returned')} disabled={isLocked}>
                        <SelectTrigger className="bg-secondary border-border h-8 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">لم يتم التحديد</SelectItem>
                          <SelectItem value="collected">تم التحصيل</SelectItem>
                          <SelectItem value="returned">تم ارتجاع للراسل</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="text-destructive h-8 w-8" onClick={() => removeRow(row.id)} disabled={rows.length <= 1 || isLocked}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="border-border bg-muted/50">
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell className="font-bold text-sm">{pickupUnits}</TableCell>
                  <TableCell className="font-bold text-sm">{totalPieces}</TableCell>
                  <TableCell className="font-bold text-sm">{totalAmount}</TableCell>
                  <TableCell className="font-bold text-sm">{totalShipping}</TableCell>
                  <TableCell className="font-bold text-sm text-amber-500">{totalCourierCommission}</TableCell>
                  <TableCell className="font-bold text-sm text-primary">{totalOfficeShippingNet}</TableCell>
                  <TableCell className="font-bold text-sm">{totalArrived}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">رقم البيك اب</p>
              <Input type="number" value={pickupRate} onChange={e => setPickupRate(e.target.value)} className="bg-secondary border-border" placeholder="0" disabled={isLocked} />
            </div>
            <div className="text-sm font-medium">البيك اب = {pickupUnits} × {pickupRateNum} = <span className="font-bold">{pickupTotal}</span></div>
            <div className="text-sm font-medium">المستحق = ({totalAmount} + {totalOfficeShippingNet}) - ({totalArrived} + {pickupTotal}) = <span className="font-bold text-primary text-lg">{due}</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
