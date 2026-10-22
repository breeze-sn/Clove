# Clove

A responsive front-end prototype for Clove, an AI-powered personal finance companion. It uses synthetic INR financial data only. No bank connection, payment, or actual financial advice is provided.

## Run locally

Run `node server.mjs` and visit `http://localhost:8000`. Node.js 18 or newer is required. The server serves the app and provides the agent endpoints.

Without credentials, Clove runs a local demo agent that calls deterministic finance tools against synthetic data. To enable model-backed tool calling, set `OPENAI_API_KEY` in the server process environment before starting it. In PowerShell:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-5.6"
node server.mjs
```

The key remains server-side and is never sent to the browser. Do not put it in `app.js`, HTML, or a committed `.env` file. The model can call read-only tools for the demo snapshot, category budgets, and purchase calculations, plus a draft-only plan proposal tool. The server rejects a plan proposal unless a user explicitly approves it in the UI. Approval changes only in-memory browser demo state; there is no database or real financial account.

## Prototype interactions

- Navigate Overview, Transactions, Plan, Goals, and Clove AI.
- Search and filter the sample transaction list.
- Ask Clove about spending, category budgets, affordability, or payday.
- Review, approve, or reject a sample purchase proposal.
- Create a sample savings goal.

The prototype has no persistent backend or bank connection. Montserrat and Phosphor Icons are loaded from external CDNs.
