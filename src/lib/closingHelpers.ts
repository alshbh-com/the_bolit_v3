import { supabase } from '@/integrations/supabase/client';

export type FinalStatus = 'delivered' | 'returned' | 'postponed' | 'failed' | 'partial';

export interface ClosingItemInput {
  order_id: string;
  final_status: FinalStatus;
  collected_amount: number;
  commission: number;
  shipping: number;
}

export interface ClosingTotals {
  total_orders: number;
  delivered_count: number;
  returned_count: number;
  postponed_count: number;
  failed_count: number;
  total_collected: number;
  courier_commission: number;
  shipping_fees: number;
  net_due: number;
}

export function computeTotals(items: ClosingItemInput[]): ClosingTotals {
  const t: ClosingTotals = {
    total_orders: items.length,
    delivered_count: 0,
    returned_count: 0,
    postponed_count: 0,
    failed_count: 0,
    total_collected: 0,
    courier_commission: 0,
    shipping_fees: 0,
    net_due: 0,
  };
  for (const it of items) {
    if (it.final_status === 'delivered' || it.final_status === 'partial') t.delivered_count++;
    else if (it.final_status === 'returned') t.returned_count++;
    else if (it.final_status === 'postponed') t.postponed_count++;
    else if (it.final_status === 'failed') t.failed_count++;
    t.total_collected += Number(it.collected_amount) || 0;
    t.courier_commission += Number(it.commission) || 0;
    t.shipping_fees += Number(it.shipping) || 0;
  }
  t.net_due = t.total_collected - t.courier_commission;
  return t;
}

export async function getTreasuryBalance(): Promise<number> {
  const { data } = await (supabase as any)
    .from('treasury_transactions')
    .select('balance_after')
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.balance_after ? Number(data[0].balance_after) : 0;
}

export async function addTreasuryTransaction(params: {
  type: 'deposit' | 'withdraw' | 'adjustment';
  source: 'closing' | 'manual' | 'office' | 'other';
  reference_id?: string | null;
  amount: number;
  notes?: string;
  user_id?: string | null;
}) {
  const current = await getTreasuryBalance();
  const delta = params.type === 'withdraw' ? -Math.abs(params.amount) : Math.abs(params.amount);
  const balance_after = current + delta;
  const { data, error } = await (supabase as any)
    .from('treasury_transactions')
    .insert({
      type: params.type,
      source: params.source,
      reference_id: params.reference_id ?? null,
      amount: Math.abs(params.amount),
      balance_after,
      notes: params.notes ?? '',
      created_by: params.user_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function logFinancial(params: {
  entity_type: string;
  entity_id?: string | null;
  action: string;
  before?: any;
  after?: any;
  user_id?: string | null;
}) {
  await (supabase as any).from('financial_logs').insert({
    entity_type: params.entity_type,
    entity_id: params.entity_id ?? null,
    action: params.action,
    before_json: params.before ?? {},
    after_json: params.after ?? {},
    user_id: params.user_id ?? null,
  });
}

export async function upsertCourierWallet(courier_id: string, delta: {
  collected?: number; commission?: number; shortage?: number; surplus?: number; balance?: number;
}) {
  const { data: existing } = await (supabase as any)
    .from('courier_wallets')
    .select('*')
    .eq('courier_id', courier_id)
    .maybeSingle();

  const next = {
    courier_id,
    balance: (Number(existing?.balance) || 0) + (delta.balance || 0),
    total_collected: (Number(existing?.total_collected) || 0) + (delta.collected || 0),
    total_commission: (Number(existing?.total_commission) || 0) + (delta.commission || 0),
    total_shortage: (Number(existing?.total_shortage) || 0) + (delta.shortage || 0),
    total_surplus: (Number(existing?.total_surplus) || 0) + (delta.surplus || 0),
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await (supabase as any).from('courier_wallets').update(next).eq('courier_id', courier_id);
  } else {
    await (supabase as any).from('courier_wallets').insert(next);
  }
}

/**
 * Perform a full daily closing for a courier.
 * - Creates courier_closings row (status closed) with totals
 * - Inserts courier_closing_items
 * - Marks orders is_courier_closed + is_closed + is_settled
 * - Adds deposited amount to treasury
 * - Updates courier wallet
 * - Writes financial_logs
 */
export async function performClosing(opts: {
  courier_id: string;
  closing_date: string; // YYYY-MM-DD
  items: ClosingItemInput[];
  deposited_amount: number;
  notes?: string;
  user_id?: string | null;
}) {
  const totals = computeTotals(opts.items);
  const shortage = Math.max(0, totals.net_due - opts.deposited_amount);
  const surplus = Math.max(0, opts.deposited_amount - totals.net_due);

  // Check for existing closing on same day
  const { data: existing } = await (supabase as any)
    .from('courier_closings')
    .select('id, status')
    .eq('courier_id', opts.courier_id)
    .eq('closing_date', opts.closing_date)
    .maybeSingle();
  if (existing && existing.status === 'closed') {
    throw new Error('يوجد تقفيلة مغلقة بالفعل لهذا المندوب في هذا اليوم');
  }

  const closingPayload: any = {
    courier_id: opts.courier_id,
    closing_date: opts.closing_date,
    status: 'closed',
    ...totals,
    deposited_amount: opts.deposited_amount,
    shortage,
    surplus,
    notes: opts.notes ?? '',
    closed_by: opts.user_id ?? null,
    closed_at: new Date().toISOString(),
  };

  let closingId: string;
  if (existing) {
    const { data, error } = await (supabase as any)
      .from('courier_closings')
      .update(closingPayload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    closingId = data.id;
    await (supabase as any).from('courier_closing_items').delete().eq('closing_id', closingId);
  } else {
    const { data, error } = await (supabase as any)
      .from('courier_closings')
      .insert(closingPayload)
      .select()
      .single();
    if (error) throw error;
    closingId = data.id;
  }

  // Insert items
  if (opts.items.length > 0) {
    const itemRows = opts.items.map(it => ({
      closing_id: closingId,
      order_id: it.order_id,
      final_status: it.final_status,
      collected_amount: it.collected_amount,
      commission: it.commission,
      shipping: it.shipping,
      is_returned: it.final_status === 'returned',
      scanned_at: new Date().toISOString(),
    }));
    const { error: e2 } = await (supabase as any).from('courier_closing_items').insert(itemRows);
    if (e2) throw e2;
  }

  // Update orders
  const orderIds = opts.items.map(i => i.order_id);
  if (orderIds.length > 0) {
    await supabase
      .from('orders')
      .update({ is_courier_closed: true, is_closed: true, is_settled: true } as any)
      .in('id', orderIds);

    // Mark returned ones
    const returnedIds = opts.items.filter(i => i.final_status === 'returned').map(i => i.order_id);
    if (returnedIds.length) {
      await supabase
        .from('orders')
        .update({ returned_to_sender: true } as any)
        .in('id', returnedIds);
    }
  }

  // Treasury deposit
  if (opts.deposited_amount > 0) {
    await addTreasuryTransaction({
      type: 'deposit',
      source: 'closing',
      reference_id: closingId,
      amount: opts.deposited_amount,
      notes: `تقفيلة مندوب — ${opts.closing_date}`,
      user_id: opts.user_id ?? null,
    });
  }

  // Courier wallet
  await upsertCourierWallet(opts.courier_id, {
    collected: totals.total_collected,
    commission: totals.courier_commission,
    shortage,
    surplus,
    balance: totals.courier_commission, // accrued commission owed
  });

  await logFinancial({
    entity_type: 'courier_closing',
    entity_id: closingId,
    action: 'close',
    after: closingPayload,
    user_id: opts.user_id ?? null,
  });

  return { closingId, totals, shortage, surplus };
}

export async function reopenClosing(closing_id: string, user_id?: string | null) {
  const { data: closing } = await (supabase as any)
    .from('courier_closings')
    .select('*, courier_closing_items(order_id)')
    .eq('id', closing_id)
    .single();
  if (!closing) throw new Error('التقفيلة غير موجودة');
  if (closing.status !== 'closed') throw new Error('التقفيلة ليست مغلقة');

  await (supabase as any).from('courier_closings').update({
    status: 'reopened',
    reopened_by: user_id ?? null,
    reopened_at: new Date().toISOString(),
  }).eq('id', closing_id);

  const orderIds = (closing.courier_closing_items || []).map((x: any) => x.order_id);
  if (orderIds.length > 0) {
    await supabase.from('orders').update({
      is_courier_closed: false, is_closed: false, is_settled: false,
    } as any).in('id', orderIds);
  }

  // Reverse treasury deposit
  if (Number(closing.deposited_amount) > 0) {
    await addTreasuryTransaction({
      type: 'withdraw',
      source: 'closing',
      reference_id: closing_id,
      amount: Number(closing.deposited_amount),
      notes: `فتح تقفيلة — ${closing.closing_date}`,
      user_id: user_id ?? null,
    });
  }

  // Reverse wallet
  await upsertCourierWallet(closing.courier_id, {
    collected: -Number(closing.total_collected),
    commission: -Number(closing.courier_commission),
    shortage: -Number(closing.shortage),
    surplus: -Number(closing.surplus),
    balance: -Number(closing.courier_commission),
  });

  await logFinancial({
    entity_type: 'courier_closing',
    entity_id: closing_id,
    action: 'reopen',
    before: closing,
    user_id: user_id ?? null,
  });
}
