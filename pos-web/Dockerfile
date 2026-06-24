FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=https://grid-backend-production-5fd0.up.railway.app/api
ARG BUILD_VERSION
ENV VITE_API_URL=$VITE_API_URL
ENV BUILD_VERSION=$BUILD_VERSION
RUN echo "Building version: $BUILD_VERSION at $(date -u +%Y-%m-%dT%H:%M:%SZ)" && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
