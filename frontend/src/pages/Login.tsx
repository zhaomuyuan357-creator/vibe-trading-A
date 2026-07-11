import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { getStoredAuthUser, isLoggedIn, setAuthSession } from "@/lib/apiAuth";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("admin@example.com");
  const [accessCode, setAccessCode] = useState("change-me-access-code");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoggedIn() && getStoredAuthUser()) {
    return <Navigate to="/" replace />;
  }

  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
  const target = `${from?.pathname || "/"}${from?.search || ""}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await api.login(email, accessCode);
      setAuthSession(session.token, session.user);
      window.dispatchEvent(new CustomEvent("vibe:auth-changed"));
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请检查白名单和访问码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">vibe-trading-A 内测登录</h1>
            <p className="mt-1 text-sm text-muted-foreground">仅白名单用户可访问投研工作台。</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">内测访问码</span>
            <input
              type="password"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="请输入访问码"
              required
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            登录
          </button>
        </form>

        <div className="mt-5 rounded-md bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
          开源版本地默认管理员账号为 <span className="font-medium text-foreground">admin@example.com</span>，
          默认访问码为 <span className="font-medium text-foreground">change-me-access-code</span>。部署上线前请通过环境变量替换。
        </div>
      </div>
    </div>
  );
}
