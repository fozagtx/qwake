# Qwake messaging agent

A Spectrum TypeScript agent for Qwake. It connects the same live earthquake risk checks to iMessage and, when configured, Telegram.

## Environment

Before running, fill in `.env` values from `.env.example`.

Required:

- `PROJECT_ID`
- `PROJECT_SECRET`
- `BTL_API_KEY`

Optional:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `BTL_MODEL`

The BTL Runtime base URL is in code: `https://api.badtheorylabs.com/v1`.
The default model is `nemotron-3-nano-omni-30b-a3b-reasoning`, which is used unless `BTL_MODEL` is set.

## Run

```sh
bun install
bun run typecheck
bun run check:btl
bun start
```

## Data policy

The agent uses the live USGS past-day GeoJSON feed and live geocoding. It does not use sample, fixture, fallback, or generated earthquake data. If a live source fails, the agent returns an unavailable message.
