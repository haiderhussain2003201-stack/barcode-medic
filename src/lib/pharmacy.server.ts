const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type ProductInfo = {
  trade_name: string | null;
  generic_name: string | null;
  manufacturer: string | null;
  source: string;
};

function key() {
  const k = process.env["LOVABLE_API_KEY"];
  if (!k) throw new Error("MISSING_AI_KEY");
  return k;
}

async function callGateway(body: unknown): Promise<string> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key(),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("NO_CREDITS");
  if (!res.ok) throw new Error(`AI_ERROR_${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

function parseJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Free public product database (UPCitemdb trial) — works for many GTIN/EAN codes. */
async function lookupUpcDb(barcode: string): Promise<ProductInfo | null> {
  try {
    const res = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      items?: Array<{ title?: string; brand?: string; description?: string }>;
    };
    const item = json.items?.[0];
    if (!item?.title) return null;
    return {
      trade_name: item.title,
      generic_name: item.description?.slice(0, 200) ?? null,
      manufacturer: item.brand ?? null,
      source: "upcitemdb",
    };
  } catch {
    return null;
  }
}

/** AI fallback: many pharmaceutical barcodes are national codes not in public DBs. */
async function lookupWithAi(barcode: string): Promise<ProductInfo | null> {
  const content = await callGateway({
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content:
          "You identify pharmaceutical products from their barcode (EAN/GTIN/national drug code). " +
          "Reply with JSON only: {\"trade_name\":string|null,\"generic_name\":string|null,\"manufacturer\":string|null,\"confident\":boolean}. " +
          "trade_name must be the commercial brand name in English. Set every field to null and confident=false if you are not reasonably sure. Never invent a name.",
      },
      { role: "user", content: `Barcode: ${barcode}` },
    ],
  });
  const parsed = parseJson<{
    trade_name?: string | null;
    generic_name?: string | null;
    manufacturer?: string | null;
    confident?: boolean;
  }>(content);
  if (!parsed || !parsed.confident || !parsed.trade_name) return null;
  return {
    trade_name: parsed.trade_name,
    generic_name: parsed.generic_name ?? null,
    manufacturer: parsed.manufacturer ?? null,
    source: "ai",
  };
}

export async function resolveBarcode(barcode: string): Promise<ProductInfo | null> {
  return (await lookupUpcDb(barcode)) ?? (await lookupWithAi(barcode));
}

export type ScanResult = {
  expiry_date: string | null;
  batch: string | null;
  trade_name: string | null;
  barcode: string | null;
};

/** Reads an expiry date (and any visible name/barcode) from a photo of the pack. */
export async function readPackPhoto(imageDataUrl: string): Promise<ScanResult> {
  const content = await callGateway({
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content:
          "You read medicine packaging photos. Return JSON only: " +
          '{"expiry_date": "YYYY-MM-DD" | null, "batch": string|null, "trade_name": string|null, "barcode": string|null}. ' +
          "Find the expiry date (EXP, Exp. Date, Verfall, تاريخ الانتهاء, صلاحية). Ignore the manufacturing date (MFG/MFD/إنتاج). " +
          "If only month and year are printed, use the LAST day of that month. Interpret ambiguous numeric dates as DD/MM/YYYY unless clearly otherwise. " +
          "Use null for anything not clearly visible. No prose.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the expiry date from this pack." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
  const parsed = parseJson<ScanResult>(content);
  const iso = parsed?.expiry_date;
  const valid = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  return {
    expiry_date: valid,
    batch: parsed?.batch ?? null,
    trade_name: parsed?.trade_name ?? null,
    barcode: parsed?.barcode ?? null,
  };
}
