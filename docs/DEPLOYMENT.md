# Qwake Deployment

Qwake uses two different deployment platforms:

- Streamlit Community Cloud for the dashboard.
- Railway for the Spectrum messaging agent.

## Streamlit Dashboard

Platform: Streamlit Community Cloud.

Streamlit settings:

- Repository: `fozagtx/qwake`
- Branch: `main`
- Main file path: `earthquake-app.py`
- Python dependencies: `requirements.txt`

Required Streamlit secrets:

- None

Live external services used by the dashboard:

- USGS past-day earthquake feed
- Nominatim/OpenStreetMap geocoding

Local verification:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
streamlit run earthquake-app.py
```

## Railway Messaging Agent

Platform: Railway.

Railway service settings:

- Root directory: `apps/agent`
- Config file: `apps/agent/railway.toml`
- Dockerfile: `apps/agent/Dockerfile`
- Start command: `bun start`

Required Railway environment variables:

- `PROJECT_ID`
- `PROJECT_SECRET`
- `BTL_API_KEY`

Telegram Railway environment variable:

- `TELEGRAM_BOT_TOKEN`

`TELEGRAM_BOT_TOKEN` is the Telegram BotFather token. The agent registers the Telegram provider only when this value is present. If it is missing, the service runs iMessage only.

The BTL Runtime base URL is not a secret and is hardcoded in `apps/agent/src/runtime.ts`:

```text
https://api.badtheorylabs.com/v1
```

The BTL Runtime model is also hardcoded in `apps/agent/src/runtime.ts`:

```text
deepseek-v4-flash
```

Railway local verification:

```sh
cd apps/agent
bun install
bun run typecheck
bun run check:btl
bun start
```

## Telegram Checklist

1. Create a Telegram bot with BotFather.
2. Add `TELEGRAM_BOT_TOKEN` to the Railway agent service.
3. Deploy the Railway service from root directory `apps/agent`.
4. Confirm Railway logs show the Spectrum agent started without missing-env errors.

## No-Fallback Data Rule

Deployment must not add mock, sample, fixture, generated, or fallback earthquake data. If USGS or geocoding is unavailable, Qwake should return an unavailable/error state.
