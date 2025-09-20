# Assuming your Dockerfile is in the 'matching-service' directory
FROM node:22-alpine AS development

WORKDIR /app

# Copy package.json and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy your source code
COPY src ./src
COPY .env ./.env
COPY tsconfig.json ./tsconfig.json

# Compile TypeScript (if not already done by a previous stage)
# This example assumes you have a build step in your package.json
RUN npm run build

# If you have other files at the root of matching-service that are needed:
# COPY . .

EXPOSE 6001


CMD ["node", "dist/app.js"]