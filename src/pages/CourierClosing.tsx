import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Lock, Scan, RefreshCw, Save } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { performClosing, computeTotals, type FinalStatus, type ClosingItemInput } from '@/lib/closingHelpers';

interface OrderRow {
  id: string;
  tracking_id: string;
  barcode: string;
  customer_name: string;
  customer_phone: string;
  price: number;
  delivery_price: number;
  address: string;
}

interface Line extends ClosingItemInput {
  order: OrderRow;
}

const STATUS_LABEL: Record<FinalStatus, string> = {
  delivered: 'مسلم',
  partial: 'جزئي',
  returned: 'مرتجع',
  postponed: 'مؤجل',
  failed: 'فاشل',
};

export default function CourierClosing() {
  const { user } = useAuth();
  const [couriers, setCouriers] = useState<any[]>([]);
  const [courierId, setCourierId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lines, setLines] = useState<Map<string, Line>>(new Map());
  const [deposited, setDeposited] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [defaultCommission, setDefaultCommission] = useState(0);

  useEffect(() => { loadCouriers(); }, []);
  useEffect(() => { if (courierId) loadOrders(); }, [courierId]);

  const loadCouriers = async () => {
    const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'courier');
    if (!roles?.length) return;
    const ids = roles.map(r => r.user_id);
    const { data } = await supabase.from('profiles').select('id, full_name, commission_amount').in('id', ids);
    setCouriers(data || []);
  };

  const loadOrders = async () => {
    const courier = couriers.find(c => c.id === courierId);
    setDefaultCommission(Number(courier?.commission_amount) || 0);
    const { data } = await supabase
      .from('orders')
      .select('id, tracking_id, barcode, customer_name, customer_phone, price, delivery_price, address')
      .eq('courier_id', courierId)
      .eq('is_courier_closed', false)
      .eq('is_closed', false)
      .order('created_at', { ascending: false });
    setOrders((data as any) || []);
    // Default: every order = delivered, full price, default commission
    const m = new Map<string, Line>();
    (data || []).forEach((o: any) => {
      m.set(o.id, {
        order: o,
        order_id: o.id,
        final_status: 'delivered',
        collected_amount: Number(o.price) + Number(o.delivery_price),
        commission: Number(courier?.commission_amount) || 0,
        shipping: Number(o.delivery_price) || 0,
      });
    });
    setLines(m);
  };

  const setLineField = (id: string, patch: Partial<Line>) => {
    setLines(prev => {
      const n = new Map(prev);
      const cur = n.get(id);
      if (!cur) return prev;
      const next = { ...cur, ...patch } as Line;
      // Auto: returned/failed/postponed -> 0 collected
      if (patch.final_status && ['returned', 'failed', 'postponed'].includes(patch.final_status)) {
        next.collected_amount = 0;
      } else if (patch.final_status === 'delivered') {
        next.collected_amount = Number(cur.order.price) + Number(cur.order.delivery_price);
      }
      n.set(id, next);
      return n;
    });
  };

  const handleScan = (code: string) => {
    const trimmed = (code || '').trim();
    const match = orders.find(o =>
      o.barcode === trimmed || o.tracking_id === trimmed ||
      o.barcode === trimmed.replace(/^TP-/, '') ||
      o.tracking_id === `TP-${trimmed}`
    );
    if (!match) { toast.error('الباركود غير موجود في أوردرات هذا المندوب'); return; }
    setLineField(match.id, { final_status: 'delivered' });
    toast.success(`تم تأكيد ${match.tracking_id}`);
    // Scroll to row
    const el = document.getElementById(`row-${match.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const totals = useMemo(() => computeTotals(Array.from(lines.values())), [lines]);
  const shortage = Math.max(0, totals.net_due - deposited);
  const surplus = Math.max(0, deposited - totals.net_due);

  const submit = async () => {
    if (!courierId) { toast.error('اختر مندوب'); return; }
    if (lines.size === 0) { toast.error('لا يوجد أوردرات'); return; }
    if (!confirm(`هل تريد تقفيل ${lines.size} أوردر؟ هذه العملية تقفل الأوردرات وتدخل ${deposited} ج.م للخزنة.`)) return;
    setBusy(true);
    try {
      const res = await performClosing({
        courier_id: courierId,
        closing_date: date,
        items: Array.from(lines.values()).map(({ order, ...rest }) => rest),
        deposited_amount: deposited,
        notes,
        user_id: user?.id ?? null,
      });
      toast.success(`تم التقفيل — صافي ${res.totals.net_due.toFixed(2)} ج.م، عجز ${res.shortage.toFixed(2)}، زيادة ${res.surplus.toFixed(2)}`);
      setLines(new Map()); setOrders([]); setDeposited(0); setNotes('');
      loadOrders();
    } catch (e: any) {
      toast.error(e.message || 'فشل التقفيل');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl sm:text-2xl font-bold neon-text">التقفيل اليومي للمندوب</h1>
        <div className="flex gap-2">
          <BarcodeScanner onScan={handleScan} trigger={
            <Button variant="outline" className="neon-border"><Scan className="h-4 w-4 ml-1" />مسح باركود</Button>
          } />
          <Button variant="outline" onClick={loadOrders} disabled={!courierId}><RefreshCw className="h-4 w-4 ml-1" />تحديث</Button>
        </div>
      </div>

      <Card className="glass-effect border-primary/30">
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="space-y-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">المندوب</label>
            <Select value={courierId} onValueChange={setCourierId}>
              <SelectTrigger><SelectValue placeholder="اختر مندوب" /></SelectTrigger>
              <SelectContent>{couriers.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">التاريخ</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">المسلم للخزنة (ج.م)</label>
            <Input type="number" value={deposited} onChange={e => setDeposited(Number(e.target.value) || 0)} className="w-40 font-mono-neon" />
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">ملاحظات</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {[
          ['الأوردرات', totals.total_orders, 'primary'],
          ['مسلم', totals.delivered_count, 'lime'],
          ['مرتجع', totals.returned_count, 'magenta'],
          ['مؤجل', totals.postponed_count, 'yellow'],
          ['التحصيل', totals.total_collected.toFixed(0), 'primary'],
          ['العمولة', totals.courier_commission.toFixed(0), 'magenta'],
          ['الصافي', totals.net_due.toFixed(0), 'lime'],
          [shortage > 0 ? 'عجز' : 'زيادة', (shortage || surplus).toFixed(0), shortage > 0 ? 'magenta' : 'lime'],
        ].map(([label, val], i) => (
          <Card key={i} className="glass-effect border-border">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground">{label as string}</div>
              <div className={`text-lg font-bold font-mono-neon neon-text${(val as any) && (label === 'عجز' ? '-magenta' : '')}`}>{val}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-effect border-border">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الباركود</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead className="hidden md:table-cell">العنوان</TableHead>
                <TableHead>السعر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>المحصل</TableHead>
                <TableHead>العمولة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {courierId ? 'لا توجد أوردرات مفتوحة لهذا المندوب' : 'اختر مندوب لعرض أوردراته'}
                </TableCell></TableRow>
              ) : orders.map(o => {
                const line = lines.get(o.id);
                if (!line) return null;
                return (
                  <TableRow key={o.id} id={`row-${o.id}`} className="border-border">
                    <TableCell className="font-mono text-xs">{o.tracking_id || o.barcode}</TableCell>
                    <TableCell className="text-sm">{o.customer_name}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs max-w-[200px] truncate">{o.address}</TableCell>
                    <TableCell className="text-sm font-mono">{Number(o.price) + Number(o.delivery_price)}</TableCell>
                    <TableCell>
                      <Select value={line.final_status} onValueChange={(v: FinalStatus) => setLineField(o.id, { final_status: v })}>
                        <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(STATUS_LABEL) as FinalStatus[]).map(s => (
                            <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={line.collected_amount} onChange={e => setLineField(o.id, { collected_amount: Number(e.target.value) || 0 })} className="w-24 h-8 font-mono-neon" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={line.commission} onChange={e => setLineField(o.id, { commission: Number(e.target.value) || 0 })} className="w-20 h-8 font-mono-neon" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 sticky bottom-2">
        <Button size="lg" onClick={submit} disabled={busy || !courierId || lines.size === 0} className="gradient-neon shadow-glow">
          <Lock className="h-5 w-5 ml-2" />
          {busy ? 'جاري التقفيل...' : 'إغلاق وتقفيل اليوم'}
        </Button>
      </div>
    </div>
  );
}
