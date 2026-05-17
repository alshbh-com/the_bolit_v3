import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wallet, Plus, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { addTreasuryTransaction, getTreasuryBalance } from '@/lib/closingHelpers';

export default function Treasury() {
  const { user, isOwner } = useAuth();
  const [txns, setTxns] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [type, setType] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState('');

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const ch = (supabase as any).channel('treasury')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'treasury_transactions' }, () => load())
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, []);

  const load = async () => {
    const { data } = await (supabase as any).from('treasury_transactions')
      .select('*').order('created_at', { ascending: false }).limit(500);
    setTxns(data || []);
    setBalance(await getTreasuryBalance());
  };

  const submit = async () => {
    if (amount <= 0) { toast.error('أدخل مبلغ صحيح'); return; }
    try {
      await addTreasuryTransaction({ type, source: 'manual', amount, notes, user_id: user?.id });
      toast.success('تم تسجيل العملية');
      setAmount(0); setNotes('');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold neon-text flex items-center gap-2"><Wallet className="h-6 w-6" /> الخزنة</h1>
      </div>

      <Card className="glass-effect border-primary/40 shadow-glow">
        <CardContent className="p-6 text-center">
          <div className="text-sm text-muted-foreground tracking-[0.3em] uppercase">CURRENT BALANCE</div>
          <div className="text-5xl font-bold font-mono-neon neon-text mt-2">{balance.toFixed(2)} <span className="text-xl">ج.م</span></div>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="glass-effect border-border">
          <CardHeader><CardTitle className="text-base">عملية يدوية</CardTitle></CardHeader>
          <CardContent className="flex gap-2 flex-wrap items-end">
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="deposit">إيداع</SelectItem>
                <SelectItem value="withdraw">سحب</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} className="w-32" placeholder="المبلغ" />
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظات" className="flex-1 min-w-[200px]" />
            <Button onClick={submit} className="gradient-neon">
              {type === 'deposit' ? <Plus className="h-4 w-4 ml-1" /> : <Minus className="h-4 w-4 ml-1" />}
              تسجيل
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="glass-effect border-border">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الرصيد بعد</TableHead>
                <TableHead>ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
              ) : txns.map(t => (
                <TableRow key={t.id} className="border-border">
                  <TableCell className="text-xs">{new Date(t.created_at).toLocaleString('ar-EG')}</TableCell>
                  <TableCell>
                    <span className={t.type === 'deposit' ? 'text-accent' : 'text-secondary'}>
                      {t.type === 'deposit' ? 'إيداع' : t.type === 'withdraw' ? 'سحب' : 'تعديل'}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{t.source}</TableCell>
                  <TableCell className="font-mono">{t.type === 'withdraw' ? '-' : '+'} {Number(t.amount).toFixed(2)}</TableCell>
                  <TableCell className="font-mono font-bold">{Number(t.balance_after).toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
