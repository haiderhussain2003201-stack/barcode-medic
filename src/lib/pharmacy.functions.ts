import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BarcodeInput = z.object({ barcode: z.string().trim().min(4).max(64) });
const PhotoInput = z.object({
  image: z
    .string()
    .startsWith("data:image/")
    .max(8_000_000, "الصورة كبيرة جدًا"),
});

export const lookupBarcode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BarcodeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: cached } = await supabase
      .from("barcode_cache")
      .select("trade_name, generic_name, manufacturer, source")
      .eq("barcode", data.barcode)
      .maybeSingle();
    if (cached) return { found: true as const, ...cached, cached: true };

    const { resolveBarcode } = await import("./pharmacy.server");
    const info = await resolveBarcode(data.barcode);
    if (!info?.trade_name) return { found: false as const };

    await supabase.from("barcode_cache").upsert({
      barcode: data.barcode,
      trade_name: info.trade_name,
      generic_name: info.generic_name,
      manufacturer: info.manufacturer,
      source: info.source,
    });
    return { found: true as const, ...info, cached: false };
  });

export const readExpiryPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PhotoInput.parse(input))
  .handler(async ({ data }) => {
    const { readPackPhoto } = await import("./pharmacy.server");
    return await readPackPhoto(data.image);
  });

export const saveBarcodeName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        barcode: z.string().trim().min(4).max(64),
        trade_name: z.string().trim().min(1).max(200),
        generic_name: z.string().trim().max(200).nullable().optional(),
        manufacturer: z.string().trim().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await context.supabase.from("barcode_cache").upsert({
      barcode: data.barcode,
      trade_name: data.trade_name,
      generic_name: data.generic_name ?? null,
      manufacturer: data.manufacturer ?? null,
      source: "manual",
    });
    return { ok: true };
  });
