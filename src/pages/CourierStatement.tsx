import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function CourierStatement() {
  const [couriers, setCouriers] = useState<any[]>([]);
  const [courierId, setCourierId] = useState('');
  const [wallet, setWallet] = useState<any>(null);
  const [closings, setClosings] = useState<any[]>([]);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (courierId) loadStatement(); }, [courierId]);

  const load = async () => {
    const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'courier');
    if (!roles?.length) return;
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', roles.map(r => r.user_id));
    setCouriers(data || []);
  };

  const loadStatement = async () => {
    const [w, c] = await Promise.all([
      (supabase as any).from('courier_wallets').select('*').eq('courier_id', courierId).maybeSingle(),
      (supabase as any).from('courier_closings').select('*').eq('courier_id', courierId).order('closing_date', { ascending: false }),
    ]);
    setWallet(w.data); setClosings(c.data || []);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold neon-text">كشف حساب المندوب</h1>

      <Card className="glass-effect border-border">
        <CardContent className="p-3">
          <Select value={courierId} onValueChange={setCourierId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="اختر مندوب" /></SelectTrigger>
            <SelectContent>{couriers.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      {wallet && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            ['الرصيد', wallet.balance],
            ['إجمالي التحصيل', wallet.total_collected],
            ['إجمالي العمولة', wallet.total_commission],
            ['إجمالي العجز', wallet.total_shortage],
            ['إجمالي الزيادة', wallet.total_surplus],
          ].map(([l, v], i) => (
            <Card key={i} className="glass-effect border-border">
              <CardContent className="p-3 text-center">
                <div className="text-xs text-muted-foreground">{l as string}</div>
                <div className="text-lg font-bold font-mono-neon neon-text">{Number(v).toFixed(2)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="glass-effect border-border">
        <CardHeader><CardTitle className="text-base">سجل التقفيلات</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>الأوردرات</TableHead><TableHead>التحصيل</TableHead>
              <TableHead>العمولة</TableHead><TableHead>المسلم</TableHead><TableHead>عجز</TableHead><TableHead>زيادة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {closings.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">اختر مندوب</TableCell></TableRow>
              ) : closings.map((r: any) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-mono text-xs">{r.closing_date}</TableCell>
                  <TableCell className="font-mono">{r.total_orders}</TableCell>
                  <TableCell className="font-mono">{Number(r.total_collected).toFixed(0)}</TableCell>
                  <TableCell className="font-mono">{Number(r.courier_commission).toFixed(0)}</TableCell>
                  <TableCell className="font-mono">{Number(r.deposited_amount).toFixed(0)}</TableCell>
                  <TableCell className="font-mono text-secondary">{Number(r.shortage).toFixed(0)}</TableCell>
                  <TableCell className="font-mono text-accent">{Number(r.surplus).toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
