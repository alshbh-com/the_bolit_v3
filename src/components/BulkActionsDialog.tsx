import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { logActivity } from '@/lib/activityLogger';
import { Lock, Undo2, UserPlus, UserMinus, FileSpreadsheet, FileText, Printer, Tag } from 'lucide-react';

interface OrderLite {
  id: string;
  barcode: string | null;
  tracking_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  price: number | null;
  delivery_price: number | null;
  status_id: string | null;
  status_name?: string | null;
  courier_id: string | null;
  courier_name?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: OrderLite[];
  sessionId: string;
  onDone: () => void;
}

export default function BulkActionsDialog({ open, onOpenChange, orders, sessionId, onDone }: Props) {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<{ id: string; name: string }[]>([]);
  const [couriers, setCouriers] = useState<{ id: string; full_name: string }[]>([]);
  const [newStatusId, setNewStatusId] = useState<string>('');
  const [newCourierId, setNewCourierId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: st }, { data: cu }] = await Promise.all([
        supabase.from('order_statuses').select('id, name').order('sort_order'),
        supabase.from('profiles').select('id, full_name'),
      ]);
      setStatuses((st || []) as any);
      setCouriers((cu || []).filter((c: any) => c.full_name) as any);
    })();
  }, [open]);

  const ids = orders.map(o => o.id);

  const applyStatus = async () => {
    if (!newStatusId) { toast.error('اختر حالة'); return; }
    setBusy(true);
    const { error } = await supabase
      .from('orders')
      .update({ status_id: newStatusId })
      .in('id', ids);
    if (error) { setBusy(false); toast.error('فشل تحديث الحالة'); return; }
    
    const hist = orders.map(o => ({
      order_id: o.id,
      old_status_id: o.status_id,
      new_status_id: newStatusId,
      changed_by: user?.id ?? null,
      source: 'scan_bulk',
    }));
    await supabase.from('order_status_history').insert(hist);
    await logActivity('bulk_status_update', { session_id: sessionId, count: ids.length, new_status_id: newStatusId });
    setBusy(false);
    toast.success(`تم تحديث ${ids.length} أوردر`);
  };

  const closeAll = async () => {
    setBusy(true);
    const { error } = await supabase.from('orders').update({ is_closed: true }).in('id', ids);
    setBusy(false);
    if (error) return toast.error('فشل القفل');
    await logActivity('bulk_close', { session_id: sessionId, count: ids.length });
    toast.success(`تم قفل ${ids.length} أوردر`);
  };

  const returnAll = async () => {
    setBusy(true);
    const { error } = await supabase.from('orders').update({ returned_to_sender: true }).in('id', ids);
    setBusy(false);
    if (error) return toast.error('فشل التحديث');
    await logActivity('bulk_return_to_sender', { session_id: sessionId, count: ids.length });
    toast.success(`تم تعليم ${ids.length} كمرتجع للراسل`);
  };

  const assignCourier = async () => {
    if (!newCourierId) { toast.error('اختر مندوب'); return; }
    setBusy(true);
    const { error } = await supabase.from('orders').update({ courier_id: newCourierId }).in('id', ids);
    setBusy(false);
    if (error) return toast.error('فشل التعيين');
    await logActivity('bulk_assign_courier', { session_id: sessionId, count: ids.length, courier_id: newCourierId });
    toast.success('تم تعيين المندوب');
  };

  const unassignCourier = async () => {
    setBusy(true);
    const { error } = await supabase.from('orders').update({ courier_id: null }).in('id', ids);
    setBusy(false);
    if (error) return toast.error('فشل الإلغاء');
    await logActivity('bulk_unassign_courier', { session_id: sessionId, count: ids.length });
    toast.success('تم إلغاء التعيين');
  };

  const exportExcel = () => {
    const rows = orders.map(o => ({
      الباركود: o.barcode || o.tracking_id || '',
      العميل: o.customer_name || '',
      الهاتف: o.customer_phone || '',
      العنوان: o.address || '',
      المبلغ: o.price || 0,
      'سعر التوصيل': o.delivery_price || 0,
      المندوب: o.courier_name || '',
      الحالة: o.status_name || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scan');
    XLSX.writeFile(wb, `scan-session-${sessionId.slice(0, 8)}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Scan Session - ${orders.length} orders`, 14, 16);
    doc.setFontSize(10);
    let y = 28;
    orders.forEach((o, i) => {
      const line = `${i + 1}. ${o.barcode || o.tracking_id} | ${o.customer_name || ''} | ${o.price || 0}`;
      doc.text(line, 14, y);
      y += 6;
      if (y > 280) { doc.addPage(); y = 16; }
    });
    doc.save(`scan-session-${sessionId.slice(0, 8)}.pdf`);
  };

  const printStickers = () => {
    const codes = orders.map(o => o.barcode || o.tracking_id).filter(Boolean) as string[];
    if (codes.length === 0) return toast.error('لا توجد أكواد للطباعة');
    const qs = encodeURIComponent(codes.join(','));
    window.open(`/print?codes=${qs}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>الأوامر الجماعية ({orders.length} أوردر)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border rounded-md p-3 space-y-2">
            <Label className="font-semibold">تغيير الحالة</Label>
            <div className="flex gap-2">
              <Select value={newStatusId} onValueChange={setNewStatusId}>
                <SelectTrigger><SelectValue placeholder="اختر الحالة الجديدة" /></SelectTrigger>
                <SelectContent>
                  {statuses.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={applyStatus} disabled={busy}>تطبيق</Button>
            </div>
          </div>

          <div className="border rounded-md p-3 space-y-2">
            <Label className="font-semibold">المندوب</Label>
            <div className="flex gap-2 flex-wrap">
              <Select value={newCourierId} onValueChange={setNewCourierId}>
                <SelectTrigger className="min-w-[200px]"><SelectValue placeholder="اختر مندوب" /></SelectTrigger>
                <SelectContent>
                  {couriers.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={assignCourier} disabled={busy}><UserPlus className="h-4 w-4 ml-1" />تعيين</Button>
              <Button variant="outline" onClick={unassignCourier} disabled={busy}><UserMinus className="h-4 w-4 ml-1" />إلغاء التعيين</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={closeAll} disabled={busy}>
              <Lock className="h-4 w-4 ml-1" /> قفل الأوردرات
            </Button>
            <Button variant="outline" onClick={returnAll} disabled={busy}>
              <Undo2 className="h-4 w-4 ml-1" /> ارتجاع للراسل
            </Button>
            <Button variant="outline" onClick={printStickers}>
              <Printer className="h-4 w-4 ml-1" /> طباعة ستيكرات
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Tag className="h-4 w-4 ml-1" /> طباعة الصفحة
            </Button>
            <Button variant="outline" onClick={exportExcel}>
              <FileSpreadsheet className="h-4 w-4 ml-1" /> تصدير Excel
            </Button>
            <Button variant="outline" onClick={exportPDF}>
              <FileText className="h-4 w-4 ml-1" /> تصدير PDF
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إغلاق</Button>
          <Button onClick={() => { onOpenChange(false); onDone(); toast.success('تم إنهاء الجلسة'); }}>
            إنهاء الجلسة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
