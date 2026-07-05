# Qwake

Map live USGS earthquakes from the past 24 hours and check whether a typed location is near recent reported activity.

Qwake does not predict earthquakes and does not use sample or fallback earthquake data. If a live source is unavailable, the app shows an unavailable/error state.

## Streamlit dashboard

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
streamlit run earthquake-app.py
```

Deploy the dashboard on Streamlit Community Cloud with main file `earthquake-app.py`.

## Messaging agent

```sh
cd apps/agent
bun install
bun run typecheck
bun start
```

The agent uses Spectrum for iMessage and optional Telegram, plus BTL Runtime response wording through an OpenAI-compatible gateway.

Render agent deployment uses the root `render.yaml`. Telegram uses `TELEGRAM_BOT_TOKEN`; if that variable is missing, the agent starts with iMessage only.

See `docs/DEPLOYMENT.md` for exact Streamlit Cloud and Render setup.

Video Tutorial: https://youtu.be/JL9xOs-G1hI
