# vibe-trading-A

面向中文用户和 A 股研究场景的开源智能投研工作台。项目基于 Vibe-Trading 二次开发，聚焦单票分析、K 线、资金流、龙虎榜、公告新闻、财报线索、组合因子评分、策略配置、回测入口和对话式研究。

> 重要说明：本项目默认是研究和学习工具，不构成投资建议、收益承诺、买卖推荐、自动交易指令或代客理财服务。市场有风险，所有交易决策都应由用户独立判断并自行承担结果。

## 核心能力

- **单票分析**：输入 A 股代码后生成结构化研究结果，展示 K 线、资金流、龙虎榜、公告、新闻、财报和组合因子评分。
- **证据链追踪**：分析结论尽量绑定可验证来源，帮助用户知道数据来自哪里、哪些信息支撑了判断。
- **策略先行再回测**：先配置策略类型、股票池、因子权重、调仓频率、Top N 等参数，再进入回测或智能体分析。
- **用户级配置隔离**：登录用户自行填写模型 API Key 和数据源 Token，不默认共用管理员密钥。
- **消息通道配置**：支持外部消息入口的可编辑配置，例如钉钉、飞书、Telegram、Email 等。
- **本地优先运行**：默认研究模式运行，实盘交易相关能力需要显式开启并自行承担风控责任。

## 技术架构

```text
vibe-trading-A/
├── agent/                 # FastAPI 后端、智能体、数据源、回测和会话服务
│   ├── api_server.py      # 后端入口
│   ├── src/               # 核心业务代码
│   └── .env.example       # 示例配置，不要提交真实密钥
├── frontend/              # React + Vite 前端
├── assets/                # 静态资源
├── scripts/               # 工具脚本
└── wiki/                  # 文档站点内容
```

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/zhaomuyuan357-creator/vibe-trading-A.git
cd vibe-trading-A
```

### 2. 配置后端环境

```bash
cd agent
cp .env.example .env
```

按需编辑 `agent/.env`：

- `LANGCHAIN_PROVIDER` / `LANGCHAIN_MODEL_NAME`：模型服务商和模型名。
- `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 等：由用户自行填写。
- `TUSHARE_TOKEN`：可选，用于部分 A 股数据源；未配置时会尽量回退到免费数据源。
- `VIBE_TRADING_PRODUCT_MODE=research`：默认研究模式。
- `VIBE_TRADING_ENABLE_LIVE_TRADING=0`：默认关闭实盘能力。

### 3. 启动后端

```bash
cd agent
python -m uvicorn api_server:app --host 127.0.0.1 --port 8899
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5899
```

浏览器打开：

```text
http://127.0.0.1:5899/
```

## 登录与默认账号

开源版默认提供一个本地初始化管理员：

```text
Email: admin@example.com
Access Code: change-me-access-code
```

部署或公开使用前，务必通过环境变量修改：

```bash
VIBE_TRADING_ADMIN_EMAIL=your-admin@example.com
VIBE_TRADING_AUTH_ACCESS_CODE=your-strong-access-code
```

## 配置原则

- 每个登录用户都应该在设置页填写自己的模型 API Key。
- 每个登录用户都应该在设置页填写自己的数据源 Token。
- 不要把真实 `.env`、数据库、会话、上传文件、运行缓存提交到仓库。
- 不要把收益截图、账户截图、用户数据放进公开仓库。
- 对外部署时必须设置强访问码，并为后端设置合适的网络边界。

## 开源安全边界

本仓库公开版以“源码 + 示例配置 + 本地运行文档”为主，不包含：

- 真实 API Key、Token 或数据源凭证。
- 用户白名单数据库。
- 真实用户会话、上传文件、运行结果。
- 个人账户截图或收益截图。
- 私有产品运营数据。

### 开源前安全扫描

仓库内置了 `gitleaks` 配置和本地扫描脚本，用于检查真实密钥、本地路径、数据库文件和个人信息残留：

```powershell
winget install gitleaks
powershell -ExecutionPolicy Bypass -File scripts/security-scan.ps1
```

如果只想扫描当前工作区文件、不扫描 Git 历史：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/security-scan.ps1 -NoGitHistory
```

扫描通过不等于代码可以直接用于实盘或生产环境。部署前仍需要重新配置管理员口令、用户密钥、数据源 Token、数据库权限和 HTTPS。

## 开发命令

后端基础检查：

```bash
cd agent
python -m pytest tests/test_settings_api.py -q
```

前端构建：

```bash
cd frontend
npm run build
```

## 许可证

本项目采用 MIT License。二次开发和商业使用前，请同时检查上游项目许可证、依赖许可证，以及你所在地区关于投资研究、投顾、数据源和交易系统的合规要求。

## 免责声明

vibe-trading-A 仅提供数据分析、策略研究、回测模拟和投研辅助功能。平台展示的行情、资金流、龙虎榜、公告、新闻、财报、因子评分、概率估算、策略回测等内容均不构成任何投资建议、收益承诺、买卖推荐或代客理财服务。用户应自行核验数据来源、评估风险并独立决策。
