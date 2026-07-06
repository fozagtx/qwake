# Qwake

Map live USGS earthquakes from the past 24 hours and check whether a typed location is near recent reported activity.

<img width="540" height="1143" alt="PHOTO-2026-07-06-15-51-42" src="https://github.com/user-attachments/assets/8f0c49f6-bc6f-4156-8d14-465af9a9bf8a" />


## Architecture

```mermaid
flowchart LR
    subgraph Clients
        WEB[Streamlit Dashboard]
        IM[iMessage]
        TG[Telegram]
    end

    subgraph Agent[Qwake Agent - Bun/TypeScript]
        PLAN[Plan turn\nLLM: gpt-oss-120b]
        TOOLS[Live tools\nUSGS + Geocoding]
        REPLY[Compose reply\nLLM: gpt-oss-120b]
    end

    USGS[(USGS Past Day Feed)]
    GEO[(Geocoding)]
    EXA[(Exa Search)]
    OR[(OpenRouter\nopenai/gpt-oss-120b:free)]

    WEB --> USGS
    WEB --> GEO
    IM --> PLAN
    TG --> PLAN
    PLAN --> OR
    PLAN --> TOOLS
    TOOLS --> USGS
    TOOLS --> GEO
    TOOLS --> EXA
    TOOLS --> REPLY
    REPLY --> OR
    REPLY --> IM
    REPLY --> TG
```

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

The agent uses Spectrum for iMessage and optional Telegram, plus response wording through an OpenAI-compatible gateway (OpenRouter, `openai/gpt-oss-120b:free`).

Railway agent deployment uses `apps/agent/railway.toml`. Telegram uses `TELEGRAM_BOT_TOKEN`; if that variable is missing, the agent starts with iMessage only.

See `docs/DEPLOYMENT.md` for exact Streamlit Cloud and Railway setup.
