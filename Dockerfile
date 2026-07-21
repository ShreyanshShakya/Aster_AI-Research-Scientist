FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

# The app uses Node's built-in modules only; no npm install is required.
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]
