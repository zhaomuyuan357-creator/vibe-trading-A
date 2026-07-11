import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, ShieldCheck, ToggleLeft, ToggleRight, UserRound, UsersRound } from "lucide-react";
import { api, isAuthRequiredError, type WhitelistEntry } from "@/lib/api";
import { getStoredAuthUser } from "@/lib/apiAuth";

const roleLabels: Record<string, string> = {
  admin: "管理员",
  user: "内测用户",
};

const statusLabels: Record<string, string> = {
  active: "已启用",
  disabled: "已禁用",
};

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roleBadgeClass(role: string): string {
  return role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";
}

function statusBadgeClass(status: string): string {
  return status === "disabled" ? "bg-danger/10 text-danger" : "bg-success/10 text-success";
}

export function Users() {
  const authUser = getStoredAuthUser();
  const isAdmin = authUser?.role === "admin";
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusyEmail, setStatusBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [note, setNote] = useState("");

  const stats = useMemo(() => {
    const admins = entries.filter((entry) => entry.role === "admin").length;
    const disabled = entries.filter((entry) => entry.status === "disabled").length;
    return {
      total: entries.length,
      admins,
      active: Math.max(entries.length - disabled, 0),
      disabled,
    };
  }, [entries]);

  const loadWhitelist = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listWhitelist();
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setError("当前账号没有白名单管理权限，请使用管理员账号登录。");
      } else {
        setError(err instanceof Error ? err.message : "加载白名单失败");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWhitelist();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("请输入用户邮箱。");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.upsertWhitelist({
        email: trimmedEmail,
        role,
        note: note.trim(),
      });
      setEntries((prev) => {
        const withoutCurrent = prev.filter((entry) => entry.email !== updated.email);
        return [updated, ...withoutCurrent];
      });
      setEmail("");
      setRole("user");
      setNote("");
      setSuccess(`已更新 ${updated.email} 的访问权限。`);
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setError("当前账号没有白名单管理权限，请使用管理员账号登录。");
      } else {
        setError(err instanceof Error ? err.message : "保存白名单失败");
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (entry: WhitelistEntry) => {
    if (!isAdmin) return;
    const nextStatus = entry.status === "disabled" ? "active" : "disabled";
    setStatusBusyEmail(entry.email);
    setError(null);
    setSuccess(null);
    try {
      const updated = await api.setWhitelistStatus(entry.email, nextStatus);
      setEntries((prev) => prev.map((item) => (item.email === updated.email ? updated : item)));
      setSuccess(`${updated.email} 已${updated.status === "disabled" ? "禁用" : "启用"}。`);
    } catch (err) {
      if (isAuthRequiredError(err)) {
        setError("当前账号没有白名单管理权限，请使用管理员账号登录。");
      } else {
        setError(err instanceof Error ? err.message : "更新用户状态失败");
      }
    } finally {
      setStatusBusyEmail(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">用户与白名单</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            用于内测阶段控制谁可以登录 vibe-trading-A。禁用用户会保留记录并立即撤销该用户当前登录会话，适合试用到期、风控暂停或灰度测试管理。
          </p>
        </div>
        <button
          type="button"
          onClick={loadWhitelist}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </button>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">白名单用户</div>
          <div className="mt-1 text-2xl font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">已启用</div>
          <div className="mt-1 text-2xl font-semibold">{stats.active}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">已禁用</div>
          <div className="mt-1 text-2xl font-semibold">{stats.disabled}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">管理员</div>
          <div className="mt-1 text-2xl font-semibold">{stats.admins}</div>
        </div>
      </section>

      {!isAdmin ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          当前登录账号不是管理员，只能查看页面说明，无法添加、修改或禁用白名单。
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.4fr)]">
        <form onSubmit={submit} className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">添加或更新用户</h2>
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@example.com"
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                disabled={!isAdmin || saving}
                required
              />
              <span className="text-xs text-muted-foreground">用户登录时需要输入这个邮箱。</span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">角色</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "user" | "admin")}
                className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                disabled={!isAdmin || saving}
              >
                <option value="user">内测用户</option>
                <option value="admin">管理员</option>
              </select>
              <span className="text-xs text-muted-foreground">管理员可以维护白名单；普通用户只能使用产品功能。</span>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">备注</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：首批内测、朋友推荐、付费试用..."
                className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                disabled={!isAdmin || saving}
              />
            </label>

            {error ? (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                {success}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!isAdmin || saving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              保存白名单
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">当前白名单</h2>
            <p className="mt-1 text-sm text-muted-foreground">同一个邮箱再次保存会更新角色和备注；启用/禁用用于控制登录权限。</p>
          </div>

          {loading ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载白名单...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <UserRound className="h-8 w-8" />
              暂无白名单用户
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">用户邮箱</th>
                    <th className="px-4 py-3 text-left font-medium">角色</th>
                    <th className="px-4 py-3 text-left font-medium">状态</th>
                    <th className="px-4 py-3 text-left font-medium">备注</th>
                    <th className="px-4 py-3 text-left font-medium">加入时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isCurrentUser = entry.email === authUser?.email;
                    const busy = statusBusyEmail === entry.email;
                    const disabled = entry.status === "disabled";
                    return (
                      <tr key={entry.id || entry.email} className="border-t">
                        <td className="px-4 py-3 align-top font-medium">{entry.email}</td>
                        <td className="px-4 py-3 align-top">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${roleBadgeClass(entry.role)}`}>
                            {roleLabels[entry.role] || entry.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(entry.status)}`}>
                            {statusLabels[entry.status] || entry.status}
                          </span>
                        </td>
                        <td className="max-w-sm px-4 py-3 align-top text-muted-foreground">{entry.note || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 align-top text-muted-foreground">
                          {formatDate(entry.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <button
                            type="button"
                            onClick={() => toggleStatus(entry)}
                            disabled={!isAdmin || busy || isCurrentUser}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            title={isCurrentUser ? "不能在当前会话中禁用自己" : disabled ? "启用该用户" : "禁用该用户"}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : disabled ? (
                              <ToggleRight className="h-3.5 w-3.5" />
                            ) : (
                              <ToggleLeft className="h-3.5 w-3.5" />
                            )}
                            {disabled ? "启用" : "禁用"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
