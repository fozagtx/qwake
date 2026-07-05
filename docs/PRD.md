# Qwake PRD

## Purpose

Qwake helps users inspect earthquakes reported by USGS in the past 24 hours and check whether a typed location or coordinate is near recent reported activity. The product must be available through a Streamlit dashboard and messaging channels, starting with iMessage and Telegram.

Qwake does not predict earthquakes. It reports live source data, proximity, official feed fields, and practical safety guidance.

## Users And Roles

- Public dashboard user: views the live map and checks a location.
- Messaging user: asks for a location risk check through iMessage or Telegram.
- Operator: configures provider credentials and runtime secrets.

There is no authenticated end-user dashboard in this build.

## Route And Surface Map

| Surface | Purpose | Allowed users | Data shown | Actions | Failure behavior |
| --- | --- | --- | --- | --- | --- |
| Streamlit `/` | Live past-day earthquake dashboard | Public | USGS event map/table, source freshness, risk tier for entered location | Filter magnitude, enter coordinates/place | Hard error/unavailable state; no fallback data |
| iMessage | Text-based risk checks | Users who message the configured line | USGS event proximity summary and safety guidance | Send place/coordinates, ask help | Returns unavailable/error text; no fallback data |
| Telegram | Text-based risk checks when bot token is configured | Telegram bot users | Same as iMessage | Send place/coordinates, ask help | Returns unavailable/error text; no fallback data |

## Permissions

| Data/action | Public dashboard | Messaging user | Operator |
| --- | --- | --- | --- |
| View USGS past-day events | Yes | Yes, summarized | Yes |
| Enter a location | Yes | Yes | Yes |
| Save alert subscriptions | No | Not yet | No |
| Configure provider/runtime secrets | No | No | Yes |
| Send outbound alerts | No | Not yet | No |

## Data Sources

- Earthquake events: USGS past-day GeoJSON feed.
- Place geocoding: Nominatim/OpenStreetMap live search.
- Messaging response wording: BTL Runtime through the OpenAI-compatible SDK at `https://api.badtheorylabs.com/v1`, defaulting to `deepseek-v4-flash`.

No sample, fixture, demo, generated, or fallback earthquake data is allowed in product flows.

## Risk Tiers

- `clear`: no live USGS events within the selected radius.
- `watch`: nearby event magnitude 3.5 or greater.
- `caution`: nearby event magnitude 5.0 or greater, or USGS yellow alert.
- `danger`: tsunami flag, USGS orange/red alert, or magnitude 6.5 or greater.
- `unavailable`: live source data could not establish a status.

Risk tier text must include source freshness and avoid prediction language.

## UI Component System

The current dashboard is Streamlit with Plotly Mapbox using OpenStreetMap tiles. Keep the interface direct and operational: map, filters, location check, metrics, and event table.

## No-Fake-Demo Rules

- Do not show fake earthquakes.
- Do not use generated locations as if user-provided.
- Do not show fake alert subscriptions.
- Do not claim prediction.
- If USGS or geocoding fails, show unavailable/error state.
- If BTL Runtime fails, fall back only to deterministic text built from live tool output.

## Acceptance Criteria

- Streamlit loads live USGS past-day events.
- Streamlit shows feed freshness and source URL.
- Location checks use typed coordinates or live geocoding.
- Agent supports iMessage and optional Telegram provider configuration.
- Agent checks live USGS data before answering risk questions.
- Agent compiles with installed package versions.
- Python app syntax checks under the supported local Python.
- Secrets are read from environment variables and never hardcoded. The BTL Runtime base URL is not a secret and is kept in code.
