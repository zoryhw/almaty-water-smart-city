# Django Backend

Backend живёт в папке `back` и совместим с текущим фронтом по `/api/*`.

## Что использовано

- Django
- PostgreSQL через `DATABASE_URL`
- Supabase как managed Postgres
- Google Gemini для `ai/chat` и `ai/report`

## Env

Основные переменные можно держать в корневом `.env.local`:

```env
DJANGO_SECRET_KEY=change-me
DJANGO_DEBUG=true
PORT=8787
DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres?sslmode=require
GEMINI_API_KEY=your_google_ai_studio_api_key
ALLOWED_HOSTS=127.0.0.1,localhost
FRONTEND_URL=http://127.0.0.1:5173
VITE_API_BASE_URL=http://127.0.0.1:8787
```

## Команды

```powershell
.\back\.venv\Scripts\python.exe back\manage.py migrate
.\back\.venv\Scripts\python.exe back\manage.py runserver 127.0.0.1:8787
```

Для Supabase лучше использовать direct connection string или pooler-строку с `sslmode=require`.

## Production / Render

В корне проекта лежит `render.yaml` для двух сервисов:

- `smart-city-water-api` — Django backend
- `smart-city-water` — статический Vite frontend

Что нужно заполнить в Render после импорта Blueprint:

- у backend: `DATABASE_URL`, `GEMINI_API_KEY`, `FRONTEND_URL`
- у frontend: `VITE_API_BASE_URL`

Типовой production URL-сценарий:

```env
FRONTEND_URL=https://your-frontend.onrender.com
VITE_API_BASE_URL=https://your-backend.onrender.com
DJANGO_DEBUG=false
```

Backend уже настроен на `gunicorn`, `WhiteNoise`, `collectstatic` и безопасные cookie/SSL-параметры для production.
