"""
aura_meteo.py — Модуль получения метеоданных, расчёта вектора переноса примесей
и построения розы ветров для расчётного ядра AURA-RAD.

Координатная привязка по умолчанию: площадка АЭС в Джизакской области (оз. Тузкан)
40.7084° N, 67.1584° E.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Sequence

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
from matplotlib.figure import Figure
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger("aura_rad.meteo")

JIZZAKH_NPP_LAT: float = 40.7084
JIZZAKH_NPP_LON: float = 67.1584

COMPASS_SECTORS_16: tuple[str, ...] = (
    "С", "ССВ", "СВ", "ВСВ",
    "В", "ВЮВ", "ЮВ", "ЮЮВ",
    "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ",
    "З", "ЗСЗ", "СЗ", "ССЗ",
)
COMPASS_SECTORS_8: tuple[str, ...] = ("С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ")


class MeteoFetchError(RuntimeError):
    """Ошибка получения метеоданных из всех сконфигурированных источников."""


@dataclass(frozen=True, slots=True)
class MeteoObservation:
    """Нормализованный срез метеоусловий для моделирования атмосферного рассеяния."""

    timestamp: datetime
    latitude: float
    longitude: float
    wind_speed_ms: float
    wind_direction_deg: float
    temperature_c: float
    pressure_hpa: float
    humidity_pct: float
    precipitation_mmh: float = 0.0
    source: str = "unknown"
    station_name: str | None = None

    def to_aura_meteorology(self) -> dict[str, float]:
        """Преобразование в словарь параметров Meteorology ядра AURA-RAD."""
        return {
            "windSpeed": round(self.wind_speed_ms, 2),
            "windDirection": round(self.wind_direction_deg % 360.0, 1),
            "airTemperature": round(self.temperature_c, 1),
            "precipitationRate": round(self.precipitation_mmh, 2),
            "pressureHpa": round(self.pressure_hpa, 1),
            "humidityPct": round(self.humidity_pct, 1),
        }


@dataclass(frozen=True, slots=True)
class TransportVector:
    """Вектор переноса примеси по компасной сетке AURA-RAD (+X = В, +Y = С)."""

    wind_speed_ms: float
    meteo_azimuth_deg: float
    transport_azimuth_deg: float
    kx: float
    ky: float
    ux_ms: float
    uy_ms: float
    cx: float
    cy: float
    is_calm: bool


@dataclass(slots=True)
class _CacheEntry:
    value: MeteoObservation
    expires_at: float


@dataclass
class MeteoClient:
    """
    HTTP-клиент для получения метеоданных из API Узгидромета (data.meteo.uz)
    с автоматическим fallback на Open-Meteo, ретраями и TTL-кэшированием.
    """

    uzhydromet_url: str = "https://data.meteo.uz/api/v1/weather/current"
    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    cache_ttl_sec: int = 300
    connect_timeout_sec: float = 3.0
    read_timeout_sec: float = 7.0
    max_retries: int = 2
    api_token: str | None = None

    _session: requests.Session = field(init=False, repr=False)
    _cache: dict[tuple[float, float, str], _CacheEntry] = field(
        default_factory=dict, init=False, repr=False
    )
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def __post_init__(self) -> None:
        self._session = requests.Session()
        retry = Retry(
            total=self.max_retries,
            connect=self.max_retries,
            read=self.max_retries,
            backoff_factor=0.4,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
        )
        adapter = HTTPAdapter(max_retries=retry)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)
        headers: dict[str, str] = {
            "User-Agent": "AURA-RAD-MeteoClient/1.0",
            "Accept": "application/json",
        }
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        self._session.headers.update(headers)

    def get_current_weather(
        self,
        lat: float = JIZZAKH_NPP_LAT,
        lon: float = JIZZAKH_NPP_LON,
        station_code: str | None = None,
        prefer_uzhydromet: bool = True,
        force_refresh: bool = False,
    ) -> MeteoObservation:
        """Возвращает актуальные метеоданные с использованием потокобезопасного TTL-кэша."""
        cache_key = (round(lat, 3), round(lon, 3), station_code or "")
        now = time.monotonic()

        if not force_refresh:
            with self._lock:
                entry = self._cache.get(cache_key)
                if entry is not None and entry.expires_at > now:
                    return entry.value

        errors: list[str] = []

        if prefer_uzhydromet:
            try:
                obs = self._fetch_uzhydromet(lat=lat, lon=lon, station_code=station_code)
                self._store_cache(cache_key, obs)
                return obs
            except (requests.RequestException, ValueError, KeyError) as exc:
                errors.append(f"Uzhydromet: {exc}")
                logger.warning("Узгидромет недоступен (%s), переключение на Open-Meteo", exc)

        try:
            obs = self._fetch_open_meteo_current(lat=lat, lon=lon)
            self._store_cache(cache_key, obs)
            return obs
        except (requests.RequestException, ValueError, KeyError) as exc:
            errors.append(f"Open-Meteo: {exc}")

        with self._lock:
            stale = self._cache.get(cache_key)
            if stale is not None:
                logger.warning("Используется устаревший кэш метеоданных из-за сбоя сети")
                return stale.value

        raise MeteoFetchError("Не удалось получить метеоданные: " + " | ".join(errors))

    def get_historical_wind_series(
        self,
        lat: float = JIZZAKH_NPP_LAT,
        lon: float = JIZZAKH_NPP_LON,
        start_date: str = "2025-10-01",
        end_date: str = "2025-10-31",
    ) -> pd.DataFrame:
        """Загружает почасовой массив данных ветра за период (YYYY-MM-DD)."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "wind_speed_10m,wind_direction_10m,temperature_2m,surface_pressure,relative_humidity_2m",
            "wind_speed_unit": "ms",
            "timezone": "Asia/Tashkent",
        }
        resp = self._session.get(
            self.open_meteo_archive_url,
            params=params,
            timeout=(self.connect_timeout_sec, self.read_timeout_sec),
        )
        resp.raise_for_status()
        payload = resp.json()
        hourly = payload["hourly"]

        df = pd.DataFrame(
            {
                "timestamp": pd.to_datetime(hourly["time"]),
                "wind_speed_ms": pd.to_numeric(hourly["wind_speed_10m"], errors="coerce"),
                "wind_direction_deg": pd.to_numeric(hourly["wind_direction_10m"], errors="coerce"),
                "temperature_c": pd.to_numeric(hourly["temperature_2m"], errors="coerce"),
                "pressure_hpa": pd.to_numeric(hourly["surface_pressure"], errors="coerce"),
                "humidity_pct": pd.to_numeric(hourly["relative_humidity_2m"], errors="coerce"),
            }
        )
        return df.dropna(subset=["wind_speed_ms", "wind_direction_deg"]).reset_index(drop=True)

    def clear_cache(self) -> None:
        with self._lock:
            self._cache.clear()

    def _store_cache(self, key: tuple[float, float, str], obs: MeteoObservation) -> None:
        with self._lock:
            self._cache[key] = _CacheEntry(
                value=obs,
                expires_at=time.monotonic() + max(1, self.cache_ttl_sec),
            )

    def _fetch_uzhydromet(
        self, lat: float, lon: float, station_code: str | None
    ) -> MeteoObservation:
        params: dict[str, Any] = {"lat": lat, "lon": lon}
        if station_code:
            params["station"] = station_code

        resp = self._session.get(
            self.uzhydromet_url,
            params=params,
            timeout=(self.connect_timeout_sec, self.read_timeout_sec),
        )
        resp.raise_for_status()
        raw = resp.json()
        record = self._select_nearest_uzhydromet_record(raw, lat, lon, station_code)

        wind_speed = _extract_float(
            record, ("wind_speed", "wind_s", "windSpeed", "ws", "wind_speed_ms")
        )
        wind_dir = _extract_float(
            record, ("wind_dir", "wind_direction", "windDirection", "wd", "wind_d"), default=0.0
        )
        temp_c = _extract_float(record, ("air_t", "temperature", "temp", "t", "airTemperature"))
        pressure = _extract_float(
            record, ("pressure", "press", "surface_pressure", "p_hpa"), default=1013.25
        )
        if pressure < 850.0:
            pressure *= 1.33322

        humidity = _extract_float(
            record, ("humidity", "rh", "relative_humidity", "air_humidity"), default=50.0
        )
        precip = _extract_float(record, ("precipitation", "precip", "rain"), default=0.0)
        ts_raw = record.get("datetime") or record.get("updated_at") or record.get("time")
        ts = _parse_timestamp(ts_raw)
        station_name = record.get("station_name") or record.get("title") or record.get("city")

        return MeteoObservation(
            timestamp=ts,
            latitude=float(record.get("lat", lat)),
            longitude=float(record.get("lon", lon)),
            wind_speed_ms=max(0.0, wind_speed),
            wind_direction_deg=wind_dir % 360.0,
            temperature_c=temp_c,
            pressure_hpa=pressure,
            humidity_pct=min(100.0, max(0.0, humidity)),
            precipitation_mmh=max(0.0, precip),
            source="data.meteo.uz",
            station_name=str(station_name) if station_name else None,
        )

    def _select_nearest_uzhydromet_record(
        self, raw: Any, lat: float, lon: float, station_code: str | None
    ) -> dict[str, Any]:
        if isinstance(raw, dict) and isinstance(raw.get("data"), (list, dict)):
            raw = raw["data"]
        if isinstance(raw, dict):
            return raw
        if isinstance(raw, list) and raw:
            if station_code:
                for item in raw:
                    if isinstance(item, dict) and str(item.get("code", "")).lower() == station_code.lower():
                        return item
            dict_items = [item for item in raw if isinstance(item, dict)]
            if dict_items:
                return min(
                    dict_items,
                    key=lambda st: _haversine_km(
                        lat,
                        lon,
                        float(st.get("lat", st.get("latitude", lat))),
                        float(st.get("lon", st.get("longitude", lon))),
                    ),
                )
        raise ValueError("Пустой или некорректный формат ответа data.meteo.uz")

    def _fetch_open_meteo_current(self, lat: float, lon: float) -> MeteoObservation:
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": (
                "temperature_2m,relative_humidity_2m,precipitation,"
                "surface_pressure,wind_speed_10m,wind_direction_10m"
            ),
            "wind_speed_unit": "ms",
            "timezone": "UTC",
        }
        resp = self._session.get(
            self.open_meteo_url,
            params=params,
            timeout=(self.connect_timeout_sec, self.read_timeout_sec),
        )
        resp.raise_for_status()
        payload = resp.json()
        cur = payload["current"]

        return MeteoObservation(
            timestamp=_parse_timestamp(cur.get("time")),
            latitude=float(payload.get("latitude", lat)),
            longitude=float(payload.get("longitude", lon)),
            wind_speed_ms=max(0.0, float(cur["wind_speed_10m"])),
            wind_direction_deg=float(cur["wind_direction_10m"]) % 360.0,
            temperature_c=float(cur["temperature_2m"]),
            pressure_hpa=float(cur["surface_pressure"]),
            humidity_pct=float(cur["relative_humidity_2m"]),
            precipitation_mmh=max(0.0, float(cur.get("precipitation", 0.0))),
            source="open-meteo.com",
            station_name="Jizzakh / Tuzkan Grid",
        )


def calculate_transport_vector(
    wind_speed_ms: float,
    wind_direction_deg: float,
    direction_convention: Literal["from", "to"] = "from",
    calm_threshold_ms: float = 0.5,
) -> TransportVector:
    """Переводит азимут ветра в коэффициенты разложения (kx, ky) по осям X и Y."""
    meteo_az = float(wind_direction_deg) % 360.0
    transport_az = (meteo_az + 180.0) % 360.0 if direction_convention == "from" else meteo_az
    rad = math.radians(transport_az)

    kx = math.sin(rad)
    ky = math.cos(rad)
    cx = math.cos(rad)
    cy = -math.sin(rad)

    speed = max(0.0, float(wind_speed_ms))
    return TransportVector(
        wind_speed_ms=speed,
        meteo_azimuth_deg=meteo_az,
        transport_azimuth_deg=transport_az,
        kx=kx,
        ky=ky,
        ux_ms=speed * kx,
        uy_ms=speed * ky,
        cx=cx,
        cy=cy,
        is_calm=speed < calm_threshold_ms,
    )


def project_grid_to_plume_axes(
    grid_x_m: np.ndarray,
    grid_y_m: np.ndarray,
    vector: TransportVector,
    source_x_m: float = 0.0,
    source_y_m: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Проецирует узлы расчётной сетки (X, Y) в координаты шлейфа (x_downwind, y_crosswind)."""
    dx = grid_x_m - source_x_m
    dy = grid_y_m - source_y_m
    x_downwind = dx * vector.kx + dy * vector.ky
    y_crosswind = dx * vector.cx + dy * vector.cy
    return x_downwind, y_crosswind


@dataclass(frozen=True, slots=True)
class WindRoseStats:
    """Агрегированная статистика классической розы ветров."""

    sectors: tuple[str, ...]
    sector_centers_deg: np.ndarray
    frequency_table_pct: pd.DataFrame
    total_frequency_pct: pd.Series
    mean_speed_by_sector: pd.Series
    calm_pct: float
    dominant_meteo_sector: str
    dominant_transport_sector: str
    sample_count: int


def compute_wind_rose(
    df: pd.DataFrame,
    speed_col: str = "wind_speed_ms",
    dir_col: str = "wind_direction_deg",
    n_sectors: Literal[8, 16] = 16,
    speed_bins: Sequence[float] = (0.5, 2.0, 5.0, 8.0, 12.0, np.inf),
    calm_threshold_ms: float = 0.5,
) -> WindRoseStats:
    """Агрегирует метеоданные по 8 или 16 румбам и градациям скорости ветра."""
    if df.empty:
        raise ValueError("DataFrame с метеоданными пуст")

    clean = df[[speed_col, dir_col]].dropna().copy()
    n_total = len(clean)
    if n_total == 0:
        raise ValueError("Нет валидных наблюдений скорости и направления ветра")

    sectors = COMPASS_SECTORS_16 if n_sectors == 16 else COMPASS_SECTORS_8
    step_deg = 360.0 / n_sectors
    sector_centers = np.arange(n_sectors, dtype=float) * step_deg

    is_calm = clean[speed_col] < calm_threshold_ms
    calm_pct = float(is_calm.sum()) / n_total * 100.0
    active = clean.loc[~is_calm].copy()

    bin_labels = [
        f">= {lo:g} м/с" if math.isinf(hi) else f"{lo:g}–{hi:g} м/с"
        for lo, hi in zip(speed_bins[:-1], speed_bins[1:])
    ]

    if active.empty:
        empty_table = pd.DataFrame(0.0, index=list(sectors), columns=bin_labels)
        return WindRoseStats(
            sectors=sectors,
            sector_centers_deg=sector_centers,
            frequency_table_pct=empty_table,
            total_frequency_pct=pd.Series(0.0, index=list(sectors)),
            mean_speed_by_sector=pd.Series(0.0, index=list(sectors)),
            calm_pct=100.0,
            dominant_meteo_sector=sectors[0],
            dominant_transport_sector=sectors[n_sectors // 2],
            sample_count=n_total,
        )

    angles = active[dir_col].to_numpy(dtype=float) % 360.0
    sector_idx = (((angles + step_deg / 2.0) % 360.0) // step_deg).astype(int)
    active["sector"] = pd.Categorical(
        [sectors[i] for i in sector_idx], categories=list(sectors), ordered=True
    )
    active["speed_bin"] = pd.cut(
        active[speed_col],
        bins=list(speed_bins),
        labels=bin_labels,
        right=False,
        include_lowest=True,
    )

    counts = pd.crosstab(active["sector"], active["speed_bin"], dropna=False)
    counts = counts.reindex(index=list(sectors), columns=bin_labels, fill_value=0)
    freq_pct = (counts / n_total) * 100.0
    total_freq = freq_pct.sum(axis=1)
    mean_speed = (
        active.groupby("sector", observed=False)[speed_col]
        .mean()
        .reindex(list(sectors), fill_value=0.0)
        .fillna(0.0)
    )

    dom_idx = int(np.argmax(total_freq.to_numpy()))
    return WindRoseStats(
        sectors=sectors,
        sector_centers_deg=sector_centers,
        frequency_table_pct=freq_pct,
        total_frequency_pct=total_freq,
        mean_speed_by_sector=mean_speed,
        calm_pct=calm_pct,
        dominant_meteo_sector=sectors[dom_idx],
        dominant_transport_sector=sectors[(dom_idx + n_sectors // 2) % n_sectors],
        sample_count=n_total,
    )


def plot_wind_rose(
    stats: WindRoseStats,
    title: str = "Роза ветров — площадка АЭС Джизак",
    save_path: str | None = None,
) -> Figure:
    """Строит полярную розу ветров на matplotlib в палитре AURA-RAD."""
    fig, ax = plt.subplots(figsize=(8, 7), subplot_kw={"projection": "polar"}, dpi=130)
    fig.patch.set_facecolor("#0f172a")
    ax.set_facecolor("#1e293b")
    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)

    n_sectors = len(stats.sectors)
    theta = np.radians(stats.sector_centers_deg)
    width = (2.0 * np.pi / n_sectors) * 0.84
    palette = ["#06b6d4", "#10b981", "#eab308", "#f97316", "#ef4444"]
    bottom = np.zeros(n_sectors, dtype=float)

    for idx, col in enumerate(stats.frequency_table_pct.columns):
        vals = stats.frequency_table_pct[col].to_numpy(dtype=float)
        ax.bar(
            theta,
            vals,
            width=width,
            bottom=bottom,
            color=palette[min(idx, len(palette) - 1)],
            edgecolor="#0f172a",
            linewidth=0.8,
            label=str(col),
            alpha=0.92,
        )
        bottom += vals

    ax.set_xticks(theta)
    ax.set_xticklabels(stats.sectors, color="#e2e8f0", fontsize=10, fontweight="bold")
    ax.tick_params(axis="y", colors="#94a3b8", labelsize=8)
    ax.yaxis.set_major_formatter(lambda v, _: f"{v:.0f}%")
    ax.grid(color="#334155", linestyle="--", linewidth=0.7, alpha=0.8)
    ax.set_title(
        f"{title}\nНаблюдений: {stats.sample_count} · Штиль: {stats.calm_pct:.1f}% · "
        f"Преобладает: {stats.dominant_meteo_sector} (снос → {stats.dominant_transport_sector})",
        color="#f8fafc",
        fontsize=11,
        pad=18,
    )

    legend = ax.legend(
        title="Скорость ветра",
        loc="upper right",
        bbox_to_anchor=(1.28, 1.05),
        facecolor="#0f172a",
        edgecolor="#334155",
        labelcolor="#e2e8f0",
        fontsize=8,
    )
    legend.get_title().set_color("#94a3b8")
    plt.tight_layout()
    if save_path:
        fig.savefig(save_path, dpi=150, facecolor=fig.get_facecolor(), bbox_inches="tight")
    return fig


def _extract_float(
    data: dict[str, Any], keys: Sequence[str], default: float | None = None
) -> float:
    for key in keys:
        if key in data and data[key] is not None:
            return float(data[key])
    if default is not None:
        return default
    raise KeyError(f"Отсутствует ожидаемое поле среди {keys}")


def _parse_timestamp(raw: Any) -> datetime:
    if isinstance(raw, str) and raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2.0) ** 2
    )
    return 2.0 * r * math.asin(math.sqrt(a))
