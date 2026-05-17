import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Unlock, Eye } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { reopenClosing } from '@/lib/closingHelpers';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function ClosingsArchive() {
  const { isOwner, user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState<any>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const ch = (supabase as any)
      .channel('closings-archive')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courier_closings' }, () => load())
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, []);

  const load = async () => {
    let q = (supabase as any).from('courier_closings').select('*').order('closing_date', { ascending: false }).limit(500);
    if (from) q = q.gte('closing_date', from);
    if (to) q = q.lte('closing_date', to);
    const { data } = await q;
    setRows(data || []);
    const ids = Array.from(new Set((data || []).map((r: any) => r.courier_id).filter(Boolean)));
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('id, full_name').in('id', ids as string[]);
      const m: Record<string, string> = {};
      (p || []).forEach(x => { m[x.id] = x.full_name; });
      setProfiles(m);
    }
  };

  const openView = async (row: any) => {
    setViewing(row);
    const { data } = await (supabase as any).from('courier_closing_items').select('*').eq('closing_id', row.id);
    setViewItems(data || []);
  };

  const handleReopen = async (id: string) => {
    if (!confirm('هل تريد فتح هذه التقفيلة؟ سيتم إرجاع الأوردرات وعكس حركة الخزنة.')) return;
    try {
      await reopenClosing(id, user?.id);
      toast.success('تم فتح التقفيلة');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold neon-text">أرشيف التقفيلات</h1>

      <Card className="glass-effect border-border">
        <CardContent className="p-3 flex gap-2 items-end flex-wrap">
          <div><label className="text-xs">من</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs">إلى</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button onClick={load}>فلترة</Button>
        </CardContent>
      </Card>

      <Card className="glass-effect border-border">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>المندوب</TableHead>
                <TableHead>الأوردرات</TableHead>
                <TableHead>مسلم</TableHead>
                <TableHead>مرتجع</TableHead>
                <TableHead>التحصيل</TableHead>
                <TableHead>العمولة</TableHead>
                <TableHead>المسلم للخزنة</TableHead>
                <TableHead>عجز/زيادة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">لا توجد تقفيلات</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-mono text-xs">{r.closing_date}</TableCell>
                  <TableCell>{profiles[r.courier_id] || '-'}</TableCell>
                  <TableCell className="font-mono">{r.total_orders}</TableCell>
                  <TableCell className="font-mono text-accent">{r.delivered_count}</TableCell>
                  <TableCell className="font-mono text-secondary">{r.returned_count}</TableCell>
                  <TableCell className="font-mono">{Number(r.total_collected).toFixed(0)}</TableCell>
                  <TableCell className="font-mono">{Number(r.courier_commission).toFixed(0)}</TableCell>
                  <TableCell className="font-mono">{Number(r.deposited_amount).toFixed(0)}</TableCell>
                  <TableCell className="font-mono">
                    {Number(r.shortage) > 0
                      ? <span className="text-secondary">- {Number(r.shortage).toFixed(0)}</span>
                      : <span className="text-accent">+ {Number(r.surplus).toFixed(0)}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'closed' ? 'default' : 'outline'}>{r.status === 'closed' ? 'مقفلة' : r.status === 'reopened' ? 'مفتوحة' : 'مفتوحة'}</Badge>
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openView(r)}><Eye className="h-4 w-4" /></Button>
                    {isOwner && r.status === 'closed' && (
                      <Button size="icon" variant="ghost" onClick={() => handleReopen(r.id)} title="فتح التقفيلة">
                        <Unlock className="h-4 w-4 text-secondary" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>تفاصيل التقفيلة — {viewing?.closing_date}</DialogTitle></DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الأوردر</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المحصل</TableHead>
                  <TableHead>العمولة</TableHead>
                  <TableHead>الشحن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewItems.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.order_id.slice(0, 8)}</TableCell>
                    <TableCell>{i.final_status}</TableCell>
                    <TableCell className="font-mono">{Number(i.collected_amount).toFixed(0)}</TableCell>
                    <TableCell className="font-mono">{Number(i.commission).toFixed(0)}</TableCell>
                    <TableCell className="font-mono">{Number(i.shipping).toFixed(0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
