const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

export type NameResult = {
  trade_name: string | null;
  generic_name: string | null;
  expiry_date: string | null;
};

/** يقرأ الاسم التجاري من صورة العلبة ثم يستنتج الاسم العلمي (المادة الفعالة). */
export async function readNamePhoto(imageDataUrl: string): Promise<NameResult> {
  const content = await callGateway({
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content:
          "You read photos of medicine packaging. Return JSON only: " +
          '{"trade_name": string|null, "generic_name": string|null, "expiry_date": "YYYY-MM-DD"|null}. ' +
          "trade_name is the commercial brand name printed on the pack. " +
          "generic_name is the active pharmaceutical ingredient (INN) — infer it from your pharmaceutical knowledge of the brand even if it is not printed, including strength if visible (e.g. 'Paracetamol 500mg'). " +
          "If a clear expiry date (EXP) is visible, return it; ignore manufacturing dates (MFG). If only month/year, use the last day of that month. " +
          "Use null for anything you are not reasonably sure about. Never invent a brand name. No prose.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Read the medicine name from this pack." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
  const parsed = parseJson<NameResult>(content);
  const iso = parsed?.expiry_date;
  return {
    trade_name: parsed?.trade_name ?? null,
    generic_name: parsed?.generic_name ?? null,
    expiry_date: typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null,
  };
}

export type ScanResult = {
  expiry_date: string | null;
  batch: string | null;
  trade_name: string | null;
};

/** Reads an expiry date (and any visible name) from a photo of the pack. */
export async function readPackPhoto(imageDataUrl: string): Promise<ScanResult> {
  const content = await callGateway({
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content:
          "You read medicine packaging photos. Return JSON only: " +
          '{"expiry_date": "YYYY-MM-DD" | null, "batch": string|null, "trade_name": string|null}. ' +
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
  };
}

export type FullScanResult = {
  trade_name: string | null;
  generic_name: string | null;
  expiry_date: string | null;
  barcode: string | null;
  batch: string | null;
};

/** يحوّل YYMMDD (GS1) إلى YYYY-MM-DD؛ يوم 00 = آخر يوم بالشهر. */
function gs1DateToIso(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy;
  if (dd === 0) dd = new Date(year, mm, 0).getDate();
  if (dd < 1 || dd > 31) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** يفكّك سلسلة GS1 (DataMatrix / GS1-128) ويستخرج GTIN(01) والانتهاء(17) والتشغيلة(10). */
export function parseGs1(raw: string): { gtin: string | null; expiry: string | null; batch: string | null } {
  const s = raw.replace(/[\u001d\]]/g, "\u001d").replace(/^\u001d+/, "");
  let i = 0;
  let gtin: string | null = null;
  let expiry: string | null = null;
  let batch: string | null = null;
  const fixed: Record<string, number> = { "00": 18, "01": 14, "11": 6, "13": 6, "15": 6, "17": 6 };
  while (i < s.length) {
    if (s[i] === "\u001d") {
      i++;
      continue;
    }
    const ai = s.slice(i, i + 2);
    const len = fixed[ai];
    if (len) {
      const val = s.slice(i + 2, i + 2 + len);
      if (ai === "01") gtin = /^\d{14}$/.test(val) ? val : gtin;
      if (ai === "17") expiry = gs1DateToIso(val) ?? expiry;
      i += 2 + len;
    } else if (ai === "10" || ai === "21") {
      const rest = s.slice(i + 2);
      const end = rest.indexOf("\u001d");
      const val = end === -1 ? rest : rest.slice(0, end);
      if (ai === "10") batch = val || batch;
      i += 2 + val.length;
    } else {
      break;
    }
  }
  return { gtin, expiry, batch };
}

/** يقرأ الاسم والتاريخ والباركود (بما فيه GS1 DataMatrix) من لقطة واحدة. */
export async function readPackFull(imageDataUrl: string): Promise<FullScanResult> {
  const content = await callGateway({
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content:
          "You are a live OCR engine for medicine packaging. Return JSON only: " +
          '{"trade_name": string|null, "generic_name": string|null, "expiry_date": "YYYY-MM-DD"|null, "barcode": string|null, "batch": string|null, "gs1": string|null}. ' +
          "trade_name is the commercial brand name printed on the pack. " +
          "generic_name is the active pharmaceutical ingredient (INN) — infer it from your pharmaceutical knowledge of the brand even if it is not printed, including strength if visible. " +
          "expiry_date: read EXP / EXPIRY / EXPIRATION / Exp. Date / تاريخ الانتهاء; ignore MFG/MFD. Accept MM/YY, MM/YYYY, YYYY-MM, DD/MM/YYYY. If only month/year, use the LAST day of that month. Ambiguous numeric dates are DD/MM/YYYY. " +
          "barcode: digits under an EAN/UPC barcode (digits only). " +
          "gs1: if a 2D GS1 DataMatrix or GS1-128 code is readable, return its FULL raw element string exactly as encoded, e.g. '010761234567890117260531101ABC' (keep AI prefixes; use ']' for FNC1 group separators). Otherwise null. " +
          "Use null for anything you are not reasonably sure about. Never invent values. No prose.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract name, expiry date, batch and barcode (incl. GS1 DataMatrix) from this pack." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
  const parsed = parseJson<FullScanResult & { gs1?: string | null }>(content);
  const iso = parsed?.expiry_date;
  const code = typeof parsed?.barcode === "string" ? parsed.barcode.trim() : "";
  const gs1 = typeof parsed?.gs1 === "string" && parsed.gs1.trim() ? parseGs1(parsed.gs1.trim()) : null;
  const textExpiry = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  return {
    trade_name: parsed?.trade_name ?? null,
    generic_name: parsed?.generic_name ?? null,
    // GS1 AI(17) أدق من قراءة النص
    expiry_date: gs1?.expiry ?? textExpiry,
    barcode: gs1?.gtin ?? (code.length >= 6 ? code : null),
    batch: gs1?.batch ?? (typeof parsed?.batch === "string" && parsed.batch.trim() ? parsed.batch.trim() : null),
  };
}

