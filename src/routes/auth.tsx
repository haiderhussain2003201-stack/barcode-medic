import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pill, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — صيدليتي" },
      { name: "description", content: "سجّل الدخول لإدارة مخزون أدويتك وتواريخ الانتهاء." },
      { property: "og:title", content: "تسجيل الدخول — صيدليتي" },
      {
        property: "og:description",
        content: "سجّل الدخول لإدارة مخزون أدويتك وتواريخ الانتهاء.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/" });
  }, [loading, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setBusy(true);
    const fn =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
    const { error } = await fn;
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (mode === "signup") toast.success("تم إنشاء الحساب، يمكنك الدخول الآن");
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("تعذّر تسجيل الدخول عبر Google");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm shadow-[var(--shadow-card)]">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Pill className="size-6" />
          </div>
          <CardTitle className="mt-3 text-2xl">صيدليتي</CardTitle>
          <CardDescription>
            {mode === "login" ? "سجّل الدخول لمتابعة مخزونك" : "أنشئ حسابًا جديدًا"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                required
                maxLength={255}
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                required
                maxLength={72}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "login" ? "دخول" : "إنشاء حساب"}
            </Button>
          </form>
          <Button variant="outline" className="w-full" onClick={google}>
            المتابعة عبر Google
          </Button>
          <button
            type="button"
            className="w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "ليس لديك حساب؟ أنشئ واحدًا" : "لديك حساب؟ سجّل الدخول"}
          </button>
        </CardContent>
      </Card>
    </main>
  );
}
