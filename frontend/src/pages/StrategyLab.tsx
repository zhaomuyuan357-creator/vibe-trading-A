import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, BarChart3, Play, Settings2, SlidersHorizontal } from "lucide-react";

type StrategyKey = "ma_cross" | "rsi_reversal" | "breakout" | "factor_score";
type FactorDirection = "positive" | "negative";
type FactorNormalize = "zscore" | "rank" | "percentile";

interface FactorConfig {
  direction: FactorDirection;
  weight: string;
  normalize: FactorNormalize;
}

const STRATEGIES: Array<{
  key: StrategyKey;
  name: string;
  desc: string;
  useCase: string;
}> = [
  {
    key: "ma_cross",
    name: "双均线趋势策略",
    desc: "短均线上穿长均线买入，下穿卖出，用于观察趋势跟随效果。",
    useCase: "适合趋势较明显的标的，容易解释，适合作为回测入门模板。",
  },
  {
    key: "rsi_reversal",
    name: "RSI 超卖反转策略",
    desc: "RSI 低位买入，高位止盈或退出，用于测试短期反弹胜率。",
    useCase: "适合震荡市场和均值回归假设，但需要严格止损。",
  },
  {
    key: "breakout",
    name: "突破回踩策略",
    desc: "价格突破近期高点后等待回踩确认，再观察后续上涨概率。",
    useCase: "适合强势股、题材股或趋势启动后的跟踪。",
  },
  {
    key: "factor_score",
    name: "多因子评分策略",
    desc: "结合动量、波动率、成交量、估值或质量因子做综合打分。",
    useCase: "适合股票池筛选和组合构建，需要更完整的数据源。",
  },
];

function parseFactorIds(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function defaultFactorConfig(index: number): FactorConfig {
  return {
    direction: "positive",
    weight: index === 0 ? "40" : "20",
    normalize: "zscore",
  };
}

export function StrategyLab() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFactorIds = searchParams.get("factors") || "";
  const initialStrategy = searchParams.get("strategy") === "factor_score" ? "factor_score" : "ma_cross";
  const [symbol, setSymbol] = useState("000001.SZ");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [capital, setCapital] = useState("100000");
  const [strategy, setStrategy] = useState<StrategyKey>(initialStrategy);
  const [shortMa, setShortMa] = useState("20");
  const [longMa, setLongMa] = useState("60");
  const [rsiBuy, setRsiBuy] = useState("30");
  const [rsiSell, setRsiSell] = useState("70");
  const [breakoutDays, setBreakoutDays] = useState("20");
  const [holdingDays, setHoldingDays] = useState("10");
  const [stopLoss, setStopLoss] = useState("8");
  const [factorIds, setFactorIds] = useState(initialFactorIds);
  const [factorConfigs, setFactorConfigs] = useState<Record<string, FactorConfig>>(() => {
    const ids = parseFactorIds(initialFactorIds);
    return Object.fromEntries(ids.map((id, index) => [id, defaultFactorConfig(index)]));
  });
  const [factorTopN, setFactorTopN] = useState("20");
  const [factorRebalance, setFactorRebalance] = useState("20");
  const [factorNeutralize, setFactorNeutralize] = useState("行业中性");

  const factorList = useMemo(() => parseFactorIds(factorIds), [factorIds]);

  const updateFactorConfig = (id: string, patch: Partial<FactorConfig>) => {
    setFactorConfigs((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? defaultFactorConfig(factorList.indexOf(id))), ...patch },
    }));
  };

  const selected = useMemo(
    () => STRATEGIES.find((item) => item.key === strategy) ?? STRATEGIES[0],
    [strategy],
  );

  const strategyRules = useMemo(() => {
    if (strategy === "ma_cross") {
      return [
        `短均线：${shortMa} 日`,
        `长均线：${longMa} 日`,
        "买入规则：短均线上穿长均线时买入",
        "卖出规则：短均线下穿长均线时卖出",
      ];
    }
    if (strategy === "rsi_reversal") {
      return [
        `买入阈值：RSI 低于 ${rsiBuy}`,
        `卖出阈值：RSI 高于 ${rsiSell}`,
        `最大持有：${holdingDays} 个交易日`,
        `止损：-${stopLoss}%`,
      ];
    }
    if (strategy === "breakout") {
      return [
        `突破窗口：近 ${breakoutDays} 日高点`,
        "买入规则：收盘价突破窗口高点后观察回踩确认",
        `最大持有：${holdingDays} 个交易日`,
        `止损：-${stopLoss}%`,
      ];
    }
    const normalizedFactors = factorList;
    const factorScoreRules = normalizedFactors.map((id, index) => {
      const config = factorConfigs[id] ?? defaultFactorConfig(index);
      const direction = config.direction === "positive" ? "数值越高越好" : "数值越低越好";
      const normalizeLabel = config.normalize === "zscore"
        ? "Z-score 标准化"
        : config.normalize === "rank"
          ? "截面排名标准化"
          : "百分位标准化";
      return `${id}：方向=${direction}；权重=${config.weight}%；标准化=${normalizeLabel}`;
    });
    return [
      normalizedFactors.length > 0
        ? `候选因子：${normalizedFactors.join("、")}`
        : "候选因子：动量、波动率、成交量、流动性、估值、质量",
      ...factorScoreRules.map((rule) => `因子打分：${rule}`),
      `合成方式：按权重加权求和，缺失值中性处理；中性化口径=${factorNeutralize}`,
      `调仓频率：每 ${factorRebalance} 个交易日重新计算一次评分`,
      `买入规则：选择综合评分前 ${factorTopN} 名标的`,
      "风控规则：控制单票权重、行业集中度和最大回撤",
    ];
  }, [breakoutDays, factorConfigs, factorList, factorNeutralize, factorRebalance, factorTopN, holdingDays, longMa, rsiBuy, rsiSell, shortMa, stopLoss, strategy]);

  const prompt = useMemo(() => {
    return [
      "请根据下面的策略配置发起一次策略回测。",
      "",
      `标的：${symbol}`,
      `回测区间：${startDate} 到 ${endDate}`,
      `初始资金：${capital}`,
      `策略类型：${selected.name}`,
      "策略规则：",
      ...strategyRules.map((rule) => `- ${rule}`),
      "",
      "请输出：",
      "- 策略逻辑和适用市场环境",
      "- 使用的数据来源和可验证证据",
      "- 交易规则、仓位规则、手续费和滑点假设",
      "- 总收益率、年化收益、最大回撤、夏普比率、胜率、交易次数",
      "- 净值曲线、回撤曲线、交易明细和失败样本",
      "- 参数是否过拟合，以及下一步可以怎么优化",
      "",
      "请说明这不是投资建议，只作为策略研究。",
    ].join("\n");
  }, [capital, endDate, selected.name, startDate, strategyRules, symbol]);

  const startBacktest = () => {
    navigate(`/agent?prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <section className="flex flex-col gap-3">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          策略先行，再做回测
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">策略配置</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            先选择策略类型、标的、回测区间和参数，再发起回测。回测结果会在智能体完成后进入报告库，便于复盘和对比。
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">1. 选择策略</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {STRATEGIES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStrategy(item.key)}
                className={[
                  "rounded-lg border p-3 text-left transition-colors",
                  strategy === item.key ? "border-primary bg-primary/10" : "hover:bg-muted/50",
                ].join(" ")}
              >
                <div className="font-medium">{item.name}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">适用场景：</span>
            {selected.useCase}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">2. 设置标的和区间</h2>
          </div>
          <div className="grid gap-3">
            <Field label="资产代码" value={symbol} onChange={setSymbol} placeholder="000001.SZ" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="开始日期" value={startDate} onChange={setStartDate} type="date" />
              <Field label="结束日期" value={endDate} onChange={setEndDate} type="date" />
            </div>
            <Field label="初始资金" value={capital} onChange={setCapital} placeholder="100000" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">3. 调整策略参数</h2>
          </div>
          {strategy === "ma_cross" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="短均线（日）" value={shortMa} onChange={setShortMa} />
              <Field label="长均线（日）" value={longMa} onChange={setLongMa} />
            </div>
          ) : strategy === "rsi_reversal" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="RSI 买入阈值" value={rsiBuy} onChange={setRsiBuy} />
              <Field label="RSI 卖出阈值" value={rsiSell} onChange={setRsiSell} />
              <Field label="最大持有天数" value={holdingDays} onChange={setHoldingDays} />
              <Field label="止损幅度（%）" value={stopLoss} onChange={setStopLoss} />
            </div>
          ) : strategy === "breakout" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="突破窗口（日）" value={breakoutDays} onChange={setBreakoutDays} />
              <Field label="最大持有天数" value={holdingDays} onChange={setHoldingDays} />
              <Field label="止损幅度（%）" value={stopLoss} onChange={setStopLoss} />
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">候选因子 ID</span>
                <textarea
                  value={factorIds}
                  onChange={(event) => setFactorIds(event.target.value)}
                  rows={3}
                  placeholder="例如：alpha101_1, gtja191_5, qlib158_12"
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>
              <div className="rounded-lg border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground">
                可以从因子库勾选因子后点击“用于多因子策略”自动带入。这里的因子会作为选股和打分信号，再由智能体生成研究版回测方案。
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="入选数量 Top N" value={factorTopN} onChange={setFactorTopN} />
                <Field label="调仓频率（交易日）" value={factorRebalance} onChange={setFactorRebalance} />
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium">中性化口径</span>
                  <select
                    value={factorNeutralize}
                    onChange={(event) => setFactorNeutralize(event.target.value)}
                    className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="不做中性化">不做中性化</option>
                    <option value="行业中性">行业中性</option>
                    <option value="行业+市值中性">行业+市值中性</option>
                  </select>
                </label>
              </div>
              {factorList.length > 0 ? (
                <div className="overflow-hidden rounded-lg border">
                  <div className="grid grid-cols-[minmax(0,1.2fr)_0.9fr_0.8fr_1fr] gap-2 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>因子</span>
                    <span>方向</span>
                    <span>权重</span>
                    <span>标准化</span>
                  </div>
                  <div className="divide-y">
                    {factorList.map((id, index) => {
                      const config = factorConfigs[id] ?? defaultFactorConfig(index);
                      return (
                        <div key={id} className="grid grid-cols-[minmax(0,1.2fr)_0.9fr_0.8fr_1fr] gap-2 px-3 py-2 text-sm">
                          <div className="truncate font-mono text-xs" title={id}>{id}</div>
                          <select
                            value={config.direction}
                            onChange={(event) => updateFactorConfig(id, { direction: event.target.value as FactorDirection })}
                            className="rounded-md border bg-background px-2 py-1 text-xs"
                          >
                            <option value="positive">越高越好</option>
                            <option value="negative">越低越好</option>
                          </select>
                          <input
                            value={config.weight}
                            onChange={(event) => updateFactorConfig(id, { weight: event.target.value })}
                            className="rounded-md border bg-background px-2 py-1 text-xs"
                            aria-label={`${id} 权重`}
                          />
                          <select
                            value={config.normalize}
                            onChange={(event) => updateFactorConfig(id, { normalize: event.target.value as FactorNormalize })}
                            className="rounded-md border bg-background px-2 py-1 text-xs"
                          >
                            <option value="zscore">Z-score</option>
                            <option value="rank">截面排名</option>
                            <option value="percentile">百分位</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  还没有指定因子。可以手动输入因子 ID，或从因子库勾选后带入。
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold">4. 回测任务预览</h2>
            <button
              type="button"
              onClick={startBacktest}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Play className="h-4 w-4" />
              发起回测
            </button>
          </div>
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
            {prompt}
          </pre>
        </div>
      </section>

      <section className="rounded-xl border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
        <div className="font-medium text-foreground">因子库是做什么的？</div>
        <p className="mt-1">
          因子库不是直接下单或直接回测某一条规则，而是用来构造和筛选信号，例如动量、反转、波动率、成交量、估值、质量等。
          它更适合回答“哪些股票更值得进入候选池”“哪些信号在某个市场阶段有效”，然后再把有效因子组合成策略去回测。
        </p>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
      />
    </label>
  );
}
