import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Rocket, ShieldAlert, XCircle } from "lucide-react";
import { api, isAuthRequiredError, type DeploymentCheckItem, type DeploymentReadinessResponse } from "@/lib/api";

function toneFor(status: string) {
  if (status === "passed") {
    return {
      icon: CheckCircle2,
      badge: "bg-success/10 text-success",
      border: "border-success/25",
      label: "通过",
    };
  }
  if (status === "failed") {
    return {
      icon: XCircle,
      badge: "bg-danger/10 text-danger",
      border: "border-danger/25",
      label: "失败",
    };
  }
  return {
    icon: AlertTriangle,
    badge: "bg-warning/10 text-warning",
    border: "border-warning/25",
    label: "注意",
  };
}

function CheckRow({ item }: { item: DeploymentCheckItem }) {
  const tone = toneFor(item.status);
  const Icon = tone.icon;
  return (
    <div className={`rounded-lg border bg-card p-4 ${tone.border}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">{item.title}</div>
            <p className="mt-1 break-words text-sm text-muted-foreground">{item.detail}</p>
            {item.recommendation ? (
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">建议：</span>
                {item.recommendation}
              </p>
            ) : null}
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs ${tone.badge}`}>
          {tone.label}
        </span>
      </div>
    </div>
  );
}

export function Deployment() {
  const [data, setData] = useState<DeploymentReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getDeploymentReadiness());
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setError("当前账号没有部署检查权限，请使用管理员账号登录。");
      } else {
        setError(err instanceof Error ? err.message : "加载部署检查失败。");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const headline = useMemo(() => {
    if (!data) return { title: "正在检查部署配置", desc: "请稍候。" };
    if (data.status === "ready") {
      return { title: "部署检查通过", desc: data.summary.message };
    }
    if (data.status === "failed") {
      return { title: "存在阻塞项", desc: data.summary.message };
    }
    return { title: "可以内测，但上线前仍需补配置", desc: data.summary.message };
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">部署检查</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            上线前检查登录安全、用户数据库、工作区目录、A 股数据源和公网访问配置。这个页面只给管理员使用。
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          重新检查
        </button>
      </div>

      <section className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-1 h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">{headline.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{headline.desc}</p>
              {data ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  当前管理员邮箱：<span className="font-medium text-foreground">{data.admin_email}</span>
                </p>
              ) : null}
            </div>
          </div>
          {data ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">通过</div>
                <div className="text-lg font-semibold text-success">{data.passed}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">注意</div>
                <div className="text-lg font-semibold text-warning">{data.warning}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">失败</div>
                <div className="text-lg font-semibold text-danger">{data.failed}</div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在读取部署检查...
        </div>
      ) : data ? (
        <div className="grid gap-3">
          {data.checks.map((item) => (
            <CheckRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
