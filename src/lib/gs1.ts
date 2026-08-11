/** أدوات GS1 وقاعدة أسماء الأدوية المحلية (تعمل في المتصفح). */

export type Gs1Data = {
  gtin: string | null;
  expiry: string | null;
  batch: string | null;
  raw: string;
};

const FIXED: Record<string, number> = {
  "00": 18,
  "01": 14,
  "02": 14,
  "11": 6,
  "12": 6,
  "13": 6,
  "15": 6,
  "16": 6,
  "17": 6,
  "20": 2,
};
const VARIABLE = new Set(["10", "21", "22", "240", "241", "30", "37", "710", "711"]);

function yymmddToIso(v: string): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const yy = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  let dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy;
  if (dd === 0) dd = new Date(year, mm, 0).getDate();
  if (dd < 1 || dd > 31) return null;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** يفكّك سلسلة GS1 (DataMatrix / GS1-128) ويستخرج GTIN(01) والانتهاء(17) والتشغيلة(10). */
export function parseGs1(input: string): Gs1Data {
  const raw = input.trim();
  const s = raw.replace(/[\u001d\u241d]/g, "\u001d").replace(/^\]d2|^\]C1/i, "");
  const out: Gs1Data = { gtin: null, expiry: null, batch: null, raw };
  let i = 0;
  let guard = 0;
  while (i < s.length && guard++ < 50) {
    if (s[i] === "\u001d") {
      i++;
      continue;
    }
    const ai2 = s.slice(i, i + 2);
    const ai3 = s.slice(i, i + 3);
    const len = FIXED[ai2];
    if (len) {
      const val = s.slice(i + 2, i + 2 + len);
      if (ai2 === "01" && /^\d{14}$/.test(val)) out.gtin = val;
      if (ai2 === "17") out.expiry = yymmddToIso(val) ?? out.expiry;
      i += 2 + len;
      continue;
    }
    const ai = VARIABLE.has(ai2) ? ai2 : VARIABLE.has(ai3) ? ai3 : null;
    if (!ai) break;
    const rest = s.slice(i + ai.length);
    const end = rest.indexOf("\u001d");
    const val = end === -1 ? rest : rest.slice(0, end);
    if (ai === "10") out.batch = val || out.batch;
    i += ai.length + val.length;
  }
  // باركود خطي عادي (EAN-13 / UPC)
  if (!out.gtin && /^\d{8,14}$/.test(raw)) out.gtin = raw;
  return out;
}

/** قاعدة أولية لأشهر الأدوية (GTIN → الاسم). */
export const GTIN_DB: Record<string, string> = {
  "05000158066831": "Panadol Extra 500mg",
  "05000158103031": "Panadol Advance 500mg",
  "05054563096265": "Augmentin 1g",
  "05054563096272": "Augmentin 625mg",
  "08699536090085": "Amoxicillin 500mg",
  "06221048100019": "Amoxicillin 250mg Syrup",
  "05000158105059": "Panadol Cold & Flu",
  "03582910077770": "Doliprane 1000mg",
  "03400930000000": "Efferalgan 500mg",
  "08901234567894": "Cetirizine 10mg",
  "05017007000005": "Brufen 400mg",
  "05017007000012": "Brufen 600mg",
  "06291100630010": "Adol 500mg",
  "06291100630027": "Adol Extra",
  "08699546090028": "Metformin 500mg",
  "08699546090035": "Metformin 1000mg",
  "05000158069948": "Voltaren 50mg",
  "07613326019736": "Voltaren Emulgel",
  "08594739021013": "Omeprazole 20mg",
  "08699508090048": "Pantoprazole 40mg",
  "05099151000019": "Zithromax 500mg",
  "08699844090015": "Azithromycin 250mg",
  "05000123456789": "Ventolin Inhaler",
  "08901030711234": "Losartan 50mg",
  "08699512090012": "Atorvastatin 20mg",
  "08699502090019": "Amlodipine 5mg",
  "05012616000012": "Aspirin 100mg",
  "06223000000015": "Vitamin D3 50000 IU",
  "06281000000018": "Vitamin C 1000mg",
  "08699578090011": "Ciprofloxacin 500mg",
};

const LS_KEY = "pharmacy.gtin.names";

function readLearned(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** يبحث عن اسم الدواء: المحفوظات المحلية أولًا ثم القاعدة الأولية. */
export function lookupGtin(gtin: string | null): string | null {
  if (!gtin) return null;
  const learned = readLearned();
  return learned[gtin] ?? GTIN_DB[gtin] ?? null;
}

/** يحفظ (GTIN → الاسم) في التخزين المحلي ليتعرّف عليه التطبيق لاحقًا. */
export function rememberGtin(gtin: string | null, name: string) {
  if (typeof window === "undefined") return;
  const clean = name.trim();
  if (!gtin || !clean) return;
  try {
    const learned = readLearned();
    learned[gtin] = clean;
    window.localStorage.setItem(LS_KEY, JSON.stringify(learned));
  } catch {
    /* تجاهل */
  }
}
