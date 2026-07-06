# Qwake

Map live USGS earthquakes from the past 24 hours and check whether a typed location is near recent reported activity.

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        WEB[Streamlit Dashboard]
        IM[iMessage]
        TG[Telegram]
    end

    subgraph Agent[Qwake Agent - Bun/TypeScript]
        PLAN[Plan turn\nLLM: deepseek-v4-flash]
        TOOLS[Live tools\nUSGS + Geocoding]
        REPLY[Compose reply\nLLM: deepseek-v4-flash]
    end

    USGS[(USGS Past Day Feed)]
    GEO[(Geocoding)]
    EXA[(Exa Search)]
    BTL[(BTL Gateway\ndeepseek-v4-flash)]

    WEB --> USGS
    WEB --> GEO
    IM --> PLAN
    TG --> PLAN
    PLAN --> BTL
    PLAN --> TOOLS
    TOOLS --> USGS
    TOOLS --> GEO
    TOOLS --> EXA
    TOOLS --> REPLY
    REPLY --> BTL
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

The agent uses Spectrum for iMessage and optional Telegram, plus response wording through an OpenAI-compatible gateway (BTL, `deepseek-v4-flash`).

Railway agent deployment uses `apps/agent/railway.toml`. Telegram uses `TELEGRAM_BOT_TOKEN`; if that variable is missing, the agent starts with iMessage only.
