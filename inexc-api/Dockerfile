FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ara poppler-utils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["npm", "start"]
