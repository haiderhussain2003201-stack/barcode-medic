CREATE TABLE public.medicines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  barcode TEXT,
  trade_name TEXT NOT NULL,
  generic_name TEXT,
  manufacturer TEXT,
  expiry_date DATE,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicines TO authenticated;
GRANT ALL ON public.medicines TO service_role;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own medicines" ON public.medicines FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX medicines_user_expiry_idx ON public.medicines (user_id, expiry_date);
CREATE INDEX medicines_barcode_idx ON public.medicines (barcode);

CREATE TABLE public.barcode_cache (
  barcode TEXT NOT NULL PRIMARY KEY,
  trade_name TEXT NOT NULL,
  generic_name TEXT,
  manufacturer TEXT,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.barcode_cache TO authenticated;
GRANT ALL ON public.barcode_cache TO service_role;
ALTER TABLE public.barcode_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read barcode cache" ON public.barcode_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can add barcode cache" ON public.barcode_cache FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update barcode cache" ON public.barcode_cache FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_medicines_updated_at BEFORE UPDATE ON public.medicines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();