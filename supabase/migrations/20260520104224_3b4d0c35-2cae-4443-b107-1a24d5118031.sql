-- Detach orders from "لا يرد" statuses, then remove those statuses
UPDATE public.orders
SET status_id = NULL
WHERE status_id IN (SELECT id FROM public.order_statuses WHERE name IN ('لا يرد','لايرد'));

DELETE FROM public.order_statuses WHERE name IN ('لا يرد','لايرد');

-- Add new statuses if they don't already exist
INSERT INTO public.order_statuses (name, color, sort_order)
SELECT 'الرقم غلط', '#ef4444', COALESCE((SELECT MAX(sort_order) FROM public.order_statuses), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.order_statuses WHERE name = 'الرقم غلط');

INSERT INTO public.order_statuses (name, color, sort_order)
SELECT 'مغلق', '#6b7280', COALESCE((SELECT MAX(sort_order) FROM public.order_statuses), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.order_statuses WHERE name = 'مغلق');