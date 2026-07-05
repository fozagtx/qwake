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
- `BTL_MODEL`

Telegram is implemented through `@spectrum-ts/telegram`. Set `TELEGRAM_BOT_TOKEN` in Render to enable it; leave it unset for iMessage only.

The BTL Runtime base URL is in code: `https://api.badtheorylabs.com/v1`.
The default model is `deepseek-v4-flash`, which was verified successfully through BTL Runtime.

## Run

```sh
bun install
bun run typecheck
bun run check:btl
bun start
```

## Render

Deploy this service as a Render background worker from the root Blueprint file `render.yaml`.

## Data policy

The agent uses the live USGS past-day GeoJSON feed and live geocoding. It does not use sample, fixture, fallback, or generated earthquake data. If a live source fails, the agent returns an unavailable message.
