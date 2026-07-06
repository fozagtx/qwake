# Qwake messaging agent

A Spectrum TypeScript agent for Qwake. It connects the same live earthquake risk checks to iMessage and, when configured, Telegram.

## Environment

Before running, fill in `.env` values from `.env.example`.

Required:

- `PROJECT_ID`
- `PROJECT_SECRET`
- `BTL_API_KEY`
- `EXA_API_KEY`

Optional:

- `TELEGRAM_BOT_TOKEN`

Telegram is implemented through `@spectrum-ts/telegram`. Set `TELEGRAM_BOT_TOKEN` in Railway to enable it; leave it unset for iMessage only.

The runtime base URL is in code: `https://openrouter.ai/api/v1` (OpenAI-compatible gateway).
The default model is `openai/gpt-oss-120b:free`; override it with `BTL_MODEL` if you want a different OpenRouter model slug.
Exa Search is required for live web context around earthquake advisories and reports. USGS still remains the source of earthquake events and risk tiers.

## Run

```sh
bun install
bun run typecheck
bun run check:btl
bun start
```

## Railway

Deploy this service from Railway with root directory `apps/agent`. Railway uses `apps/agent/railway.toml` and builds `apps/agent/Dockerfile`, which runs Bun inside Docker.

## Data policy

Qwake does not predict earthquakes and does not use sample or fallback earthquake data. If a live source is unavailable, the app shows an unavailable/error state.

The agent uses the live USGS past-day GeoJSON feed, live geocoding, and Exa Search for current web context when available.
