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

## Messaging agent

```sh
cd apps/agent
bun install
bun run typecheck
bun start
```

The agent uses Spectrum for iMessage and optional Telegram, plus optional BTL Runtime response wording through an OpenAI-compatible gateway.

Video Tutorial: https://youtu.be/JL9xOs-G1hI
