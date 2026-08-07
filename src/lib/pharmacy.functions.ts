import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PhotoInput = z.object({
  image: z
    .string()
    .startsWith("data:image/")
    .max(8_000_000, "الصورة كبيرة جدًا"),
});

/** يقرأ الاسم التجاري من صورة العلبة ويستنتج الاسم العلمي. */
export const identifyMedicinePhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PhotoInput.parse(input))
  .handler(async ({ data }) => {
    const { readNamePhoto } = await import("./pharmacy.server");
    return await readNamePhoto(data.image);
  });

export const readExpiryPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PhotoInput.parse(input))
  .handler(async ({ data }) => {
    const { readPackPhoto } = await import("./pharmacy.server");
    return await readPackPhoto(data.image);
  });
