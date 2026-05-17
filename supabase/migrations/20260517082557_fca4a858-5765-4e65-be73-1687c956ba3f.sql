
CREATE TABLE IF NOT EXISTS public.courier_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id UUID NOT NULL,
  closing_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'open',
  total_orders INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  returned_count INTEGER NOT NULL DEFAULT 0,
  postponed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_collected NUMERIC NOT NULL DEFAULT 0,
  courier_commission NUMERIC NOT NULL DEFAULT 0,
  shipping_fees NUMERIC NOT NULL DEFAULT 0,
  deposited_amount NUMERIC NOT NULL DEFAULT 0,
  shortage NUMERIC NOT NULL DEFAULT 0,
  surplus NUMERIC NOT NULL DEFAULT 0,
  net_due NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  closed_by UUID,
  closed_at TIMESTAMPTZ,
  reopened_by UUID,
  reopened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (courier_id, closing_date)
);
CREATE INDEX IF NOT EXISTS idx_courier_closings_courier ON public.courier_closings(courier_id);
CREATE INDEX IF NOT EXISTS idx_courier_closings_date ON public.courier_closings(closing_date);
CREATE INDEX IF NOT EXISTS idx_courier_closings_status ON public.courier_closings(status);
ALTER TABLE public.courier_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_closings_all ON public.courier_closings;
CREATE POLICY courier_closings_all ON public.courier_closings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.courier_closing_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id UUID NOT NULL REFERENCES public.courier_closings(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  final_status TEXT NOT NULL DEFAULT 'delivered',
  collected_amount NUMERIC NOT NULL DEFAULT 0,
  commission NUMERIC NOT NULL DEFAULT 0,
  shipping NUMERIC NOT NULL DEFAULT 0,
  is_returned BOOLEAN NOT NULL DEFAULT false,
  scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (closing_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_closing_items_closing ON public.courier_closing_items(closing_id);
CREATE INDEX IF NOT EXISTS idx_closing_items_order ON public.courier_closing_items(order_id);
ALTER TABLE public.courier_closing_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_closing_items_all ON public.courier_closing_items;
CREATE POLICY courier_closing_items_all ON public.courier_closing_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.treasury_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'deposit',
  source TEXT NOT NULL DEFAULT 'manual',
  reference_id UUID,
  amount NUMERIC NOT NULL DEFAULT 0,
  balance_after NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treasury_created ON public.treasury_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_type ON public.treasury_transactions(type);
CREATE INDEX IF NOT EXISTS idx_treasury_source ON public.treasury_transactions(source);
ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS treasury_transactions_all ON public.treasury_transactions;
CREATE POLICY treasury_transactions_all ON public.treasury_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.financial_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  before_json JSONB DEFAULT '{}'::jsonb,
  after_json JSONB DEFAULT '{}'::jsonb,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_logs_entity ON public.financial_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fin_logs_created ON public.financial_logs(created_at);
ALTER TABLE public.financial_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_logs_all ON public.financial_logs;
CREATE POLICY financial_logs_all ON public.financial_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.courier_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id UUID NOT NULL UNIQUE,
  balance NUMERIC NOT NULL DEFAULT 0,
  total_collected NUMERIC NOT NULL DEFAULT 0,
  total_commission NUMERIC NOT NULL DEFAULT 0,
  total_shortage NUMERIC NOT NULL DEFAULT 0,
  total_surplus NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.courier_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_wallets_all ON public.courier_wallets;
CREATE POLICY courier_wallets_all ON public.courier_wallets FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS qr_value TEXT;

CREATE OR REPLACE FUNCTION public.generate_order_barcode()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.barcode IS NULL OR NEW.barcode = '' THEN
    NEW.barcode := nextval('public.order_barcode_seq')::TEXT;
  END IF;
  IF NEW.tracking_id IS NULL OR NEW.tracking_id = '' THEN
    NEW.tracking_id := 'TP-' || NEW.barcode;
  END IF;
  IF NEW.qr_value IS NULL OR NEW.qr_value = '' THEN
    NEW.qr_value := NEW.tracking_id;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.orders SET qr_value = tracking_id WHERE qr_value IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_qr_value ON public.orders(qr_value);
CREATE INDEX IF NOT EXISTS idx_orders_tracking_id ON public.orders(tracking_id);
CREATE INDEX IF NOT EXISTS idx_orders_barcode ON public.orders(barcode);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_closings_touch ON public.courier_closings;
CREATE TRIGGER trg_closings_touch BEFORE UPDATE ON public.courier_closings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
