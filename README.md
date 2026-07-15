# vibe-trading-A

面向中文用户和 A 股研究场景的开源智能投研工作台。公开版聚焦研究、回测、单票分析、因子评分、策略配置和本地对话式分析。

> 本项目仅用于投研辅助和学习研究，不构成投资建议、收益承诺、买卖推荐或代客理财服务。

## 公开版定位

这个仓库是安全开源版，默认只保留本地 Ollama 模型入口和免费公开数据源能力：

- 不内置云模型 API Key、商业数据源 Token、券商账户、OAuth 令牌或 Cookie。
- 不提供会消耗作者 API 额度的云模型 provider 配置。
- 不提交用户白名单数据库、会话数据库、上传文件、运行结果或本地缓存。
- 不提交个人账户截图、收益截图、聊天截图、微信临时文件、本地绝对路径或私有部署信息。

如果你需要接入 OpenAI、OpenRouter、DeepSeek、Tushare、券商接口或其他商业服务，请在自己的私有分支、私有 `.env`、数据库或部署平台 Secret Manager 中配置，不要把这些内容写进公开仓库。

## 功能范围

- 单票分析：K 线、均线、波动率、资金流线索、公告/新闻/财报证据链。
- 策略研究：策略先行，再做回测；支持股票池、因子权重、调仓频率等配置。
- 因子分析：组合因子评分、相关性观察、策略参数对比。
- 用户隔离：登录用户的工作区、会话和设置相互隔离。
- 本地优先：公开版默认使用本地 Ollama 和免费公开数据源，不依赖作者的付费 API。

## 技术架构

```text
vibe-trading-A/
├── agent/                 # FastAPI 后端、智能体、数据源、回测和会话服务
│   ├── api_server.py      # 后端入口
│   ├── src/               # 核心业务代码
│   └── .env.example       # 公开安全示例配置
├── frontend/              # React + Vite 前端
├── scripts/               # 工具脚本
└── wiki/                  # 文档站点内容
```

## 快速开始

```bash
git clone https://github.com/<your-github-user>/vibe-trading-A.git
cd vibe-trading-A
```

### 后端

```bash
cd agent
python -m pip install -r requirements.txt
copy .env.example .env
python -m uvicorn api_server:app --host 127.0.0.1 --port 8899
```

### 前端

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5899
```

浏览器打开：

```text
http://127.0.0.1:5899/
```

## 默认登录

公开版默认提供一个本地初始化管理员：

```text
Email: admin@example.com
Access Code: change-me-access-code
```

部署或公开使用前，必须在私有环境变量中修改默认管理员和访问码。

## 本地模型配置

公开版 `.env.example` 默认使用 Ollama：

```bash
LANGCHAIN_PROVIDER=ollama
LANGCHAIN_MODEL_NAME=qwen2.5:32b
OLLAMA_BASE_URL=http://localhost:11434
VIBE_TRADING_PUBLIC_LOCAL_ONLY=1
VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS=0
```

`VIBE_TRADING_PUBLIC_LOCAL_ONLY=1` 会让公开版默认拒绝云模型 provider；`VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS=0` 会在 Web API 启动时清理服务器进程中残留的模型和数据源共享凭证。这两个默认值用于防止公开部署误用作者或服务器上的付费额度。

## 开源前安全扫描

仓库内置 `gitleaks` 配置和本地扫描脚本：

```powershell
winget install gitleaks
powershell -ExecutionPolicy Bypass -File scripts/security-scan.ps1
```

只扫描当前工作区、不扫描 Git 历史：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/security-scan.ps1 -NoGitHistory
```

扫描通过不等于可以直接用于生产或实盘。部署前仍需要单独处理 HTTPS、数据库权限、用户隔离、访问控制、日志脱敏和合规要求。

## 开发检查

```bash
cd agent
python -m pytest tests/test_settings_api.py -q
```

```bash
cd frontend
npm run build
```

## 许可证

本项目采用 MIT License。二次开发和商业使用前，请同时检查上游项目许可证、依赖许可证，以及你所在地关于投资研究、投顾、数据源和交易系统的合规要求。
