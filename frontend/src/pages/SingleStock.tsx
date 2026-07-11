import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Database, History, Loader2, MessageSquare, Save, Search, ShieldCheck } from "lucide-react";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { api, type SingleStockAnalysis, type SingleStockAnalysisRecord } from "@/lib/api";

function fmt(value: number | null | undefined, suffix = "", digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })}${suffix}`;
}

function yuan(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
  return value.toFixed(0);
}

function text(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "N/A";
  return String(value);
}

function SourceLink({ href, children }: { href?: string; children: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  );
}

const supplementalLabels: Record<string, string> = {
  fund_flow: "资金流",
  dragon_tiger: "龙虎榜",
  financials: "财务指标",
  announcements: "上市公司公告",
  news: "个股新闻",
};

const rowFieldLabels: Record<string, string> = {
  date: "日期",
  time: "时间",
  title: "标题",
  name: "名称",
  source: "来源",
  detail: "说明",
  type: "类型",
  side: "方向",
  main_net_inflow: "主力净流入",
  main_net_inflow_pct: "主力净占比",
  five_day_main_net_inflow: "5日主力净流入",
  five_day_main_net_inflow_pct: "5日主力净占比",
  super_large_net_inflow: "超大单净流入",
  super_large_net_inflow_pct: "超大单净占比",
  large_net_inflow: "大单净流入",
  large_net_inflow_pct: "大单净占比",
  medium_net_inflow: "中单净流入",
  medium_net_inflow_pct: "中单净占比",
  small_net_inflow: "小单净流入",
  small_net_inflow_pct: "小单净占比",
  close: "收盘价",
  pct_chg: "涨跌幅",
  value: "数值",
  period: "报告期",
  publish_date: "发布日期",
  url: "链接",
};

const moneyFields = new Set([
  "main_net_inflow",
  "five_day_main_net_inflow",
  "super_large_net_inflow",
  "large_net_inflow",
  "medium_net_inflow",
  "small_net_inflow",
]);

const percentFields = new Set([
  "main_net_inflow_pct",
  "five_day_main_net_inflow_pct",
  "super_large_net_inflow_pct",
  "large_net_inflow_pct",
  "medium_net_inflow_pct",
  "small_net_inflow_pct",
  "pct_chg",
]);

function rowLabel(field: string) {
  return rowFieldLabels[field] || field;
}

function rowValue(field: string, value: unknown) {
  if (typeof value === "number") {
    if (moneyFields.has(field)) return yuan(value);
    if (percentFields.has(field)) return fmt(value, "%");
  }
  return text(value);
}

function riskTone(level: string) {
  if (/高/.test(level)) return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  if (/中/.test(level)) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

const LAST_SINGLE_STOCK_ANALYSIS_ID_KEY = "vibe-trading-a:last-single-stock-analysis-id";

export function SingleStock() {
  const [code, setCode] = useState("002354.SZ");
  const [lookback, setLookback] = useState(120);
  const [analysis, setAnalysis] = useState<SingleStockAnalysis | null>(null);
  const [savedRecords, setSavedRecords] = useState<SingleStockAnalysisRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [chatPrompt, setChatPrompt] = useState("请基于当前单票分析，进一步拆解资金流、技术位、风险点和下一步需要验证的信息。");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bars = useMemo(() => {
    if (!analysis) return [];
    return analysis.price_series[analysis.symbol] || [];
  }, [analysis]);

  const loadHistory = async (target = code) => {
    setHistoryLoading(true);
    try {
      const records = await api.listSingleStockAnalyses(target, 12);
      const normalized = Array.isArray(records) ? records : [];
      setSavedRecords(normalized);
      return normalized;
    } catch {
      setSavedRecords([]);
      return [];
    } finally {
      setHistoryLoading(false);
    }
  };

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    setSaveStatus(null);
    setChatStatus(null);
    try {
      const result = await api.analyzeSingleStock(code, lookback);
      setAnalysis(result);
      try {
        const saved = await api.saveSingleStockAnalysis(result);
        localStorage.setItem(LAST_SINGLE_STOCK_ANALYSIS_ID_KEY, saved.id);
        setSaveStatus(`已自动保存到本地数据库：${saved.id.slice(0, 8)}`);
      } catch (saveErr) {
        setSaveStatus(saveErr instanceof Error ? `自动保存失败：${saveErr.message}` : "自动保存失败");
      }
      void loadHistory(result.symbol);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setLoading(false);
    }
  };

  const saveAnalysis = async () => {
    if (!analysis || saving) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const saved = await api.saveSingleStockAnalysis(analysis);
      localStorage.setItem(LAST_SINGLE_STOCK_ANALYSIS_ID_KEY, saved.id);
      setSaveStatus(`已写入本地数据库，不会下载图片或文件：${saved.id.slice(0, 8)}`);
      await loadHistory(analysis.symbol);
    } catch (err) {
      setSaveStatus(err instanceof Error ? `保存失败：${err.message}` : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const loadSavedAnalysis = async (record: SingleStockAnalysisRecord) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await api.getSingleStockAnalysis(record.id);
      setCode(detail.symbol);
      setLookback(detail.lookback || lookback);
      setAnalysis(detail.payload);
      localStorage.setItem(LAST_SINGLE_STOCK_ANALYSIS_ID_KEY, detail.id);
      setSaveStatus(`已读取历史分析：${record.created_at}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取历史分析失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const restoreLatestAnalysis = async () => {
      const records = await loadHistory();
      if (cancelled || records.length === 0) return;

      const lastId = localStorage.getItem(LAST_SINGLE_STOCK_ANALYSIS_ID_KEY);
      const target = records.find((record) => record.id === lastId) || records[0];
      if (!target) return;

      try {
        const detail = await api.getSingleStockAnalysis(target.id);
        if (cancelled) return;
        setCode(detail.symbol);
        setLookback(detail.lookback || lookback);
        setAnalysis(detail.payload);
        localStorage.setItem(LAST_SINGLE_STOCK_ANALYSIS_ID_KEY, detail.id);
        setSaveStatus(`已自动恢复最近一次分析：${detail.created_at}`);
      } catch {
        if (!cancelled) {
          localStorage.removeItem(LAST_SINGLE_STOCK_ANALYSIS_ID_KEY);
        }
      }
    };

    void restoreLatestAnalysis();
    return () => {
      cancelled = true;
    };
  }, []);

  const startAnalysisChat = async () => {
    if (!analysis || !chatPrompt.trim() || chatLoading) return;
    setChatLoading(true);
    setChatStatus(null);
    try {
      const factorLines = analysis.factors.rows
        .map((row) => `${row.name}: 得分${row.score}, 权重${Math.round(row.weight * 100)}%, 依据=${row.evidence}`)
        .join("\n");
      const levelLines = analysis.level_probabilities
        .slice(0, 5)
        .map((level) => `${level.name}: ${level.price}, 5日${level.touch_probability_5d}%, 10日${level.touch_probability_10d}%, 依据=${level.basis}`)
        .join("\n");
      const evidenceLines = analysis.evidence
        .slice(0, 8)
        .map((item) => `${item.label}: ${item.status}, ${item.source}, ${item.as_of}, ${item.detail}`)
        .join("\n");
      const supplementalLines = Object.entries(analysis.supplemental || {})
        .map(([key, section]) => `${supplementalLabels[key] || key}: ${section.status}; ${section.summary || section.source}`)
        .join("\n");
      const compactContext = [
        `股票: ${analysis.symbol}`,
        `日期: ${analysis.as_of}`,
        `回看: ${analysis.lookback}日`,
        `状态: ${analysis.status_label}`,
        `风险: ${analysis.risk_level}`,
        `最新收盘: ${fmt(analysis.summary.latest_close)}, 涨跌幅: ${fmt(analysis.summary.latest_change_pct, "%")}`,
        `区间涨跌幅: ${fmt(analysis.summary.lookback_return_pct, "%")}, 最大回撤: ${fmt(analysis.summary.max_drawdown_pct, "%")}`,
        `综合因子分: ${fmt(analysis.factors.composite_score, "", 1)}`,
        `组合因子:\n${factorLines}`,
        `关键价位:\n${levelLines}`,
        `信息源状态:\n${supplementalLines}`,
        `证据链:\n${evidenceLines}`,
        `风险提示:\n${analysis.warnings.join("；")}`,
      ].join("\n\n");
      const session = await api.createSession(`单票分析 ${analysis.symbol}`, {
        mode: "single_stock_analysis_v2",
        symbol: analysis.symbol,
        as_of: analysis.as_of,
      });
      const prompt = [
        "你是A股单票研究助手。请只基于下面这份已生成的单票分析快照和可验证证据链回答，明确区分事实、模型计算和待验证信息。",
        `当前分析快照：\n${compactContext}`,
        `用户问题：${chatPrompt.trim()}`,
      ].join("\n\n");
      await api.sendMessage(session.session_id, prompt);
      window.dispatchEvent(new CustomEvent("vibe:sessions-refresh"));
      setChatStatus(`已创建对话并刷新左侧会话列表：${session.session_id.slice(0, 8)}。`);
    } catch (err) {
      setChatStatus(err instanceof Error ? `对话启动失败：${err.message}` : "对话启动失败");
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-background p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BarChart3 className="h-4 w-4" />
              A股单只股票分析 v2
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">单票分析工作台</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              v2：固定模板输出、SQLite 本地保存、历史读取，以及基于当前分析的对话入口。
            </p>
          </div>
          <form onSubmit={run} className="flex flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="002354.SZ"
              className="h-9 w-36 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <select
              value={lookback}
              onChange={(event) => setLookback(Number(event.target.value))}
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value={60}>60日</option>
              <option value={120}>120日</option>
              <option value={250}>250日</option>
            </select>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              分析
            </button>
          </form>
        </div>

        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {!analysis ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
              输入 A 股代码后点击分析，v2 会基于可验证的行情和信息源生成确定性研究报告。
            </div>
            <HistoryPanel records={savedRecords} loading={historyLoading} onLoad={loadSavedAnalysis} />
          </div>
        ) : (
          <>
            <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <Database className="h-4 w-4 text-primary" />
                      数据库存储
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      点击后写入本地 SQLite 数据库，后续从历史记录读取；不会保存成图片，也不会触发下载。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={saveAnalysis}
                    disabled={saving}
                    className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    保存到数据库
                  </button>
                </div>
                {saveStatus ? <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{saveStatus}</div> : null}
              </div>
              <HistoryPanel records={savedRecords} loading={historyLoading} onLoad={loadSavedAnalysis} />
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">股票 / 日期</div>
                <div className="mt-1 text-xl font-semibold">{analysis.symbol}</div>
                <div className="text-xs text-muted-foreground">截至 {analysis.as_of}</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">最新收盘</div>
                <div className="mt-1 text-xl font-semibold">{fmt(analysis.summary.latest_close)}</div>
                <div className="text-xs text-muted-foreground">涨跌幅 {fmt(analysis.summary.latest_change_pct, "%")}</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="text-xs text-muted-foreground">综合因子分</div>
                <div className="mt-1 text-xl font-semibold">{fmt(analysis.factors.composite_score, "", 1)}</div>
                <div className="text-xs text-muted-foreground">技术分 {analysis.technical.technical_score}</div>
              </div>
              <div className={`rounded-lg border p-4 ${riskTone(analysis.risk_level)}`}>
                <div className="text-xs opacity-80">状态 / 风险</div>
                <div className="mt-1 text-xl font-semibold">{analysis.status_label}</div>
                <div className="text-xs opacity-80">风险等级：{analysis.risk_level}</div>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">基于当前分析对话</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                会把当前 K线摘要、组合因子、价位概率、证据链和风险提示作为上下文，创建会话并显示到左侧会话列表。
              </p>
              <div className="mt-3 flex flex-col gap-2 md:flex-row">
                <textarea
                  value={chatPrompt}
                  onChange={(event) => setChatPrompt(event.target.value)}
                  rows={3}
                  className="min-h-20 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={startAnalysisChat}
                  disabled={chatLoading || !chatPrompt.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60 md:self-end"
                >
                  {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                  发起对话
                </button>
              </div>
              {chatStatus ? <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{chatStatus}</div> : null}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">K线与均线</h2>
                  <p className="text-xs text-muted-foreground">复用项目原生 K 线组件，支持 MA、BOLL、MACD、RSI、KDJ 切换。</p>
                </div>
                <div className="text-xs text-muted-foreground">数据：东方财富行情优先，失败时自动切换至新浪日线行情</div>
              </div>
              <CandlestickChart data={bars} height={520} />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <h2 className="text-base font-semibold">行情概览</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <Metric label="区间涨跌幅" value={fmt(analysis.summary.lookback_return_pct, "%")} />
                  <Metric label="区间位置" value={fmt(analysis.summary.range_position_pct, "%")} />
                  <Metric label="区间高点" value={fmt(analysis.summary.lookback_high)} />
                  <Metric label="区间低点" value={fmt(analysis.summary.lookback_low)} />
                  <Metric label="最大回撤" value={fmt(analysis.summary.max_drawdown_pct, "%")} />
                  <Metric label="20日年化波动" value={fmt(analysis.summary.realized_vol_20d_pct, "%")} />
                  <Metric label="ATR14" value={fmt(analysis.summary.atr14_pct, "%")} />
                  <Metric label="成交额" value={yuan(analysis.summary.amount)} />
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <h2 className="text-base font-semibold">均线状态</h2>
                <div className="mt-3 overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(analysis.technical.moving_averages).map(([name, value]) => (
                        <tr key={name} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-muted-foreground">{name}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{analysis.technical.trend_comment}</p>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">组合因子评分</h2>
                  <p className="text-xs text-muted-foreground">{analysis.factors.formula || "综合因子分 = Σ(单项得分 × 权重)"}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">加权总分</div>
                  <div className="text-2xl font-semibold tabular-nums">{fmt(analysis.factors.composite_score, "", 1)}</div>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto rounded-md border">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">因子</th>
                      <th className="px-3 py-2 text-right">权重</th>
                      <th className="px-3 py-2 text-right">得分</th>
                      <th className="px-3 py-2 text-right">加权贡献</th>
                      <th className="px-3 py-2 text-left">依据</th>
                      <th className="px-3 py-2 text-left">来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.factors.rows.map((row) => (
                      <tr key={row.name} className="border-t">
                        <td className="px-3 py-2 font-medium">{row.name}</td>
                        <td className="px-3 py-2 text-right">{fmt(row.weight * 100, "%", 0)}</td>
                        <td className="px-3 py-2 text-right font-mono">{row.score}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmt(row.weighted_score ?? row.score * row.weight, "", 1)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.evidence}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <SourceLink href={row.source_url}>{row.source}</SourceLink>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-base font-semibold">关键价位触达概率</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                v1 为统计代理模型：ATR + 20日波动率 + 当前价到关键位距离。它是概率估计，不是价格预测。
              </p>
              <div className="mt-3 overflow-x-auto rounded-md border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">价位</th>
                      <th className="px-3 py-2 text-right">价格</th>
                      <th className="px-3 py-2 text-right">距离</th>
                      <th className="px-3 py-2 text-right">5日触达</th>
                      <th className="px-3 py-2 text-right">10日触达</th>
                      <th className="px-3 py-2 text-left">依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.level_probabilities.map((level) => (
                      <tr key={`${level.name}-${level.price}`} className="border-t">
                        <td className="px-3 py-2 font-medium">{level.name}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmt(level.price)}</td>
                        <td className="px-3 py-2 text-right">{fmt(level.distance_pct, "%")}</td>
                        <td className="px-3 py-2 text-right">{level.touch_probability_5d}%</td>
                        <td className="px-3 py-2 text-right">{level.touch_probability_10d}%</td>
                        <td className="px-3 py-2 text-muted-foreground">{level.basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {analysis.supplemental ? (
              <section className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">真实信息源</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  资金流、龙虎榜、财报、公告和新闻按接口实际返回展示；失败项保留失败原因，避免伪造结论。
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {Object.entries(analysis.supplemental).map(([key, section]) => (
                    <div key={key} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{supplementalLabels[key] || key}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            <SourceLink href={section.url}>{section.source}</SourceLink>
                          </div>
                        </div>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{section.status}</span>
                      </div>
                      {section.summary ? <div className="mt-2 text-xs text-muted-foreground">{section.summary}</div> : null}
                      {section.rows?.length ? (
                        <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1 text-xs">
                          {section.rows.slice(0, 5).map((row, index) => {
                            const title = text(row.title ?? row.name ?? row.date ?? row.time ?? `记录 ${index + 1}`);
                            const subtitle = text(row.detail ?? row.source ?? row.type ?? row.side ?? "");
                            const url = typeof row.url === "string" ? row.url : "";
                            return (
                              <div key={`${key}-${index}`} className="rounded bg-muted/40 p-2">
                                <div className="font-medium">
                                  {url ? (
                                    <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                      {title}
                                    </a>
                                  ) : (
                                    title
                                  )}
                                </div>
                                {subtitle && subtitle !== "N/A" ? <div className="mt-1 text-muted-foreground">{subtitle}</div> : null}
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                                  {Object.entries(row)
                                    .filter(([field]) => !["title", "name", "detail", "source", "type", "side", "url"].includes(field))
                                    .slice(0, 5)
                                    .map(([field, value]) => (
                                      <span key={field}>
                                        {rowLabel(field)}：{rowValue(field, value)}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h2 className="text-base font-semibold">风险提示</h2>
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  {analysis.warnings.map((warning) => (
                    <li key={warning} className="rounded-md bg-muted/50 p-2 text-muted-foreground">{warning}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">证据链</h2>
                </div>
                <div className="mt-3 space-y-2">
                  {analysis.evidence.map((item) => (
                    <div key={`${item.label}-${item.status}`} className="rounded-md border p-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{item.label}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        来源：<SourceLink href={item.url}>{item.source}</SourceLink> / {item.as_of}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <h2 className="text-base font-semibold">免责声明</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{analysis.disclaimer}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-medium">{value}</div>
    </div>
  );
}

function HistoryPanel({
  records,
  loading,
  onLoad,
}: {
  records: SingleStockAnalysisRecord[];
  loading: boolean;
  onLoad: (record: SingleStockAnalysisRecord) => void;
}) {
  return (
    <aside className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">历史分析</h2>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">读取本地 SQLite 已保存快照，适合快速复盘同一只股票。</p>
      <div className="mt-3 max-h-80 space-y-2 overflow-auto pr-1">
        {records.length === 0 ? (
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">暂无保存记录。</div>
        ) : (
          records.map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => onLoad(record)}
              className="w-full rounded-md border bg-background p-3 text-left text-sm hover:bg-muted/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{record.symbol}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {record.risk_level || "未分级"}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">截至 {record.as_of} / {record.lookback}日</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>综合分 {fmt(record.composite_score, "", 1)}</span>
                <span>{record.created_at}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
