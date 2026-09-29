# ETAPA 1: Compilación
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Genera la carpeta /dist/super-asgard-v/browser
RUN npx ng build --configuration production

# ETAPA 2: Servidor de producción
FROM nginx:alpine
# Copiamos los archivos compilados al directorio de Nginx
COPY --from=build /app/dist/super-asgard-v/browser /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
