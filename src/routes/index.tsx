import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  Camera,
  LogOut,
  Loader2,
  Package,
  Pill,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { lookupBarcode, readExpiryPhoto, saveBarcodeName } from "@/lib/pharmacy.functions";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { PhotoCapture } from "@/components/PhotoCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "صيدليتي — مخزون الأدوية وتواريخ الانتهاء" },
      {
        name: "description",
        content:
          "أضف الأدوية بمسح الباركود فقط، والتقط تاريخ الانتهاء بالكاميرا، وتابع الأيام المتبقية لكل دواء يوميًا.",
      },
      { property: "og:title", content: "صيدليتي — مخزون الأدوية وتواريخ الانتهاء" },
      {
        property: "og:description",
        content: "مسح الباركود، قراءة تاريخ الانتهاء بالكاميرا، وتنبيه بالأدوية القريبة من الانتهاء.",
      },
    ],
  }),
  component: HomePage,
});

type Medicine = {
  id: string;
  barcode: string | null;
  trade_name: string;
  generic_name: string | null;
  manufacturer: string | null;
  expiry_date: string | null;
  quantity: number;
};

const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

function daysLeft(date: string | null) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target.getTime() - today().getTime()) / 86_400_000);
}

function statusOf(days: number | null) {
  if (days === null) return { label: "بدون تاريخ", tone: "muted" as const };
  if (days < 0) return { label: `منتهي منذ ${Math.abs(days)} يوم`, tone: "danger" as const };
  if (days <= 90) return { label: `${days} يوم متبقي`, tone: "warn" as const };
  return { label: `${days} يوم متبقي`, tone: "ok" as const };
}

const toneClass = {
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  warn: "bg-warning/15 text-warning-foreground border-warning/40",
  ok: "bg-success/10 text-success border-success/30",
  muted: "bg-muted text-muted-foreground border-border",
};

function HomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const { data: medicines = [], isLoading } = useQuery({
    queryKey: ["medicines", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Medicine[]> => {
      const { data, error } = await supabase
        .from("medicines")
        .select("id, barcode, trade_name, generic_name, manufacturer, expiry_date, quantity")
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("medicines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف الدواء");
      void queryClient.invalidateQueries({ queryKey: ["medicines"] });
    },
    onError: () => toast.error("تعذّر الحذف"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return medicines;
    return medicines.filter((m) =>
      [m.trade_name, m.generic_name, m.manufacturer, m.barcode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [medicines, search]);

  const expired = medicines.filter((m) => (daysLeft(m.expiry_date) ?? 1) < 0).length;
  const soon = medicines.filter((m) => {
    const d = daysLeft(m.expiry_date);
    return d !== null && d >= 0 && d <= 90;
  }).length;

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-28 pt-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-float)]">
            <Pill className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight">صيدليتي</h1>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="تسجيل الخروج"
          onClick={async () => {
            await supabase.auth.signOut();
            void navigate({ to: "/auth" });
          }}
        >
          <LogOut className="size-5" />
        </Button>
      </header>

      <section className="mt-6 grid grid-cols-3 gap-3">
        <StatCard icon={<Package className="size-4" />} label="الأدوية" value={medicines.length} />
        <StatCard
          icon={<CalendarClock className="size-4" />}
          label="قريبة الانتهاء"
          value={soon}
          tone="warn"
        />
        <StatCard
          icon={<TriangleAlert className="size-4" />}
          label="منتهية"
          value={expired}
          tone="danger"
        />
      </section>

      <div className="relative mt-6">
        <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الباركود..."
          className="pr-9"
          maxLength={100}
        />
      </div>

      <section className="mt-4 space-y-3">
        {isLoading && <Loader2 className="mx-auto mt-8 size-6 animate-spin text-primary" />}
        {!isLoading && filtered.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              لا توجد أدوية بعد. اضغط «إضافة دواء» وامسح الباركود للبدء.
            </CardContent>
          </Card>
        )}
        {filtered.map((m) => {
          const days = daysLeft(m.expiry_date);
          const status = statusOf(days);
          return (
            <Card key={m.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="flex items-start justify-between gap-3 py-4">
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{m.trade_name}</h2>
                  {m.generic_name && (
                    <p className="truncate text-xs text-muted-foreground">{m.generic_name}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className={toneClass[status.tone]}>
                      {status.label}
                    </Badge>
                    {m.expiry_date && (
                      <span className="latin text-muted-foreground">{m.expiry_date}</span>
                    )}
                    <span className="text-muted-foreground">الكمية: {m.quantity}</span>
                  </div>
                  {m.barcode && (
                    <p className="latin mt-1 text-[11px] text-muted-foreground">{m.barcode}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="حذف"
                  onClick={() => remove.mutate(m.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-3xl bg-gradient-to-t from-background via-background to-transparent p-4">
        <Button size="lg" className="w-full" onClick={() => setAddOpen(true)}>
          <Plus className="size-5" /> إضافة دواء
        </Button>
      </div>

      <AddMedicineDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        userId={user.id}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["medicines"] })}
      />
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "ok",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="px-3 py-4 text-center">
        <div
          className={`mx-auto flex size-8 items-center justify-center rounded-lg border ${toneClass[tone]}`}
        >
          {icon}
        </div>
        <p className="mt-2 text-xl font-extrabold">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

type Draft = {
  barcode: string;
  trade_name: string;
  generic_name: string;
  manufacturer: string;
  expiry_date: string;
  quantity: string;
};

const emptyDraft: Draft = {
  barcode: "",
  trade_name: "",
  generic_name: "",
  manufacturer: "",
  expiry_date: "",
  quantity: "1",
};

function AddMedicineDialog({
  open,
  onOpenChange,
  userId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [scanning, setScanning] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [looking, setLooking] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const lookup = useServerFn(lookupBarcode);
  const readPhoto = useServerFn(readExpiryPhoto);
  const cacheName = useServerFn(saveBarcodeName);

  useEffect(() => {
    if (open) setDraft(emptyDraft);
  }, [open]);

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const handleBarcode = async (code: string) => {
    setScanning(false);
    set("barcode", code);
    setLooking(true);
    try {
      const res = await lookup({ data: { barcode: code } });
      if (res.found) {
        setDraft((d) => ({
          ...d,
          trade_name: res.trade_name ?? d.trade_name,
          generic_name: res.generic_name ?? d.generic_name,
          manufacturer: res.manufacturer ?? d.manufacturer,
        }));
        toast.success("تم التعرف على الدواء من الباركود");
      } else {
        toast.info("لم نجد هذا الباركود — اكتب الاسم مرة واحدة وسيُحفظ للمرات القادمة");
      }
    } catch {
      toast.error("تعذّر البحث عن الباركود");
    } finally {
      setLooking(false);
    }
  };

  const handlePhoto = async (image: string) => {
    setReading(true);
    try {
      const res = await readPhoto({ data: { image } });
      if (res.expiry_date) {
        setDraft((d) => ({
          ...d,
          expiry_date: res.expiry_date!,
          trade_name: d.trade_name || (res.trade_name ?? ""),
          barcode: d.barcode || (res.barcode ?? ""),
        }));
        toast.success(`تاريخ الانتهاء: ${res.expiry_date}`);
        setCapturing(false);
      } else {
        toast.error("لم نتمكن من قراءة التاريخ، جرّب تقريب الكاميرا أكثر");
      }
    } catch {
      toast.error("تعذّرت قراءة الصورة");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    const name = draft.trade_name.trim();
    if (!name) {
      toast.error("اسم الدواء مطلوب");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("medicines").insert({
      user_id: userId,
      barcode: draft.barcode.trim() || null,
      trade_name: name,
      generic_name: draft.generic_name.trim() || null,
      manufacturer: draft.manufacturer.trim() || null,
      expiry_date: draft.expiry_date || null,
      quantity: Math.max(1, Number(draft.quantity) || 1),
    });
    setSaving(false);
    if (error) {
      toast.error("تعذّر الحفظ");
      return;
    }
    if (draft.barcode.trim()) {
      void cacheName({
        data: {
          barcode: draft.barcode.trim(),
          trade_name: name,
          generic_name: draft.generic_name.trim() || null,
          manufacturer: draft.manufacturer.trim() || null,
        },
      }).catch(() => undefined);
    }
    toast.success("تمت إضافة الدواء");
    onSaved();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader className="text-right">
            <DialogTitle>إضافة دواء</DialogTitle>
            <DialogDescription>
              امسح الباركود ليُدرج الاسم تلقائيًا، ثم صوّر تاريخ الانتهاء.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setScanning(true)} disabled={looking}>
              {looking ? <Loader2 className="size-4 animate-spin" /> : <ScanBarcode className="size-4" />}
              مسح الباركود
            </Button>
            <Button variant="secondary" onClick={() => setCapturing(true)}>
              <Camera className="size-4" /> تصوير التاريخ
            </Button>
          </div>

          <div className="space-y-3">
            <Field label="الباركود">
              <Input
                dir="ltr"
                value={draft.barcode}
                maxLength={64}
                onChange={(e) => set("barcode", e.target.value)}
              />
            </Field>
            <Field label="الاسم التجاري">
              <Input
                value={draft.trade_name}
                maxLength={200}
                onChange={(e) => set("trade_name", e.target.value)}
              />
            </Field>
            <Field label="الاسم العلمي">
              <Input
                value={draft.generic_name}
                maxLength={200}
                onChange={(e) => set("generic_name", e.target.value)}
              />
            </Field>
            <Field label="الشركة المصنّعة">
              <Input
                value={draft.manufacturer}
                maxLength={200}
                onChange={(e) => set("manufacturer", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="تاريخ الانتهاء">
                <Input
                  type="date"
                  dir="ltr"
                  value={draft.expiry_date}
                  onChange={(e) => set("expiry_date", e.target.value)}
                />
              </Field>
              <Field label="الكمية">
                <Input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={draft.quantity}
                  onChange={(e) => set("quantity", e.target.value)}
                />
              </Field>
            </div>
          </div>

          <Button onClick={save} disabled={saving} size="lg" className="mt-2 w-full">
            {saving && <Loader2 className="size-4 animate-spin" />} حفظ الدواء
          </Button>
        </DialogContent>
      </Dialog>

      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={handleBarcode}
      />
      <PhotoCapture
        open={capturing}
        busy={reading}
        title="تصوير تاريخ الانتهاء"
        hint="قرّب الكاميرا من تاريخ الانتهاء (EXP) حتى يظهر واضحًا"
        onClose={() => setCapturing(false)}
        onCapture={handlePhoto}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
