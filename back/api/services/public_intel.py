from datetime import datetime
from threading import Lock
from time import time

import requests

from .data import ALMATY_MAP_CONFIG

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
CACHE_TTL_SECONDS = 10 * 60
PUBLIC_INTEL_CACHE = {}
PUBLIC_INTEL_LOCK = Lock()

WEATHER_CODE_LABELS = {
    0: "Ясно",
    1: "Преимущественно ясно",
    2: "Переменная облачность",
    3: "Пасмурно",
    45: "Туман",
    48: "Инейный туман",
    51: "Слабая морось",
    53: "Морось",
    55: "Сильная морось",
    56: "Ледяная морось",
    57: "Сильная ледяная морось",
    61: "Слабый дождь",
    63: "Дождь",
    65: "Сильный дождь",
    66: "Ледяной дождь",
    67: "Сильный ледяной дождь",
    71: "Слабый снег",
    73: "Снег",
    75: "Сильный снег",
    77: "Снежные зёрна",
    80: "Ливень",
    81: "Сильный ливень",
    82: "Очень сильный ливень",
    85: "Снежный заряд",
    86: "Сильный снежный заряд",
    95: "Гроза",
    96: "Гроза с градом",
    99: "Сильная гроза с градом",
}


def clamp(value, minimum, maximum):
    return min(max(value, minimum), maximum)


def get_district_coordinates(district):
    district_point = ALMATY_MAP_CONFIG["districts"].get(district, {}).get("position")
    latitude, longitude = district_point or ALMATY_MAP_CONFIG["center"]
    return {"latitude": latitude, "longitude": longitude}


def format_hour_label(iso_string):
    if not iso_string:
        return "--:--"
    try:
        parsed = datetime.fromisoformat(str(iso_string).replace("Z", "+00:00"))
        return parsed.strftime("%H:%M")
    except ValueError:
        return str(iso_string)[11:16]


def get_weather_label(code):
    return WEATHER_CODE_LABELS.get(code, "Смешанные погодные условия")


def build_external_stress(temperature, precipitation_probability, wind_speed, scenario):
    temperature_risk = (temperature - 27) * 4.5 if temperature >= 28 else (4 - temperature) * 4 if temperature <= 2 else 10
    precipitation_risk = precipitation_probability * 0.42
    wind_risk = max(0, wind_speed - 18) * 1.45
    scenario_boost = {"storm": 16, "quality": 10, "morning": 7, "repair": 5}.get(scenario, 0)
    return clamp(round(temperature_risk + precipitation_risk + wind_risk + scenario_boost), 8, 97)


def get_stress_tone(stress_index):
    if stress_index >= 72:
        return "critical"
    if stress_index >= 45:
        return "warning"
    return "normal"


def build_public_signals(current, peak_hour, scenario):
    signals = []
    if current["precipitationProbability"] >= 55 or peak_hour["precipitationProbability"] >= 60:
        signals.append(
            {
                "label": "Осадки и ливневой риск",
                "description": "Осадки повышают риск локальных загрязнений, обходов и жалоб на качество воды.",
            }
        )
    if current["temperature"] >= 27 or peak_hour["temperature"] >= 29:
        signals.append(
            {
                "label": "Температурный пик",
                "description": "Жара обычно повышает бытовое потребление и ускоряет выход района в пик нагрузки.",
            }
        )
    if current["windSpeed"] >= 28 or peak_hour["windSpeed"] >= 32:
        signals.append(
            {
                "label": "Сложность выезда",
                "description": "Сильный ветер повышает вероятность задержек выездных бригад и вторичных инцидентов.",
            }
        )
    if scenario == "quality":
        signals.append(
            {
                "label": "Санитарный режим",
                "description": "При санитарном сценарии внешние осадки и ветер требуют более частого отбора проб.",
            }
        )
    if not signals:
        signals.append(
            {
                "label": "Внешний фон ровный",
                "description": "Снаружи нет выраженного погодного триггера, основной фокус остаётся на локальной телеметрии.",
            }
        )
    return signals[:3]


def build_operations_advisories(current, peak_hour, scenario):
    advisories = []
    if current["precipitationProbability"] >= 45 or peak_hour["precipitationProbability"] >= 60:
        advisories.append("Подготовить бригады к работе на участках с риском подтоплений и промывов.")
    if current["temperature"] >= 27 or peak_hour["temperature"] >= 29:
        advisories.append("Заранее заложить резерв по давлению на фоне возможного роста бытового потребления.")
    if current["windSpeed"] >= 28 or peak_hour["windSpeed"] >= 32:
        advisories.append("Проверить доступность выездов, логистику аварийных экипажей и устойчивость временных схем.")
    if scenario == "repair":
        advisories.append("Согласовать плановые работы с погодным окном, чтобы не совмещать ремонт и внешний стресс.")
    if not advisories:
        advisories.append("Внешняя среда нейтральна, можно удерживать обычный операционный резерв.")
    return advisories[:4]


def normalize_public_intel(raw, district, scenario):
    current = raw.get("current", {})
    hourly = raw.get("hourly", {})
    hourly_times = hourly.get("time", [])
    current_time = current.get("time") or (hourly_times[0] if hourly_times else None)
    start_index = next((index for index, item in enumerate(hourly_times) if item >= current_time), 0)
    forecast = []

    for offset, time_value in enumerate(hourly_times[start_index : start_index + 10]):
        actual_index = start_index + offset
        temperature_source = hourly.get("temperature_2m") or []
        precipitation_source = hourly.get("precipitation_probability") or []
        wind_source = hourly.get("wind_speed_10m") or []
        weather_source = hourly.get("weather_code") or []
        temperature = round(temperature_source[actual_index] if actual_index < len(temperature_source) else current.get("temperature_2m", 0))
        precipitation_probability = round(precipitation_source[actual_index] if actual_index < len(precipitation_source) else 0)
        wind_speed = round(wind_source[actual_index] if actual_index < len(wind_source) else current.get("wind_speed_10m", 0))
        weather_code = weather_source[actual_index] if actual_index < len(weather_source) else current.get("weather_code", 0)
        stress_index = build_external_stress(temperature, precipitation_probability, wind_speed, scenario)
        forecast.append(
            {
                "time": time_value,
                "label": format_hour_label(time_value),
                "temperature": temperature,
                "precipitationProbability": precipitation_probability,
                "windSpeed": wind_speed,
                "weatherCode": weather_code,
                "weatherLabel": get_weather_label(weather_code),
                "stressIndex": stress_index,
            }
        )

    peak_hour = max(
        forecast,
        key=lambda item: item["stressIndex"],
        default={
            "label": "--:--",
            "temperature": round(current.get("temperature_2m", 0)),
            "precipitationProbability": round(current.get("precipitation", 0)),
            "windSpeed": round(current.get("wind_speed_10m", 0)),
            "stressIndex": 0,
        },
    )

    current_snapshot = {
        "temperature": round(current.get("temperature_2m", peak_hour["temperature"])),
        "apparentTemperature": round(current.get("apparent_temperature", current.get("temperature_2m", peak_hour["temperature"]))),
        "precipitation": float(current.get("precipitation", 0)),
        "precipitationProbability": forecast[0]["precipitationProbability"] if forecast else round(current.get("precipitation", 0)),
        "windSpeed": round(current.get("wind_speed_10m", peak_hour["windSpeed"])),
        "weatherCode": current.get("weather_code", forecast[0]["weatherCode"] if forecast else 0),
        "weatherLabel": get_weather_label(current.get("weather_code", forecast[0]["weatherCode"] if forecast else 0)),
        "stressIndex": forecast[0]["stressIndex"] if forecast else peak_hour["stressIndex"],
    }

    return {
        "district": district,
        "fetchedAt": current.get("time") or datetime.utcnow().isoformat(),
        "source": "Open-Meteo",
        "tone": get_stress_tone(peak_hour["stressIndex"]),
        "summary": (
            f"По открытому погодному фону в районе {district}: сейчас {current_snapshot['weatherLabel'].lower()}, "
            f"{current_snapshot['temperature']}°C, ветер {current_snapshot['windSpeed']} км/ч. "
            f"Самое напряжённое внешнее окно ожидается около {peak_hour['label']} "
            f"со стресс-индексом {peak_hour['stressIndex']}."
        ),
        "current": current_snapshot,
        "peakHour": peak_hour,
        "signals": build_public_signals(current_snapshot, peak_hour, scenario),
        "operations": build_operations_advisories(current_snapshot, peak_hour, scenario),
        "hourly": forecast,
        "metrics": {
            "peakStress": peak_hour["stressIndex"],
            "peakStressTime": peak_hour["label"],
            "peakWind": peak_hour["windSpeed"],
            "peakPrecipitationProbability": peak_hour["precipitationProbability"],
            "temperatureSwing": (
                max(item["temperature"] for item in forecast) - min(item["temperature"] for item in forecast)
                if len(forecast) > 1
                else 0
            ),
        },
    }


def get_public_intel(district="Алматы", scenario="baseline"):
    cache_key = f"{district}::{scenario}"
    now = time()
    with PUBLIC_INTEL_LOCK:
        cached = PUBLIC_INTEL_CACHE.get(cache_key)
        if cached and cached["expiresAt"] > now:
            return cached["data"]

    coordinates = get_district_coordinates(district)
    response = requests.get(
        OPEN_METEO_URL,
        params={
            "latitude": str(coordinates["latitude"]),
            "longitude": str(coordinates["longitude"]),
            "current": "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
            "hourly": "temperature_2m,precipitation_probability,wind_speed_10m,weather_code",
            "forecast_days": "2",
            "timezone": "auto",
            "wind_speed_unit": "kmh",
        },
        timeout=12,
    )
    if not response.ok:
        raise RuntimeError(f"Public weather API error {response.status_code}")

    data = normalize_public_intel(response.json(), district, scenario)
    with PUBLIC_INTEL_LOCK:
        PUBLIC_INTEL_CACHE[cache_key] = {"data": data, "expiresAt": now + CACHE_TTL_SECONDS}
    return data
