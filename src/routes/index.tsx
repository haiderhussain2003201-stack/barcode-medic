import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  Camera,
  Download,
  Edit3,
  Filter,
  LogOut,
  Loader2,
  Package,
  Pill,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { identifyMedicinePhoto, readExpiryPhoto } from "@/lib/pharmacy.functions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "صيدليتي — مخزون الأدوية وتواريخ الانتهاء" },
      {
        name: "description",
        content:
          "صوّر اسم الدواء ليُدرج تلقائيًا مع اسمه العلمي، والتقط تاريخ الانتهاء بالكاميرا، وتابع الأيام المتبقية يوميًا.",
      },
      { property: "og:title", content: "صيدليتي — مخزون الأدوية وتواريخ الانتهاء" },
      {
        property: "og:description",
        content: "تصوير اسم الدواء وتاريخ الانتهاء بالكاميرا مع تنبيه الأدوية القريبة من الانتهاء.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

const CATEGORIES = [
  "مسكنات",
  "مضادات حيوية",
  "فيتامينات",
  "أمراض مزمنة",
  "مضادات حساسية",
  "الجهاز الهضمي",
  "الجهاز التنفسي",
  "عناية بالبشرة",
  "أخرى",
];

const LOW_STOCK_THRESHOLD = 5;

type Medicine = {
  id: string;
  trade_name: string;
  generic_name: string | null;
  expiry_date: string | null;
  quantity: number;
  category: string | null;
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

function downloadCsv(medicines: Medicine[]) {
  const headers = [
    "الاسم التجاري",
    "الاسم العلمي",
    "الفئة",
    "تاريخ الانتهاء",
    "الكمية",
    "الأيام المتبقية",
  ];
  const rows = medicines.map((m) => {
    const d = daysLeft(m.expiry_date);
    return [
      m.trade_name,
      m.generic_name ?? "",
      m.category ?? "",
      m.expiry_date ?? "",
      m.quantity,
      d === null ? "" : d,
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `مخزون_الأدوية_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function HomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const lastDeleted = useRef<Medicine | null>(null);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const { data: medicines = [], isLoading } = useQuery({
    queryKey: ["medicines", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Medicine[]> => {
      const { data, error } = await supabase
        .from("medicines")
        .select("id, trade_name, generic_name, expiry_date, quantity, category")
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["medicines"] });

  const undoDelete = async () => {
    const m = lastDeleted.current;
    if (!m || !user) return;
    const { error } = await supabase.from("medicines").insert({
      id: m.id,
      user_id: user.id,
      trade_name: m.trade_name,
      generic_name: m.generic_name,
      expiry_date: m.expiry_date,
      quantity: m.quantity,
      category: m.category,
    });
    if (error) {
      toast.error("تعذّر التراجع");
      return;
    }
    lastDeleted.current = null;
    toast.success("تم استرجاع الدواء");
    refresh();
  };

  const remove = useMutation({
    mutationFn: async (medicine: Medicine) => {
      const { error } = await supabase.from("medicines").delete().eq("id", medicine.id);
      if (error) throw error;
      return medicine;
    },
    onSuccess: (medicine) => {
      lastDeleted.current = medicine;
      toast.success(`تم حذف ${medicine.trade_name}`, {
        duration: 8000,
        action: { label: "تراجع", onClick: () => void undoDelete() },
      });
      refresh();
    },
    onError: () => toast.error("تعذّر الحذف"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return medicines.filter((m) => {
      const matchesSearch = !q
        ? true
        : [m.trade_name, m.generic_name, m.category]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q));
      const matchesCategory = categoryFilter === "all" ? true : m.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [medicines, search, categoryFilter]);

  const expired = medicines.filter((m) => (daysLeft(m.expiry_date) ?? 1) < 0).length;
  const soon = medicines.filter((m) => {
    const d = daysLeft(m.expiry_date);
    return d !== null && d >= 0 && d <= 90;
  }).length;
  const lowStock = medicines.filter((m) => m.quantity <= LOW_STOCK_THRESHOLD).length;

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
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="تصدير المخزون"
            onClick={() => {
              downloadCsv(medicines);
              toast.success("تم تصدير المخزون");
            }}
          >
            <Download className="size-5" />
          </Button>
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
        </div>
      </header>

      <section className="mt-6 grid grid-cols-4 gap-2">
        <StatCard icon={<Package className="size-4" />} label="الأدوية" value={medicines.length} tone="ok" />
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
        <StatCard
          icon={<Package className="size-4" />}
          label="كمية قليلة"
          value={lowStock}
          tone={lowStock > 0 ? "warn" : "ok"}
        />
      </section>

      <div className="mt-6 space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم التجاري أو العلمي أو الفئة..."
            className="pr-9"
            maxLength={100}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 flex-1 text-sm">
              <SelectValue placeholder="كل الفئات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفئات</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {categoryFilter !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setCategoryFilter("all")}>
              إلغاء
            </Button>
          )}
        </div>
      </div>

      <section className="mt-4 space-y-3">
        {isLoading && <Loader2 className="mx-auto mt-8 size-6 animate-spin text-primary" />}
        {!isLoading && filtered.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              لا توجد أدوية مطابقة. اضغط «إضافة دواء» وصوّر اسم الدواء للبدء.
            </CardContent>
          </Card>
        )}
        {filtered.map((m) => {
          const days = daysLeft(m.expiry_date);
          const status = statusOf(days);
          const isLow = m.quantity <= LOW_STOCK_THRESHOLD;
          return (
            <Card key={m.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="flex items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-bold">{m.trade_name}</h2>
                    {m.category && (
                      <Badge variant="outline" className="shrink-0 text-[10px] bg-secondary/50">
                        {m.category}
                      </Badge>
                    )}
                  </div>
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
                    <span className={`text-muted-foreground ${isLow ? "font-bold text-warning-foreground" : ""}`}>
                      الكمية: {m.quantity}
                      {isLow && " (قليلة)"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="تعديل"
                    onClick={() => setEditing(m)}
                  >
                    <Edit3 className="size-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="حذف"
                    onClick={() => remove.mutate(m)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
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
        onSaved={refresh}
      />
      {editing && (
        <EditMedicineDialog
          medicine={editing}
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={refresh}
        />
      )}
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
      <CardContent className="px-2 py-4 text-center">
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
  trade_name: string;
  generic_name: string;
  expiry_date: string;
  quantity: string;
  category: string;
};

const emptyDraft: Draft = {
  trade_name: "",
  generic_name: "",
  expiry_date: "",
  quantity: "1",
  category: "",
};

function CategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger className="h-10 w-full text-sm">
        <SelectValue placeholder="اختر الفئة (اختياري)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">بدون فئة</SelectItem>
        {CATEGORIES.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
  const [namingOpen, setNamingOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const identify = useServerFn(identifyMedicinePhoto);
  const readPhoto = useServerFn(readExpiryPhoto);

  useEffect(() => {
    if (open) setDraft(emptyDraft);
  }, [open]);

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const handleNamePhoto = async (image: string) => {
    setIdentifying(true);
    try {
      const res = await identify({ data: { image } });
      if (res.trade_name || res.generic_name) {
        setDraft((d) => ({
          ...d,
          trade_name: res.trade_name ?? d.trade_name,
          generic_name: res.generic_name ?? d.generic_name,
          expiry_date: res.expiry_date ?? d.expiry_date,
        }));
        toast.success(`تم التعرف على: ${res.trade_name ?? res.generic_name}`);
        setNamingOpen(false);
      } else {
        toast.error("لم نتمكن من قراءة اسم الدواء، جرّب تقريب الكاميرا أكثر");
      }
    } catch {
      toast.error("تعذّرت قراءة الصورة");
    } finally {
      setIdentifying(false);
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
      trade_name: name,
      generic_name: draft.generic_name.trim() || null,
      expiry_date: draft.expiry_date || null,
      quantity: Math.max(1, Number(draft.quantity) || 1),
      category: draft.category.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("تعذّر الحفظ");
      return;
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
              صوّر اسم الدواء ليُدرج مع اسمه العلمي تلقائيًا، ثم صوّر تاريخ الانتهاء.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setNamingOpen(true)} disabled={identifying}>
              {identifying ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              تصوير اسم الدواء
            </Button>
            <Button variant="secondary" onClick={() => setCapturing(true)}>
              <Camera className="size-4" /> تصوير التاريخ
            </Button>
          </div>

          <div className="space-y-3">
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
            <Field label="الفئة">
              <CategorySelect value={draft.category} onChange={(v) => set("category", v)} />
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

      <PhotoCapture
        open={namingOpen}
        busy={identifying}
        title="تصوير اسم الدواء"
        hint="وجّه الكاميرا نحو الاسم التجاري على العلبة"
        onClose={() => setNamingOpen(false)}
        onCapture={handleNamePhoto}
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

function EditMedicineDialog({
  medicine,
  open,
  onOpenChange,
  onSaved,
}: {
  medicine: Medicine;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    trade_name: medicine.trade_name,
    generic_name: medicine.generic_name ?? "",
    expiry_date: medicine.expiry_date ?? "",
    quantity: String(medicine.quantity),
    category: medicine.category ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    const name = draft.trade_name.trim();
    if (!name) {
      toast.error("اسم الدواء مطلوب");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("medicines")
      .update({
        trade_name: name,
        generic_name: draft.generic_name.trim() || null,
        expiry_date: draft.expiry_date || null,
        quantity: Math.max(1, Number(draft.quantity) || 1),
        category: draft.category.trim() || null,
      })
      .eq("id", medicine.id);
    setSaving(false);
    if (error) {
      toast.error("تعذّر التعديل");
      return;
    }
    toast.success("تم تعديل الدواء");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>تعديل دواء</DialogTitle>
          <DialogDescription>عدّل بيانات الدواء ثم اضغط حفظ.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
          <Field label="الفئة">
            <CategorySelect value={draft.category} onChange={(v) => set("category", v)} />
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
          {saving && <Loader2 className="size-4 animate-spin" />} حفظ التعديلات
        </Button>
      </DialogContent>
    </Dialog>
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
