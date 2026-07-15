import i18n from "@/i18n";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Database, KeyRound, Loader2, MessageSquareMore, Play, RefreshCw, RotateCcw, Save, Server, SlidersHorizontal, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, isAuthRequiredError, type ChannelConfigResponse, type ChannelRuntimeStatus, type DataSourceSettings, type LLMProviderOption, type LLMSettings } from "@/lib/api";
import { getApiAuthKey, setApiAuthKey } from "@/lib/apiAuth";

interface LLMFormState {
  provider: string;
  model_name: string;
  base_url: string;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort: string;
}

const fieldClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";

function toForm(settings: LLMSettings): LLMFormState {
  return {
    provider: settings.provider,
    model_name: settings.model_name,
    base_url: settings.base_url,
    temperature: settings.temperature,
    timeout_seconds: settings.timeout_seconds,
    max_retries: settings.max_retries,
    reasoning_effort: settings.reasoning_effort || "",
  };
}

function stringifyChannelConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}

export function Settings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [dataSettings, setDataSettings] = useState<DataSourceSettings | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelRuntimeStatus | null>(null);
  const [channelConfig, setChannelConfig] = useState<ChannelConfigResponse | null>(null);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [channelConfigText, setChannelConfigText] = useState("");
  const [form, setForm] = useState<LLMFormState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [localApiKey, setLocalApiKeyState] = useState(() => getApiAuthKey());
  const [clearApiKey, setClearApiKey] = useState(false);
  const [tushareToken, setTushareToken] = useState("");
  const [clearTushareToken, setClearTushareToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dataSaving, setDataSaving] = useState(false);
  const [channelRefreshing, setChannelRefreshing] = useState(false);
  const [channelConfigSaving, setChannelConfigSaving] = useState(false);
  const [channelAction, setChannelAction] = useState<"start" | "stop" | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    Promise.allSettled([
      api.getLLMSettings(),
      api.getDataSourceSettings(),
      api.getChannelStatus(),
      api.getChannelConfig(),
    ])
      .then(([llmResult, dataSourceResult, channelResult, channelConfigResult]) => {
        if (!alive) return;

        if (llmResult.status === "fulfilled") {
          setSettings(llmResult.value);
          setForm(toForm(llmResult.value));
        } else {
          const message = llmResult.reason instanceof Error ? llmResult.reason.message : "Unknown error";
          setSettingsLoadError(message);
          if (isAuthRequiredError(llmResult.reason)) {
            toast.error(message);
          } else {
            toast.error(`Failed to load LLM settings: ${message}`);
          }
        }

        if (dataSourceResult.status === "fulfilled") {
          setDataSettings(dataSourceResult.value);
        } else {
          const message = dataSourceResult.reason instanceof Error ? dataSourceResult.reason.message : "Unknown error";
          setSettingsLoadError(message);
          if (isAuthRequiredError(dataSourceResult.reason)) {
            toast.error(message);
          } else {
            toast.error(`Failed to load data source settings: ${message}`);
          }
        }

        if (channelResult.status === "fulfilled") {
          setChannelStatus(channelResult.value);
        } else {
          const message = channelResult.reason instanceof Error ? channelResult.reason.message : "Unknown error";
          toast.error(`${t("settings.channels.refreshFailed")}: ${message}`);
          setChannelStatus(null);
        }

        if (channelConfigResult.status === "fulfilled") {
          const config = channelConfigResult.value;
          const names = Object.keys(config.channels ?? {}).sort((a, b) => a.localeCompare(b));
          const first = names[0] || "";
          setChannelConfig(config);
          setSelectedChannel(first);
          setChannelConfigText(first ? stringifyChannelConfig(config.channels[first].config) : "");
        } else {
          const message = channelConfigResult.reason instanceof Error ? channelConfigResult.reason.message : "Unknown error";
          toast.error(`加载消息通道配置失败: ${message}`);
          setChannelConfig(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [t]);

  const refreshChannelStatus = async () => {
    setChannelRefreshing(true);
    try {
      const [status, config] = await Promise.all([api.getChannelStatus(), api.getChannelConfig()]);
      setChannelStatus(status);
      setChannelConfig(config);
      const nextChannel = selectedChannel && config.channels[selectedChannel]
        ? selectedChannel
        : Object.keys(config.channels ?? {}).sort((a, b) => a.localeCompare(b))[0] || "";
      setSelectedChannel(nextChannel);
      setChannelConfigText(nextChannel ? stringifyChannelConfig(config.channels[nextChannel].config) : "");
    } catch (error) {
      toast.error(`${t("settings.channels.refreshFailed")}: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setChannelRefreshing(false);
    }
  };

  const onSelectedChannelChange = (name: string) => {
    setSelectedChannel(name);
    const nextConfig = channelConfig?.channels[name]?.config ?? {};
    setChannelConfigText(stringifyChannelConfig(nextConfig));
  };

  const submitChannelConfig = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedChannel) return;
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(channelConfigText || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("配置必须是 JSON 对象");
      }
      parsed = value as Record<string, unknown>;
    } catch (error) {
      toast.error(`消息通道配置 JSON 格式不正确: ${error instanceof Error ? error.message : "Unknown error"}`);
      return;
    }

    setChannelConfigSaving(true);
    try {
      const updated = await api.updateChannelConfig(selectedChannel, {
        enabled: Boolean(parsed.enabled),
        config: parsed,
      });
      setChannelConfig(updated);
      const next = updated.channels[selectedChannel];
      if (next) setChannelConfigText(stringifyChannelConfig(next.config));
      setChannelStatus(await api.getChannelStatus());
      toast.success("消息通道配置已保存");
    } catch (error) {
      toast.error(`保存消息通道配置失败: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setChannelConfigSaving(false);
    }
  };

  const setChannelsRunning = async (action: "start" | "stop") => {
    setChannelAction(action);
    try {
      const updated = action === "start" ? await api.startChannels() : await api.stopChannels();
      setChannelStatus(updated);
      toast.success(action === "start" ? t("settings.channels.started") : t("settings.channels.stoppedToast"));
    } catch (error) {
      toast.error(`${action === "start" ? t("settings.channels.startFailed") : t("settings.channels.stopFailed")}: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setChannelAction(null);
    }
  };

  const providers = settings?.providers ?? [];
  const selectedProvider = useMemo<LLMProviderOption | undefined>(
    () => providers.find((provider) => provider.name === form?.provider),
    [form?.provider, providers],
  );

  const applyProviderDefaults = (provider = selectedProvider) => {
    if (!provider || !form) return;
    setForm({
      ...form,
      model_name: provider.default_model,
      base_url: provider.default_base_url,
    });
  };

  const onProviderChange = (name: string) => {
    const provider = providers.find((item) => item.name === name);
    if (!provider || !form) return;
    setForm({
      ...form,
      provider: provider.name,
      model_name: provider.default_model,
      base_url: provider.default_base_url,
    });
    setApiKey("");
    setClearApiKey(false);
  };

  const submitLocalApiKey = (event: FormEvent) => {
    event.preventDefault();
    setApiAuthKey(localApiKey);
    toast.success("Local API key saved");
    window.location.reload();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const updated = await api.updateLLMSettings({
        ...form,
        api_key: apiKey.trim() || undefined,
        clear_api_key: clearApiKey,
      });
      setSettings(updated);
      setForm(toForm(updated));
      setApiKey("");
      setClearApiKey(false);
      toast.success("LLM settings saved");
    } catch (error) {
      toast.error(`Failed to save LLM settings: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const submitDataSources = async (event: FormEvent) => {
    event.preventDefault();
    setDataSaving(true);
    try {
      const updated = await api.updateDataSourceSettings({
        tushare_token: tushareToken.trim() || undefined,
        clear_tushare_token: clearTushareToken,
      });
      setDataSettings(updated);
      setTushareToken("");
      setClearTushareToken(false);
      toast.success("Data source settings saved");
    } catch (error) {
      toast.error(`Failed to save data source settings: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setDataSaving(false);
    }
  };

  const localApiAccessSection = (
    <form onSubmit={submitLocalApiKey} className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="mb-4 space-y-1">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{"访问安全"}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">高级</span>
        </div>
        <p className="text-sm text-muted-foreground">{"远程部署或私有访问时使用。本机 localhost 使用通常可以留空，普通用户一般不需要配置。"}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-2">
          <span className={labelClass}>{"服务器访问密钥"}</span>
          <input
            type="password"
            value={localApiKey}
            onChange={(event) => setLocalApiKeyState(event.target.value)}
            className={fieldClass}
            placeholder={"仅保存在当前浏览器。留空保存可清除。"}
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Save className="h-4 w-4" />
          {i18n.t("settings.save")}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{"只影响当前浏览器访问后端接口，不会改变模型或行情数据源配置。"}</p>
    </form>
  );

  if (loading || !form || !settings || !dataSettings) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{"系统设置"}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{"配置智能体模型、行情数据源、消息通道和访问安全。普通用户优先检查「智能体模型」和「行情与数据源」。"}</p>
        </div>
        {localApiAccessSection}
        <div className="flex min-h-32 items-center justify-center rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          {settingsLoadError ? (
            <div className="text-center">
              <div className="font-medium text-foreground">{"设置暂不可用"}</div>
              <div className="mt-1">{settingsLoadError}</div>
            </div>
          ) : (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {"正在加载设置..."}
            </>
          )}
        </div>
      </div>
    );
  }

  const keyStatus = settings.api_key_configured
    ? "Configured"
    : settings.api_key_required
      ? "Leave blank to keep the current key"
      : selectedProvider?.auth_type === "oauth" && selectedProvider.login_command
        ? `This provider uses OAuth. Run: ${selectedProvider.login_command}`
        : "This provider does not require an API key.";
  const apiKeyDisabled = !selectedProvider?.api_key_required || clearApiKey;
  const tushareStatus = dataSettings.tushare_token_configured
    ? "当前账号已配置"
    : "留空则保持当前账号现有配置";
  const channelRows = channelStatus
    ? Object.entries(channelStatus.channels ?? {}).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const channelConfigRows = channelConfig
    ? Object.entries(channelConfig.channels ?? {}).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const selectedChannelConfig = selectedChannel ? channelConfig?.channels[selectedChannel] : undefined;
  const channelEnabledCount = channelRows.filter(([, item]) => item.enabled).length;
  const channelLoadedCount = channelRows.filter(([, item]) => item.loaded).length;
  const channelUnavailableCount = channelRows.filter(([, item]) => item.available === false).length;
  const channelBusy = channelRefreshing || channelConfigSaving || channelAction !== null;

  const channelsSection = (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquareMore className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{"消息通道"}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">高级</span>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{"这里可以配置外部消息入口，例如钉钉、飞书、Telegram、Email。普通网页使用不需要启用；保存后会重建通道运行时。"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refreshChannelStatus}
            disabled={channelBusy}
            className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {channelRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("settings.channels.refresh")}
          </button>
          <button
            type="button"
            onClick={() => setChannelsRunning("start")}
            disabled={channelBusy || !channelStatus}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {channelAction === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t("settings.channels.start")}
          </button>
          <button
            type="button"
            onClick={() => setChannelsRunning("stop")}
            disabled={channelBusy || !channelStatus}
            className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {channelAction === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {t("settings.channels.stop")}
          </button>
        </div>
      </div>

      {channelStatus ? (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">{t("settings.channels.runtime")}</div>
              <div className="text-sm font-medium">{channelStatus.running ? t("settings.channels.running") : t("settings.channels.stopped")}</div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">{t("settings.channels.enabled")}</div>
              <div className="text-sm font-medium">{channelEnabledCount}</div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">{t("settings.channels.loaded")}</div>
              <div className="text-sm font-medium">{channelLoadedCount}</div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">{t("settings.channels.unavailable")}</div>
              <div className="text-sm font-medium">{channelUnavailableCount}</div>
            </div>
          </div>

          {channelConfig ? (
            <form onSubmit={submitChannelConfig} className="mb-4 rounded-md border bg-muted/10 p-4">
              <div className="mb-4 grid gap-3 md:grid-cols-[minmax(220px,0.45fr)_minmax(0,1fr)]">
                <label className="grid gap-2">
                  <span className={labelClass}>{"选择消息通道"}</span>
                  <select
                    value={selectedChannel}
                    onChange={(event) => onSelectedChannelChange(event.target.value)}
                    className={fieldClass}
                  >
                    {channelConfigRows.map(([name, item]) => (
                      <option key={name} value={name}>
                        {item.display_name || name} ({name})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{selectedChannelConfig?.display_name || selectedChannel || "未选择通道"}</div>
                  <div className="mt-1">
                    {selectedChannelConfig?.available === false
                      ? selectedChannelConfig.install_hint || selectedChannelConfig.error || "当前通道依赖未安装或不可用"
                      : "可以在下面编辑该通道的启用状态和连接参数。密钥字段会脱敏显示，保留 ******** 保存时不会覆盖原密钥。"}
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px]">配置文件：{channelConfig.config_path}</div>
                </div>
              </div>

              <label className="grid gap-2">
                <span className={labelClass}>{"通道配置 JSON"}</span>
                <textarea
                  value={channelConfigText}
                  onChange={(event) => setChannelConfigText(event.target.value)}
                  className={`${fieldClass} min-h-48 font-mono text-xs leading-relaxed`}
                  spellCheck={false}
                />
                <span className={hintClass}>{"把 enabled 改为 true 即启用该通道；保存后如果通道已启动，请重新点击启动通道使配置生效。"}</span>
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={channelBusy || !selectedChannel}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {channelConfigSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {channelConfigSaving ? "正在保存..." : "保存通道配置"}
                </button>
                <button
                  type="button"
                  onClick={() => selectedChannelConfig && setChannelConfigText(stringifyChannelConfig(selectedChannelConfig.config))}
                  disabled={channelBusy || !selectedChannelConfig}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="h-4 w-4" />
                  {"还原当前显示值"}
                </button>
              </div>
            </form>
          ) : null}

          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.channel")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.state")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.recovery")}</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map(([name, item]) => (
                  <tr key={name} className="border-t">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{item.display_name || name}</div>
                      <div className="text-xs text-muted-foreground">{name}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${item.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {item.enabled ? t("settings.channels.enabled") : t("settings.channels.disabled")}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${item.loaded ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                          {item.loaded ? t("settings.channels.loaded") : t("settings.channels.notLoaded")}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${item.running ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                          {item.running ? t("settings.channels.running") : t("settings.channels.stopped")}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-md px-3 py-2 align-top text-xs text-muted-foreground">
                      {item.install_hint || item.error || t("settings.channels.noRecovery")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("settings.channels.refreshFailed")}
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{"系统设置"}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{"这里是产品后台配置中心。普通中文用户优先关注模型和行情数据源；消息通道、访问安全属于高级配置。"}</p>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold">{"1. 智能体模型"}</div>
          <p className="mt-1 text-xs text-muted-foreground">{"决定智能体使用哪个模型、回答速度、稳定性和成本。"}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold">{"2. 行情与数据源"}</div>
          <p className="mt-1 text-xs text-muted-foreground">{"配置 A 股、宏观、回测和研究所需的数据凭证。"}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-semibold">{"3. 高级能力"}</div>
          <p className="mt-1 text-xs text-muted-foreground">{"消息通道和访问安全，主要给远程部署或外部 IM 接入使用。"}</p>
        </div>
      </section>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{"智能体模型"}</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">常用</span>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{"公开版默认使用本地 Ollama 模型，不需要云 API 密钥；如需云模型，请在私有分支中自行扩展。"}</p>
      </div>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <section className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{"模型连接"}</h2>
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>{i18n.t("settings.provider")}</span>
              <select
                value={form.provider}
                onChange={(event) => onProviderChange(event.target.value)}
                className={fieldClass}
              >
                {providers.map((provider) => (
                  <option key={provider.name} value={provider.name}>{provider.label}</option>
                ))}
              </select>
              <span className={hintClass}>{"公开版仅保留本地模型入口，避免误用作者或服务器上的付费 API 额度。"}</span>
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{"模型"}</span>
              <div className="flex gap-2">
                <input
                  value={form.model_name}
                  onChange={(event) => setForm({ ...form, model_name: event.target.value })}
                  className={fieldClass}
                  required
                />
                <button
                  type="button"
                  onClick={() => applyProviderDefaults()}
                  className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title={"使用提供商默认设置"}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="hidden sm:inline">{"恢复默认"}</span>
                </button>
              </div>
              <span className={hintClass}>{"请填写提供商要求的准确模型 ID。"}</span>
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{i18n.t("settings.baseUrl")}</span>
              <input
                value={form.base_url}
                onChange={(event) => setForm({ ...form, base_url: event.target.value })}
                className={fieldClass}
                placeholder={selectedProvider?.default_base_url}
                disabled={selectedProvider?.auth_type === "oauth"}
              />
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>
                {selectedProvider?.api_key_required ? "模型 API 密钥" : "本地模型无需密钥"}
              </span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className={`${fieldClass} pl-9`}
                  placeholder={keyStatus}
                  autoComplete="current-password"
                  disabled={apiKeyDisabled}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={hintClass}>{keyStatus}</span>
                {selectedProvider?.api_key_required ? (
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(event) => {
                        setClearApiKey(event.target.checked);
                        if (event.target.checked) setApiKey("");
                      }}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {"清除已保存密钥"}
                  </label>
                ) : null}
              </div>
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{"生成参数"}</h2>
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>{i18n.t("settings.temperature")}</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })}
                className={fieldClass}
              />
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{i18n.t("settings.timeoutSeconds")}</span>
              <input
                type="number"
                min={1}
                max={3600}
                step={1}
                value={form.timeout_seconds}
                onChange={(event) => setForm({ ...form, timeout_seconds: Number(event.target.value) })}
                className={fieldClass}
              />
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{"最大重试次数"}</span>
              <input
                type="number"
                min={0}
                max={20}
                step={1}
                value={form.max_retries}
                onChange={(event) => setForm({ ...form, max_retries: Number(event.target.value) })}
                className={fieldClass}
              />
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{i18n.t("settings.reasoningEffort")}</span>
              <select
                value={form.reasoning_effort}
                onChange={(event) => setForm({ ...form, reasoning_effort: event.target.value })}
                className={fieldClass}
              >
                <option value="">{"关闭"}</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="max">max</option>
              </select>
              <span className={hintClass}>{"模型回答前的思考强度。越高越深入但更慢；日常使用建议关闭或中等。"}</span>
            </label>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">保存范围： </span>
              <span>{settings.scope === "user" ? "仅当前登录账号可用" : "项目级配置"}</span>
              {settings.owner_user_id ? (
                <span className="ml-2 break-all font-mono text-[11px]">({settings.owner_user_id})</span>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? i18n.t("settings.saving") : i18n.t("settings.save")}
            </button>
          </div>
        </section>
      </form>

      <form onSubmit={submitDataSources} className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-5 space-y-1">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{"行情与数据源"}</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">当前账号</span>
          </div>
          <p className="text-sm text-muted-foreground">{"这里配置的是当前登录账号自己的数据源凭证，只对本账号的单票分析、财务数据和回测取数生效，不会共享给其他白名单用户。"}</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>{"我的 Tushare Token"}</span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={tushareToken}
                  onChange={(event) => setTushareToken(event.target.value)}
                  className={`${fieldClass} pl-9`}
                  placeholder={tushareStatus}
                  autoComplete="current-password"
                  disabled={clearTushareToken}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={hintClass}>{"用于当前账号的 A 股行情、财务、基金、期货和宏观数据。未配置时会尽量回退到 AKShare 等免费源；不会使用管理员或其他用户的 Token。"}</span>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearTushareToken}
                    onChange={(event) => {
                      setClearTushareToken(event.target.checked);
                      if (event.target.checked) setTushareToken("");
                    }}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {"清除当前账号保存的 Tushare Token"}
                </label>
              </div>
            </label>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">保存范围： </span>
              <span>{dataSettings.scope === "user" ? "仅当前登录账号可用" : "项目级配置"}</span>
              {dataSettings.owner_user_id ? (
                <span className="ml-2 break-all font-mono text-[11px]">({dataSettings.owner_user_id})</span>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={dataSaving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {dataSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {dataSaving ? i18n.t("settings.saving") : "保存我的数据源设置"}
            </button>
          </div>

          <div className="rounded-md border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{"BaoStock"}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${dataSettings.baostock_supported ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                {dataSettings.baostock_supported ? "加载器可用" : "暂无项目加载器"}
              </span>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{dataSettings.baostock_message}</p>
              <p>
                {dataSettings.baostock_installed
                  ? "Python 包已安装"
                  : "Python 包未安装"}
              </p>
            </div>
          </div>
        </div>
      </form>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{"高级配置"}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">可选</span>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{"这些功能面向远程部署、外部消息入口和运维场景。普通本地投研使用可以先不配置。"}</p>
      </div>

      {channelsSection}

      {localApiAccessSection}
    </div>
  );
}
