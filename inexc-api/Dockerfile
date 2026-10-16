FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara poppler-utils unzip antiword python3-xlrd python3-pil \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js learner-service.js course-payment.js import-course-catalog.js course-catalog-20261016.json message-subscriptions.js message-subscription-links.js message-contacts.js message-file-reader.py message-format.js message-mail.js message-mail-legacy.js message-mail-v4.js message-format-v4.js message-design.js message-font-faces.js message-studio.js message-studio-schema.js message-suppression.js ./
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["npm", "start"]
