# Open Source Release Checklist

Before publishing a release, verify:

- [ ] The source repository used for private development is private.
- [ ] The public repository is created from a clean tree without private Git history.
- [ ] `.env`, auth databases, sessions, runs, uploads, caches, and screenshots are not committed.
- [ ] Default admin email and access code are examples only.
- [ ] `agent/.env.example` contains placeholders only.
- [ ] README clearly states research-only usage and risk disclaimer.
- [ ] Run `powershell -ExecutionPolicy Bypass -File scripts/security-scan.ps1` and confirm no real API keys, local paths, database files, or personal credentials are detected.
- [ ] Frontend builds successfully.
- [ ] Backend settings tests pass.
