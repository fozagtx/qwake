# Qwake

Map live USGS earthquakes from the past 24 hours and check whether a typed location is near recent reported activity.

<img width="540" height="1143" alt="PHOTO-2026-07-06-15-51-42" src="https://github.com/user-attachments/assets/8f0c49f6-bc6f-4156-8d14-465af9a9bf8a" />


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

Railway agent deployment uses `apps/agent/railway.toml`. Telegram uses `TELEGRAM_BOT_TOKEN`; if that variable is missing, the agent starts with iMessage only.

See `docs/DEPLOYMENT.md` for exact Streamlit Cloud and Railway setup.

Video Tutorial: https://youtu.be/JL9xOs-G1hI
