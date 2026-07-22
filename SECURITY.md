# SECURITY — S1COM / Сервис.com

## Реализовано
- **Авторизация админки:** JWT (HS256, `issuer='s1com'` зафиксированы в sign/verify — защита от alg-подмены), `expiresIn=12h`. Пароль хэшируется (scrypt, `lib/security.js`), сравнение через `timingSafeEqual`.
- **Дефолтные секреты:** в production сервер НЕ стартует с дефолтными `ADMIN_PASSWORD`/`JWT_SECRET`/`IMPORT_TOKEN`.
- **Токены выгрузки/импорта:** отдельный `IMPORT_TOKEN`, сравнение `safeEqual` (timing-safe).
- **Заявки:** honeypot-поля; состав пересобирается по БД (клиентским ценам/названиям не доверяем); **телефон обязателен и валидируется** серверно (`normalizePhoneKZ`, ответ `{code:"INVALID_PHONE"}`); rate-limit (20/мин).
- **Rate-limit:** вход 10/15мин, импорт, заявки, общий.
- **CMS-контент:** `sanitizeCmsHtml` вырезает `<script>`, `on*=`, `srcdoc`, `javascript:` (покрыто тестом с XSS-инъекцией).
- **Заголовки:** helmet + CSP (Google Fonts разрешены), CORS настраивается `CORS_ORIGINS`.
- **Путь/traversal:** имена бэкапов валидируются (`BACKUP_RE` + `path.basename`); статические HTML отдаются через контейнмент пути.
- **Секреты Telegram:** `tg_token` не возвращается через GET настроек (только флаг `tg_token_set`), POST не затирает пустым; ошибка Telegram не ломает приём заявки.
- **Публичный конфиг:** `/api/site-config` отдаёт только контакты/домен, без секретов.
- **Зависимости:** `npm audit` → **0 уязвимостей** (факт, 2026-07-10).

## Ограничения / TODO (см. FINAL-отчёт, п.20)
- CSP всё ещё `unsafe-inline` (много inline-`onclick` в админке/фронте) — снятие = крупный рефактор.
- Admin-токен хранится в localStorage — по best practice лучше HttpOnly Secure SameSite cookie + CSRF (крупное изменение).
- Полный OWASP-прогон (SSRF, IDOR, prototype pollution, ReDoS, open redirect, host-header, zip/Excel-bomb, malicious SVG) — частично покрыт; отдельный аудит рекомендуется.
- `audience` в JWT не задан (issuer задан).

## Рекомендации владельцу
- Задать длинные случайные `JWT_SECRET`/`ADMIN_PASSWORD`/`IMPORT_TOKEN` в ENV хостинга (не в git).
- Ротировать `ALSTYLE_API_KEY`/`IMPORT_TOKEN`, если засветились.
- Держать `NODE_ENV=production`.
