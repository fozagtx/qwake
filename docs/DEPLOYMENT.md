# Qwake Deployment

Qwake uses two different deployment platforms:

- Streamlit Community Cloud for the dashboard.
- Render for the Spectrum messaging agent.

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

## Render Messaging Agent

Platform: Render.

Render service settings:

- Blueprint file: `render.yaml`
- Service type: background worker
- Runtime: Bun
- Root directory: `apps/agent`
- Build command: `bun install --frozen-lockfile`
- Start command: `bun start`

Required Render environment variables:

- `PROJECT_ID`
- `PROJECT_SECRET`
- `BTL_API_KEY`

Telegram Render environment variable:

- `TELEGRAM_BOT_TOKEN`

`TELEGRAM_BOT_TOKEN` is the Telegram BotFather token. The agent registers the Telegram provider only when this value is present. If it is missing, the service runs iMessage only.

Optional Render environment variables:

- `BTL_MODEL=deepseek-v4-flash`

The BTL Runtime base URL is not a secret and is hardcoded in `apps/agent/src/runtime.ts`:

```text
https://api.badtheorylabs.com/v1
```

Render local verification:

```sh
cd apps/agent
bun install
bun run typecheck
bun run check:btl
bun start
```

## Telegram Checklist

1. Create a Telegram bot with BotFather.
2. Add `TELEGRAM_BOT_TOKEN` to the Render agent service.
3. Deploy the Render Blueprint from `render.yaml`.
4. Confirm Render logs show the Spectrum agent started without missing-env errors.

## No-Fallback Data Rule

Deployment must not add mock, sample, fixture, generated, or fallback earthquake data. If USGS or geocoding is unavailable, Qwake should return an unavailable/error state.
