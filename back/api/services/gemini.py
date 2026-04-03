import json
from urllib.parse import urlencode

import requests

from .public_intel import get_public_intel

DEFAULT_GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


def trim_text(value):
    return value.strip() if isinstance(value, str) else ""


def normalize_model_name(model=DEFAULT_GEMINI_MODEL):
    normalized = str(model or DEFAULT_GEMINI_MODEL).replace("models/", "").strip()
    return normalized or DEFAULT_GEMINI_MODEL


def build_gemini_url(model, api_key):
    return f"{DEFAULT_GEMINI_ENDPOINT}/models/{normalize_model_name(model)}:generateContent?{urlencode({'key': api_key})}"


def extract_gemini_text(data):
    parts = (((data or {}).get("candidates") or [{}])[0].get("content") or {}).get("parts")
    if not isinstance(parts, list):
        return ""
    return "\n".join(trim_text(part.get("text")) for part in parts if trim_text(part.get("text"))).strip()


def get_gemini_error_message(data, fallback=""):
    api_message = trim_text(((data or {}).get("error") or {}).get("message"))
    if api_message:
        return api_message
    block_reason = trim_text(((data or {}).get("promptFeedback") or {}).get("blockReason"))
    if block_reason:
        return f"Запрос заблокирован: {block_reason}."
    return trim_text(fallback) or "unknown error"


def normalize_history(history=None):
    normalized = []
    for item in (history or [])[-6:]:
        content = trim_text(item.get("content"))
        if not content:
            continue
        normalized.append(
            {
                "role": "model" if item.get("role") == "assistant" else "user",
                "parts": [{"text": content}],
            }
        )
    return normalized


def dedupe_strings(values):
    unique = []
    for value in values:
        if value and value not in unique:
            unique.append(value)
    return unique


def build_chat_system_instruction():
    return " ".join(
        [
            "You are AquaMind AI Center for an Almaty smart water operations dashboard.",
            "Answer in Russian.",
            "Blend three sources of truth when relevant: local dashboard telemetry, public weather context, and public web data from Google Search grounding.",
            "Prioritize operationally relevant public factors only: weather, public works, outages, safety alerts, and major events that can affect water operations.",
            "Clearly distinguish between local dashboard data and public external context when that distinction matters.",
            "Do not invent incidents, regulations, outages, or sensor values.",
            "Keep the answer concise, product-grade, and operational.",
            "Use at most one short paragraph and at most three bullet points.",
        ]
    )


def build_chat_context_prompt(context, alerts, knowledge_base, public_intel):
    alerts = alerts or []
    knowledge_base = knowledge_base or []
    alert_text = (
        "\n".join(
            f"- [{alert.get('severity')}] {alert.get('title')}: {alert.get('description')} Действие: {alert.get('action')}"
            for alert in alerts[:5]
        )
        if alerts
        else "- Активных нарушений по локальной телеметрии не обнаружено."
    )
    knowledge_text = (
        "\n".join(f"- {item.get('title')}: {item.get('content')}" for item in knowledge_base[:10])
        if knowledge_base
        else "- Локальный индекс пуст."
    )
    public_signals = (
        "\n".join(f"- {item.get('label')}: {item.get('description')}" for item in public_intel.get("signals", []))
        if public_intel and public_intel.get("signals")
        else "- Публичные сигналы недоступны."
    )
    snapshot = context.get("snapshot") or {}
    overview = snapshot.get("overview") or {}
    analysis = context.get("analysis") or {}

    return "\n".join(
        [
            "Локальный контекст дашборда:",
            f"- Район: {context.get('district')}",
            f"- Сценарий: {snapshot.get('scenarioLabel')}",
            f"- Статус района: {analysis.get('tone')}",
            f"- Давление: {overview.get('pressure')} bar",
            f"- Качество: {overview.get('quality')}",
            f"- Покрытие: {overview.get('coverage')}%",
            f"- Жалобы: {overview.get('complaints')}",
            f"- ETA реакции: {overview.get('responseEta')} мин",
            "",
            "Активные локальные алерты:",
            alert_text,
            "",
            "Локальный индекс и briefing:",
            knowledge_text,
            "",
            "Публичный внешний контекст:",
            f"- {public_intel.get('summary')}" if public_intel else "- Публичный внешний контекст временно недоступен.",
            (
                f"- Пиковое внешнее окно: {public_intel['peakHour']['label']}, стресс {public_intel['peakHour']['stressIndex']}, "
                f"ветер {public_intel['peakHour']['windSpeed']} км/ч, вероятность осадков {public_intel['peakHour']['precipitationProbability']}%."
            )
            if public_intel
            else "",
            "Публичные сигналы:",
            public_signals,
        ]
    )


def extract_grounding_metadata(data):
    metadata = (((data or {}).get("candidates") or [{}])[0].get("groundingMetadata") or {})
    chunks = metadata.get("groundingChunks") or []
    supports = metadata.get("groundingSupports") or []
    queries = metadata.get("webSearchQueries") or []
    web_sources = []
    for index, chunk in enumerate(chunks):
        web = chunk.get("web") or {}
        if not web.get("uri"):
            continue
        snippet = ""
        for support in supports:
            if index in (support.get("groundingChunkIndices") or []):
                snippet = trim_text(((support.get("segment") or {}).get("text")))
                break
        item = {
            "title": web.get("title") or web.get("uri"),
            "url": web.get("uri"),
            "snippet": snippet,
            "source": "Google Search",
        }
        if not any(existing["url"] == item["url"] for existing in web_sources):
            web_sources.append(item)
    return {"queries": queries, "webSources": web_sources}


def fetch_gemini(api_key, model, body):
    response = requests.post(
        build_gemini_url(model, api_key),
        headers={"content-type": "application/json"},
        json=body,
        timeout=25,
    )
    raw_text = response.text
    try:
        data = response.json() if raw_text else None
    except ValueError:
        data = None
    if not response.ok:
        raise RuntimeError(f"Google AI Studio API error {response.status_code}: {get_gemini_error_message(data, raw_text)}")
    return data


def fetch_fallback_chat_text(api_key, model, prompt):
    data = fetch_gemini(
        api_key,
        model,
        {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.25,
                "maxOutputTokens": 320,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        },
    )
    return extract_gemini_text(data)


def create_grounded_chat_reply(api_key, context, message, alerts=None, knowledge_base=None, history=None, model=DEFAULT_GEMINI_MODEL):
    public_intel = get_public_intel(context.get("district"), context.get("activeScenario"))
    data = fetch_gemini(
        api_key,
        model,
        {
            "systemInstruction": {"parts": [{"text": build_chat_system_instruction()}]},
            "contents": [
                {"role": "user", "parts": [{"text": build_chat_context_prompt(context, alerts, knowledge_base, public_intel)}]},
                *normalize_history(history),
                {"role": "user", "parts": [{"text": trim_text(message)}]},
            ],
            "tools": [{"googleSearch": {}}],
            "generationConfig": {
                "temperature": 0.35,
                "maxOutputTokens": 420,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        },
    )
    text = extract_gemini_text(data)
    if not text:
        text = fetch_fallback_chat_text(
            api_key,
            model,
            "\n".join(
                [
                    "Ответь кратко и по делу на русском языке.",
                    "Используй локальный контекст дашборда и публичный погодный фон ниже.",
                    build_chat_context_prompt(context, alerts, knowledge_base, public_intel),
                    "",
                    f"Вопрос пользователя: {trim_text(message)}",
                ]
            ),
        )
    if not text:
        raise RuntimeError(get_gemini_error_message(data, "Google AI Studio вернул пустой ответ."))

    finish_reason = (((data or {}).get("candidates") or [{}])[0].get("finishReason"))
    if finish_reason == "MAX_TOKENS" or len(text) > 900:
        compressed = fetch_fallback_chat_text(
            api_key,
            model,
            "\n".join(
                [
                    "Сожми ответ до одного короткого абзаца и трёх коротких пунктов максимум.",
                    "Сохрани только то, что реально важно для оперативного решения по водоснабжению.",
                    "",
                    text,
                ]
            ),
        )
        if compressed:
            text = compressed

    grounding = extract_grounding_metadata(data)
    web_cards = [
        {
            "title": item["title"],
            "snippet": item["snippet"] or item["url"],
            "source": item["source"],
            "url": item["url"],
        }
        for item in grounding["webSources"][:4]
    ]
    return {
        "tone": (alerts or [{}])[0].get("severity") or (context.get("analysis") or {}).get("tone") or public_intel.get("tone") or "normal",
        "headline": "Google AI Studio + общедоступные данные" if grounding["webSources"] else "Google AI Studio ответ",
        "content": text,
        "highlights": dedupe_strings(
            [
                f"Локальный район: {context.get('district')}.",
                f"Публичный фон: {public_intel['current']['weatherLabel']}, {public_intel['current']['temperature']}°C, ветер {public_intel['current']['windSpeed']} км/ч.",
                f"Веб-поиск: {grounding['queries'][0]}." if grounding["queries"] else "Google Search подключается по мере необходимости.",
            ]
        ),
        "sources": dedupe_strings(["Google AI Studio", "Google Search", public_intel["source"], "Локальный контекст AI-центра"]),
        "searchResults": web_cards,
        "webSources": grounding["webSources"][:6],
        "publicIntel": public_intel,
    }


def build_report_system_instruction():
    return " ".join(
        [
            "You are AquaMind, an AI command analyst for an urban water supply dashboard.",
            "Return only valid JSON in Russian.",
            "The JSON keys must be: headline, summary, diagnosis, executive, engineering, citizen, recommendations, tone, confidence.",
            "recommendations must be an array of short strings.",
            "tone must be one of: normal, warning, critical.",
            "confidence must be an integer from 0 to 100.",
            "Use local dashboard context and public weather context when relevant.",
        ]
    )


def build_report_prompt(context, mission, public_intel):
    snapshot = context.get("snapshot") or {}
    overview = snapshot.get("overview") or {}
    city = context.get("city") or {}
    analysis = context.get("analysis") or {}
    return (
        f"Контекст smart city dashboard:\n"
        f"- Район: {context.get('district')}\n"
        f"- Сценарий: {context.get('activeScenario')}\n"
        f"- Режим обзора: {context.get('viewMode')}\n"
        f"- Статус: {analysis.get('tone')}\n"
        f"- Уровень воды: {overview.get('waterLevel')}%\n"
        f"- Давление: {overview.get('pressure')} bar\n"
        f"- Инциденты: {overview.get('incidents')}\n"
        f"- Качество воды: {overview.get('quality')}\n"
        f"- Покрытие сервиса: {overview.get('coverage')}%\n"
        f"- Среднее покрытие по городу: {city.get('averageCoverage')}%\n"
        f"- Среднее давление по городу: {city.get('averagePressure')} bar\n"
        f"- Всего инцидентов по городу: {city.get('totalIncidents')}\n\n"
        f"Публичный внешний контекст:\n"
        f"- {public_intel['summary']}\n"
        f"- Пиковое внешнее окно: {public_intel['peakHour']['label']}\n"
        f"- Пиковый внешний стресс: {public_intel['peakHour']['stressIndex']}\n"
        f"- Вероятность осадков в пик: {public_intel['peakHour']['precipitationProbability']}%\n"
        f"- Ветер в пик: {public_intel['peakHour']['windSpeed']} км/ч\n\n"
        f"Задача:\n{mission}\n\n"
        f"Сформируй:\n1. diagnosis\n2. executive\n3. engineering\n4. citizen\n5. recommendations\n\n"
        f"Тон должен быть кратким, продуктовым и пригодным для реального городского штаба."
    )


REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "diagnosis": {"type": "string"},
        "executive": {"type": "string"},
        "engineering": {"type": "string"},
        "citizen": {"type": "string"},
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "tone": {"type": "string", "enum": ["normal", "warning", "critical"]},
        "confidence": {"type": "integer"},
    },
    "required": ["headline", "summary", "diagnosis", "executive", "engineering", "citizen", "recommendations", "tone", "confidence"],
}


def parse_json_candidate(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None


def create_structured_report(api_key, context, mission, model=DEFAULT_GEMINI_MODEL):
    public_intel = get_public_intel(context.get("district"), context.get("activeScenario"))
    data = fetch_gemini(
        api_key,
        model,
        {
            "systemInstruction": {"parts": [{"text": build_report_system_instruction()}]},
            "contents": [{"role": "user", "parts": [{"text": build_report_prompt(context, mission, public_intel)}]}],
            "generationConfig": {
                "temperature": 0.25,
                "maxOutputTokens": 900,
                "thinkingConfig": {"thinkingBudget": 0},
                "responseMimeType": "application/json",
                "responseJsonSchema": REPORT_SCHEMA,
            },
        },
    )
    text = extract_gemini_text(data)
    parsed = parse_json_candidate(text)
    if not isinstance(parsed, dict):
        raise RuntimeError("Google AI Studio вернул невалидный JSON для отчёта.")
    return {**parsed, "source": "gemini", "publicIntel": public_intel}
