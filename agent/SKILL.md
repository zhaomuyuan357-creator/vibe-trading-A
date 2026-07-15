---
name: vibe-trading
version: 0.1.10
description: Public-safe finance research toolkit for local/offline-first analysis, backtesting, factor research, and A-share oriented workflows. The open-source package intentionally ships without private credentials, commercial data-source tokens, broker secrets, or private financial configuration.
dependencies:
  python: ">=3.11"
  pip:
    - vibe-trading-ai
mcp:
  command: vibe-trading-mcp
  args: []
---

# Vibe-Trading Public Skill

This open-source skill describes the public-safe research surface only.

## Safety Boundary

- No real credentials are bundled.
- No commercial data-source token is required by the public template.
- No broker, account-funding, or private financial configuration is included.
- Research outputs are analytical references only, not investment advice or return guarantees.

## Setup

```bash
pip install vibe-trading-ai
```

For local development, copy `agent/.env.example` to `agent/.env` and keep any real secrets in that private file only.

## What You Can Do

- Run local research and backtests.
- Analyze market data from free/public sources where available.
- Configure strategies before backtesting.
- Review factor scores, correlations, and strategy diagnostics.
- Generate research reports for learning and internal analysis.

## Private Extensions

If you later connect cloud models, paid data vendors, broker systems, or production deployments, keep every credential outside the public repository and route it through private environment variables, a private database, or a deployment secret manager.
