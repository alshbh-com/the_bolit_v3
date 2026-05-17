import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScanLine, Play, CheckCircle2, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import BulkActionsDialog from '@/components/BulkActionsDialog';
import { logActivity } from '@/lib/activityLogger';

interface ScannedOrder {
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
  is_closed: boolean;
  returned_to_sender: boolean;
}

// Web Audio beep
function beep(ok: boolean) {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = ok ? 'sine' : 'square';
    o.frequency.value = ok ? 880 : 220;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    o.start(); o.stop(ctx.currentTime + 0.2);
  } catch {}
}

export default function BarcodeScan() {
  const { user } = useAuth();
  const [active, setActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [orders, setOrders] = useState<ScannedOrder[]>([]);
  const [input, setInput] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [courierMap, setCourierMap] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const idsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const [{ data: st }, { data: cu }] = await Promise.all([
        supabase.from('order_statuses').select('id, name'),
        supabase.from('profiles').select('id, full_name'),
      ]);
      const sm: Record<string, string> = {};
      (st || []).forEach((s: any) => { sm[s.id] = s.name; });
      setStatusMap(sm);
      const cm: Record<string, string> = {};
      (cu || []).forEach((c: any) => { cm[c.id] = c.full_name; });
      setCourierMap(cm);
    })();
  }, []);

  const startSession = async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from('scan_sessions')
      .insert({ user_id: user?.id ?? null, total_count: 0 })
      .select('id')
      .single();
    setBusy(false);
    if (error || !data) { toast.error('فشل بدء الجلسة'); return; }
    setSessionId(data.id);
    setOrders([]);
    idsRef.current = new Set();
    setActive(true);
    setTimeout(() => inputRef.current?.focus(), 100);
    logActivity('scan_session_start', { session_id: data.id });
  };

  const stopScanning = () => {
    setActive(false);
  };

  const finish = async () => {
    if (!sessionId) return;
    if (orders.length === 0) {
      toast.error('لا توجد أوردرات تم اسكانها');
      return;
    }
    await supabase
      .from('scan_sessions')
      .update({ ended_at: new Date().toISOString(), total_count: orders.length })
      .eq('id', sessionId);
    setBulkOpen(true);
  };

  const resetSession = () => {
    setSessionId(null);
    setOrders([]);
    idsRef.current = new Set();
    setActive(false);
    setBulkOpen(false);
  };

  const handleScan = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || !sessionId) return;

    // Search by barcode or tracking_id
    const { data, error } = await supabase
      .from('orders')
      .select('id, barcode, tracking_id, customer_name, customer_phone, address, price, delivery_price, status_id, courier_id, is_closed, returned_to_sender')
      .or(`barcode.eq.${code},tracking_id.eq.${code}`)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      beep(false);
      toast.error(`الأوردر غير موجود: ${code}`);
      return;
    }
    if (idsRef.current.has(data.id)) {
      beep(false);
      toast.warning(`تم اسكان الأوردر من قبل: ${code}`);
      return;
    }
    if (data.is_closed) {
      beep(false);
      toast.error(`الأوردر مقفل بالفعل: ${code}`);
      return;
    }

    // Insert session item
    const { error: insErr } = await supabase
      .from('scan_session_items')
      .insert({ session_id: sessionId, order_id: data.id });
    if (insErr) {
      beep(false);
      toast.error('فشل إضافة الأوردر');
      return;
    }

    idsRef.current.add(data.id);
    const courierName = data.courier_id ? (courierMap[data.courier_id] ?? null) : null;
    const statusName = data.status_id ? (statusMap[data.status_id] ?? null) : null;
    const item: ScannedOrder = {
      id: data.id,
      barcode: data.barcode,
      tracking_id: data.tracking_id,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      address: data.address,
      price: data.price,
      delivery_price: data.delivery_price,
      status_id: data.status_id,
      status_name: statusName,
      courier_id: data.courier_id,
      courier_name: courierName,
      is_closed: data.is_closed,
      returned_to_sender: data.returned_to_sender,
    };
    setOrders(prev => [item, ...prev]);
    beep(true);
    toast.success(`تم اسكان: ${data.barcode ?? code}`);
  }, [sessionId, statusMap, courierMap]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input;
      setInput('');
      if (val.trim()) handleScan(val);
    }
  };

  const removeOne = (id: string) => {
    idsRef.current.delete(id);
    setOrders(prev => prev.filter(o => o.id !== id));
    if (sessionId) {
      supabase.from('scan_session_items').delete().eq('session_id', sessionId).eq('order_id', id);
    }
  };

  // Keep input focused while active
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    }, 1500);
    return () => clearInterval(i);
  }, [active]);

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <ScanLine className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">قراءة الباركود</h1>
            <p className="text-sm text-muted-foreground">barcode scan · bulk operations</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-base px-3 py-1">عدد: {orders.length}</Badge>
      </div>

      {!sessionId && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-6">
            <ScanLine className="h-20 w-20 text-primary opacity-70" />
            <p className="text-muted-foreground text-center max-w-md">
              ابدأ جلسة اسكان جديدة باستخدام جهاز الـ Barcode Scanner أو ادخل الكود يدويًا.
              المسدس يعمل تلقائيًا كـ Keyboard.
            </p>
            <Button size="lg" className="text-lg px-10 py-6" onClick={startSession} disabled={busy}>
              <Play className="h-5 w-5 ml-2" />
              ابدأ الاسكان
            </Button>
          </CardContent>
        </Card>
      )}

      {sessionId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>وضع الاسكان</span>
                {active ? (
                  <Badge className="bg-green-600 hover:bg-green-600">نشط</Badge>
                ) : (
                  <Badge variant="outline">متوقف</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="امسح الباركود هنا..."
                className="h-16 text-2xl text-center font-mono tracking-widest"
                autoFocus
                disabled={!active}
              />
              <div className="flex gap-2 flex-wrap">
                {active ? (
                  <Button variant="outline" onClick={stopScanning}>
                    <X className="h-4 w-4 ml-1" /> إيقاف
                  </Button>
                ) : (
                  <Button onClick={() => { setActive(true); setTimeout(() => inputRef.current?.focus(), 50); }}>
                    <Play className="h-4 w-4 ml-1" /> استئناف
                  </Button>
                )}
                <Button onClick={finish} disabled={orders.length === 0}>
                  <CheckCircle2 className="h-4 w-4 ml-1" /> انتهيت ({orders.length})
                </Button>
                <Button variant="ghost" onClick={resetSession}>إلغاء الجلسة</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>الأوردرات الممسوحة</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {orders.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">لا توجد أوردرات بعد</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الباركود</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>المندوب</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>العنوان</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map(o => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono">{o.barcode || o.tracking_id}</TableCell>
                        <TableCell>{o.customer_name}<div className="text-xs text-muted-foreground">{o.customer_phone}</div></TableCell>
                        <TableCell>{o.courier_name || '-'}</TableCell>
                        <TableCell>{o.status_name || '-'}</TableCell>
                        <TableCell>{Number(o.price || 0).toLocaleString()}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{o.address}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => removeOne(o.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {bulkOpen && sessionId && (
        <BulkActionsDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          orders={orders}
          sessionId={sessionId}
          onDone={resetSession}
        />
      )}
    </div>
  );
}
