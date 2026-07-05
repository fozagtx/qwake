from math import asin, cos, radians, sin, sqrt
from typing import Dict, List, Optional, Tuple

import pandas as pd
import plotly.express as px
import requests
import streamlit as st


USGS_PAST_DAY_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
USER_AGENT = "deepcharts-earthquake-app/1.0"
DEFAULT_RADIUS_KM = 300


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    a = (
        sin(delta_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(delta_lon / 2) ** 2
    )
    return 2 * earth_radius_km * asin(sqrt(a))


@st.cache_data(ttl=60, show_spinner=False)
def fetch_earthquake_data(url: str = USGS_PAST_DAY_URL) -> Tuple[pd.DataFrame, Dict[str, str]]:
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    rows: List[Dict[str, object]] = []
    for feature in data.get("features", []):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 3:
            continue

        magnitude = properties.get("mag")
        event_time = pd.to_datetime(properties.get("time"), unit="ms", utc=True)
        updated_time = pd.to_datetime(properties.get("updated"), unit="ms", utc=True)
        rows.append(
            {
                "id": feature.get("id"),
                "place": properties.get("place") or "Unknown location",
                "magnitude": float(magnitude) if magnitude is not None else None,
                "time_utc": event_time,
                "updated_utc": updated_time,
                "longitude": float(coordinates[0]),
                "latitude": float(coordinates[1]),
                "depth_km": float(coordinates[2]),
                "alert": properties.get("alert") or "none",
                "mmi": properties.get("mmi"),
                "tsunami": int(properties.get("tsunami") or 0),
                "significance": int(properties.get("sig") or 0),
                "url": properties.get("url"),
            }
        )

    frame = pd.DataFrame(rows)
    if not frame.empty:
        frame = frame.sort_values("time_utc", ascending=False).reset_index(drop=True)

    metadata = {
        "title": data.get("metadata", {}).get("title", "USGS past-day earthquake feed"),
        "generated_utc": str(
            pd.to_datetime(data.get("metadata", {}).get("generated"), unit="ms", utc=True)
        ),
        "source": url,
    }
    return frame, metadata


def geocode_location(query: str) -> Optional[Tuple[float, float, str]]:
    if not query.strip():
        return None

    response = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": query, "format": "json", "limit": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=12,
    )
    response.raise_for_status()
    results = response.json()
    if not results:
        return None

    result = results[0]
    return float(result["lat"]), float(result["lon"]), result.get("display_name", query)


def classify_event(row: pd.Series) -> str:
    magnitude = row.get("magnitude")
    alert = str(row.get("alert") or "none").lower()
    tsunami = int(row.get("tsunami") or 0)

    if tsunami or alert in {"red", "orange"} or (magnitude is not None and magnitude >= 6.5):
        return "danger"
    if alert == "yellow" or (magnitude is not None and magnitude >= 5.0):
        return "caution"
    if magnitude is not None and magnitude >= 3.5:
        return "watch"
    return "clear"


def assess_location_risk(
    earthquakes: pd.DataFrame,
    latitude: float,
    longitude: float,
    radius_km: int,
) -> Tuple[str, pd.DataFrame, str]:
    if earthquakes.empty:
        return (
            "unavailable",
            earthquakes,
            "USGS returned no live events in the past-day feed. No fallback data is shown.",
        )

    nearby = earthquakes.copy()
    nearby["distance_km"] = nearby.apply(
        lambda row: haversine_km(latitude, longitude, row["latitude"], row["longitude"]),
        axis=1,
    )
    nearby = nearby[nearby["distance_km"] <= radius_km].sort_values(
        ["distance_km", "magnitude"],
        ascending=[True, False],
    )

    if nearby.empty:
        return (
            "clear",
            nearby,
            f"No live USGS earthquakes are within {radius_km} km of this location in the past 24 hours.",
        )

    nearby["risk_tier"] = nearby.apply(classify_event, axis=1)
    tier_order = {"danger": 4, "caution": 3, "watch": 2, "clear": 1}
    highest_tier = max(nearby["risk_tier"], key=lambda tier: tier_order[tier])
    closest = nearby.iloc[0]
    summary = (
        f"Closest live USGS event is M{closest['magnitude']:.1f}, "
        f"{closest['distance_km']:.0f} km away near {closest['place']}."
    )
    return highest_tier, nearby, summary


def guidance_for_tier(tier: str) -> str:
    if tier == "danger":
        return (
            "Follow official emergency instructions now. Stay away from damaged buildings, "
            "unstable slopes, bridges, and coastlines when tsunami guidance applies."
        )
    if tier == "caution":
        return (
            "Be ready for aftershocks, avoid visibly damaged structures, and check local "
            "emergency channels before traveling toward the affected area."
        )
    if tier == "watch":
        return (
            "Monitor official updates and keep a basic safety plan ready, especially if you "
            "are close to older buildings or steep terrain."
        )
    if tier == "unavailable":
        return "Live hazard status could not be established from the current feed."
    return "No nearby live USGS activity crossed the selected radius threshold."


def render_map(earthquakes: pd.DataFrame) -> None:
    if earthquakes.empty:
        st.warning("The live USGS past-day feed returned no earthquake events.")
        return

    map_data = earthquakes.dropna(subset=["latitude", "longitude", "magnitude"]).copy()
    map_data["risk_tier"] = map_data.apply(classify_event, axis=1)
    map_data["magnitude_size"] = map_data["magnitude"].clip(lower=0.5)

    figure = px.scatter_mapbox(
        map_data,
        lat="latitude",
        lon="longitude",
        size="magnitude_size",
        color="risk_tier",
        hover_name="place",
        hover_data={
            "magnitude": ":.1f",
            "depth_km": ":.1f",
            "time_utc": True,
            "alert": True,
            "tsunami": True,
            "risk_tier": True,
            "magnitude_size": False,
            "latitude": ":.3f",
            "longitude": ":.3f",
        },
        category_orders={"risk_tier": ["danger", "caution", "watch", "clear"]},
        color_discrete_map={
            "danger": "#b91c1c",
            "caution": "#d97706",
            "watch": "#2563eb",
            "clear": "#047857",
        },
        zoom=1,
        height=620,
    )
    figure.update_layout(
        mapbox_style="open-street-map",
        margin={"r": 0, "t": 0, "l": 0, "b": 0},
        legend_title_text="Risk tier",
    )
    st.plotly_chart(figure, use_container_width=True)


def main() -> None:
    st.set_page_config(page_title="Earthquake Watch", layout="wide")
    st.title("Earthquake Watch")
    st.caption("Live USGS earthquakes from the past 24 hours. No prediction and no fallback data.")

    with st.spinner("Loading live USGS earthquake feed..."):
        try:
            earthquakes, metadata = fetch_earthquake_data()
        except requests.RequestException as exc:
            st.error(f"Live USGS feed unavailable: {exc}")
            st.stop()
        except ValueError as exc:
            st.error(f"Live USGS feed returned invalid JSON: {exc}")
            st.stop()

    st.sidebar.header("Filters")
    min_magnitude = st.sidebar.slider(
        "Minimum magnitude",
        min_value=0.0,
        max_value=9.5,
        value=1.0,
        step=0.1,
    )
    radius_km = st.sidebar.slider(
        "Location risk radius",
        min_value=25,
        max_value=1000,
        value=DEFAULT_RADIUS_KM,
        step=25,
    )

    filtered = earthquakes[earthquakes["magnitude"].fillna(-1) >= min_magnitude]

    stat_cols = st.columns(4)
    stat_cols[0].metric("Live events", len(filtered))
    stat_cols[1].metric("Max magnitude", f"{filtered['magnitude'].max():.1f}" if not filtered.empty else "n/a")
    stat_cols[2].metric("Tsunami flags", int(filtered["tsunami"].sum()) if not filtered.empty else 0)
    stat_cols[3].metric("Feed generated", metadata["generated_utc"])

    st.subheader("Past 24 Hours Map")
    render_map(filtered)

    st.subheader("Check A Location")
    location_mode = st.radio(
        "Location input",
        ["Coordinates", "Place name"],
        horizontal=True,
    )

    location: Optional[Tuple[float, float, str]] = None
    if location_mode == "Coordinates":
        coord_cols = st.columns(2)
        latitude = coord_cols[0].number_input("Latitude", min_value=-90.0, max_value=90.0, value=0.0)
        longitude = coord_cols[1].number_input("Longitude", min_value=-180.0, max_value=180.0, value=0.0)
        location = (latitude, longitude, f"{latitude:.4f}, {longitude:.4f}")
    else:
        query = st.text_input("Place name or address")
        if st.button("Find live risk for place", type="primary"):
            try:
                location = geocode_location(query)
            except requests.RequestException as exc:
                st.error(f"Live geocoding unavailable: {exc}")
                location = None
            if location is None:
                st.warning("No live geocoding result was returned for that place.")

    if location is not None:
        lat, lon, label = location
        tier, nearby, summary = assess_location_risk(filtered, lat, lon, radius_km)
        st.info(f"{label}: {tier.upper()} - {summary}")
        st.write(guidance_for_tier(tier))
        if not nearby.empty:
            st.dataframe(
                nearby[
                    [
                        "place",
                        "magnitude",
                        "distance_km",
                        "depth_km",
                        "time_utc",
                        "alert",
                        "tsunami",
                        "url",
                    ]
                ].head(20),
                use_container_width=True,
            )

    st.subheader("Live Event Table")
    st.dataframe(
        filtered[
            [
                "place",
                "magnitude",
                "depth_km",
                "time_utc",
                "alert",
                "mmi",
                "tsunami",
                "significance",
                "url",
            ]
        ],
        use_container_width=True,
    )

    st.caption(f"Source: {metadata['source']}")


if __name__ == "__main__":
    main()
