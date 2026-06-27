FROM node:20-alpine

# Рабочая директория
WORKDIR /app

# Утилита для healthcheck
RUN apk add --no-cache wget

# Установка зависимостей по lockfile (воспроизводимо)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Копируем приложение
COPY . .

# Непривилегированный пользователь (безопасность)
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/public/images /app/backups \
  && chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 3000

# Проверка живости контейнера
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["npm","start"]
