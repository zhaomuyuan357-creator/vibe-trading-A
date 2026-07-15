# vibe-trading-A

面向中文用户和 A 股研究场景的开源智能投研工作台。公开版聚焦研究、回测、单票分析、因子评分、策略配置和本地对话式分析，不包含任何个人密钥、实盘账户、第三方商业服务凭证或私有部署信息。

> 本项目仅用于投研辅助和学习研究，不构成投资建议、收益承诺、买卖推荐或代客理财服务。

## 功能范围

- 单票分析：K 线、均线、波动率、资金流线索、公告/新闻/财报证据链。
- 策略研究：策略先行，再做回测；支持股票池、因子权重、调仓频率等配置。
- 因子分析：组合因子评分、相关性观察、策略参数对比。
- 用户隔离：登录用户的工作区、会话和设置相互隔离。
- 本地优先：公开版默认使用本地模型配置和免费公开数据源，不内置任何付费 API。

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

## 隐私与付费安全

公开仓库不包含，也不应该提交：

- 真实模型密钥、数据源凭证、券商账户、OAuth 令牌或 Cookie。
- 第三方商业服务凭证或其他私有配置。
- 用户白名单数据库、会话数据库、上传文件、运行结果或本地缓存。
- 个人账户截图、收益截图、聊天截图、微信临时文件或本地绝对路径。
- 私有仓库地址、内部部署地址、运维账号或云服务凭证。

如果你要接入云模型、商业数据源或券商接口，请只在自己的私有 `.env`、数据库或部署平台 Secret Manager 中配置，不要把这些内容写进公开仓库。

## 防止别人使用你的费用

公开版默认开启“用户自带凭证”模式：

```bash
VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS=0
```

在这个默认模式下，Web API 启动时会清理服务器进程里的模型和数据源共享凭证；登录用户必须在自己的设置里填写自己的模型密钥。这样即使你的服务器环境里原本存在私有凭证，普通用户会话也不会自动使用它们。

只有在你明确知道这是私有、可信、单租户部署时，才可以改成：

```bash
VIBE_TRADING_ALLOW_SERVER_SHARED_SECRETS=1
```

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
