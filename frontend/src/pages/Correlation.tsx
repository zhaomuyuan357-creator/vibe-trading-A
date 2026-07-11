import i18n from '@/i18n';
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Sparkles } from "lucide-react";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";

const WINDOWS = [30, 60, 90, 180, 365] as const;

export function Correlation() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState("000001.SZ,600519.SH,000858.SZ,601318.SH");
  const [days, setDays] = useState<number>(90);
  const [method, setMethod] = useState<"pearson" | "spearman">("pearson");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [labels, setLabels] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<number[][]>([]);

  const compute = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await request<{ labels: string[]; matrix: number[][] }>(
        `/correlation?codes=${encodeURIComponent(codes)}&days=${days}&method=${method}`
      );
      setLabels(result.labels);
      setMatrix(result.matrix);
    } catch (e) {
      setError(e instanceof Error ? e.message : i18n.t("correlation.failedToCompute"));
    } finally {
      setLoading(false);
    }
  };

  const goToPortfolioOptimization = () => {
    const normalizedCodes = codes
      .split(/[,，\s]+/)
      .map((code) => code.trim())
      .filter(Boolean);
    const methodLabel = method === "pearson" ? "Pearson 线性相关" : "Spearman 秩相关";
    const matrixPayload = labels.length > 0 && matrix.length > 0
      ? `\n\n当前相关性矩阵数据：${JSON.stringify({ labels, matrix })}`
      : "\n\n如果当前没有矩阵结果，请先拉取行情并计算这些资产的相关性。";
    const prompt = [
      `请用以下资产池做 A 股组合优化：${normalizedCodes.join("、") || codes}。`,
      `相关性观察窗口：近 ${days} 日；相关性方法：${methodLabel}。`,
      "请先解释这些资产的相关性结构，再做等权、风险平价、最大分散化组合对比。",
      "输出每种组合的建议权重、主要风险、分散化效果、关键假设和可验证的数据来源。",
      "请明确说明这不是投资建议，只作为研究分析。",
      matrixPayload,
    ].join("\n");

    navigate(`/agent?prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{i18n.t("correlation.title")}</h1>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
        <div className="font-medium text-foreground">这个页面先定义资产池，再观察它们是否经常同涨同跌。</div>
        <p className="mt-1">
          相关性越接近 1，说明两个资产走势越同步，组合里容易形成重复暴露；越接近 0 或为负，越可能提供分散化价值。
          矩阵可以作为风险平价、最大分散化、均值方差等组合优化的输入依据。
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 border rounded-lg p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{i18n.t("correlation.assetCodes")}</label>
          <input
            type="text"
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
            placeholder="000001.SZ,600519.SH,000858.SZ"
            className="w-full px-3 py-2 rounded-md border bg-background text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {i18n.t("correlation.assetCodesHint")}
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{i18n.t("correlation.windowDays")}</label>
            <div className="flex gap-1.5">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setDays(w)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                    days === w
                      ? "bg-primary text-primary-foreground"
                      : "border-muted-foreground/30 hover:border-primary"
                  }`}
                  title={`${w} 日窗口表示用最近 ${w} 个交易日的收益率关系来计算相关性`}
                >
                  {w}日
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              60日偏短期，120日/180日偏中期，250日/365日更接近一年维度。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{i18n.t("correlation.method")}</label>
            <div className="flex gap-1.5">
              {(["pearson", "spearman"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${
                    method === m
                      ? "bg-primary text-primary-foreground"
                      : "border-muted-foreground/30 hover:border-primary"
                  }`}
                >
                  {i18n.t(`correlation.method_${m}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={compute}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? i18n.t("correlation.loading") : i18n.t("correlation.compute")}
          </button>
          <button
            type="button"
            onClick={goToPortfolioOptimization}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Sparkles className="h-4 w-4" />
            用这些资产做组合优化
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-danger border border-danger/30 rounded p-3 bg-danger/5">
          {error}
        </div>
      )}

      {/* Chart */}
      {labels.length > 0 && (
        <div className="grid gap-3">
          <CorrelationMatrix labels={labels} matrix={matrix} height={520} />
          <div className="rounded-lg border bg-background p-4 text-sm leading-relaxed text-muted-foreground">
            <div className="font-medium text-foreground">怎么把矩阵用于组合优化</div>
            <p className="mt-1">
              先找出高度相关的一组资产，避免把它们误认为多个独立机会；再优先比较低相关或负相关资产的组合权重。
              风险平价会用波动率和相关性分配风险贡献，最大分散化会偏向能降低组合整体相关暴露的资产。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Minimal request helper (avoids importing the full api client which may have path issues)
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const BASE = "";
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}
