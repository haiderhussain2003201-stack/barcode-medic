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
};

/** يقرأ الاسم والتاريخ والباركود من لقطة واحدة. */
export async function readPackFull(imageDataUrl: string): Promise<FullScanResult> {
  const content = await callGateway({
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content:
          "You read photos of medicine packaging. Return JSON only: " +
          '{"trade_name": string|null, "generic_name": string|null, "expiry_date": "YYYY-MM-DD"|null, "barcode": string|null}. ' +
          "trade_name is the commercial brand name printed on the pack. " +
          "generic_name is the active pharmaceutical ingredient (INN) — infer it from your pharmaceutical knowledge of the brand even if it is not printed, including strength if visible. " +
          "expiry_date: read EXP / Exp. Date / تاريخ الانتهاء; ignore MFG. If only month/year, use the LAST day of that month. Ambiguous numeric dates are DD/MM/YYYY. " +
          "barcode: the digits printed under an EAN/UPC barcode, or the decoded text of a QR/DataMatrix code, if legible. Digits only for EAN/UPC. " +
          "Use null for anything you are not reasonably sure about. Never invent values. No prose.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract name, expiry date and barcode from this pack." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });
  const parsed = parseJson<FullScanResult>(content);
  const iso = parsed?.expiry_date;
  const code = typeof parsed?.barcode === "string" ? parsed.barcode.trim() : "";
  return {
    trade_name: parsed?.trade_name ?? null,
    generic_name: parsed?.generic_name ?? null,
    expiry_date: typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null,
    barcode: code.length >= 6 ? code : null,
  };
}
