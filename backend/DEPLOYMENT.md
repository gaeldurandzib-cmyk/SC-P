/**
 * DEPLOYMENT.md
 *
 * 🛡️ DevShield - Guía de Despliegue y Configuración
 *
 * Este archivo documenta cómo ejecutar, configurar y desplegar DevShield
 * en diferentes entornos.
 */

# 🛡️ DevShield - Guía de Despliegue

## 📋 Tabla de Contenidos

1. [Instalación Local](#instalación-local)
2. [Variables de Entorno](#variables-de-entorno)
3. [Ejecución](#ejecución)
4. [Endpoints HTTP](#endpoints-http)
5. [WebSocket Events](#websocket-events)
6. [Docker Deployment](#docker-deployment)
7. [Troubleshooting](#troubleshooting)

---

## 🚀 Instalación Local

### Requisitos Previos

- **Node.js** ≥ 18.x
- **npm** o **yarn**
- Herramientas de análisis (instaladas automáticamente por los runners):
  - **eslint** (JavaScript/TypeScript)
  - **flake8, mypy** (Python)
  - **staticcheck** (Go)
  - **php** (PHP - opcional para desarrollo)

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/gaeldurandzib-cmyk/SC-P.git
cd SC-P/backend

# 2. Instalar dependencias
npm install

# 3. Verificar TypeScript
npm run typecheck

# 4. Ejecutar en modo desarrollo (con hot-reload)
npm run dev

# O en modo producción
npm start
```

---

## 🔧 Variables de Entorno

Crea un archivo `.env` en `backend/` con estas variables:

```bash
# Servidor
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info  # trace, debug, info, warn, error

# Autenticación
DEVSHIELD_API_TOKEN=tu-token-secreto-super-largo-aqui

# SSH/SFTP (opcional para desarrollo local)
SSH_HOST=dev.company.com
SSH_PORT=22
SSH_USER=devshield-bot
SSH_KEY_PATH=/home/user/.ssh/id_rsa

# Base de datos / Vault (futuro)
VAULT_ENCRYPTION_KEY=your-master-key-here
```

### ⚠️ Seguridad en Producción

- **NUNCA** commitear `.env` al repositorio
- Usar un vault/secrets manager (HashiCorp Vault, AWS Secrets Manager, etc.)
- Rotar `DEVSHIELD_API_TOKEN` regularmente
- Usar HTTPS/WSS en lugar de HTTP/WS en producción

---

## ▶️ Ejecución

### Modo Desarrollo

```bash
npm run dev
```

**Salida esperada:**
```
╔════════════════════════════════════════╗
║  🛡️  DevShield - Iniciando...          ║
║  Entorno: development               ║
║  Puerto: 3000                          ║
╚════════════════════════════════════════╝

✓ Fastify inicializado
✓ Socket.io registrado
✓ Middleware de autenticación activo
✓ Rutas HTTP registradas
✓ WebSockets configurados

╔════════════════════════════════════════╗
║  ✅  DevShield Online                  ║
║  HTTP:      http://0.0.0.0:3000       ║
║  WebSocket: ws://0.0.0.0:3000         ║
╚════════════════════════════════════════╝
```

### Verificar Salud del Servicio

```bash
curl -s http://localhost:3000/health | jq
```

Respuesta esperada:
```json
{
  "status": "ok",
  "timestamp": "2026-07-10T04:30:00.000Z",
  "version": "1.0.0"
}
```

---

## 📡 Endpoints HTTP

### 1. **POST /api/analyze** - Analizar un Archivo

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Authorization: Bearer devshield-secret-token-dev" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "app.ts",
    "source": "const x: number = \"hello\";"
  }'
```

**Respuesta:**
```json
{
  "file": "app.ts",
  "language": "typescript",
  "findings": [
    {
      "line": 1,
      "column": 27,
      "severity": "error",
      "rule": "no-undef",
      "message": "'hello' no está definida en este contexto.",
      "tool": "eslint"
    }
  ],
  "failed": false
}
```

### 2. **POST /api/batch-analyze** - Analizar Múltiples Archivos

```bash
curl -X POST http://localhost:3000/api/batch-analyze \
  -H "Authorization: Bearer devshield-secret-token-dev" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      { "filename": "a.ts", "source": "const x = 1;" },
      { "filename": "b.py", "source": "import os\nprint(undefined_var)" }
    ]
  }'
```

### 3. **GET /health** - Verificar Estado

```bash
curl http://localhost:3000/health
```

No requiere autenticación.

---

## 🔌 WebSocket Events

### Cliente → Servidor

#### `analyze:start`
Inicia el análisis de un archivo.

```javascript
socket.emit("analyze:start", {
  fileId: "file-123",
  filename: "main.ts",
  source: "const x = 1;",
  language: "typescript" // opcional
});
```

#### `analyze:batch`
Analiza múltiples archivos en paralelo.

```javascript
socket.emit("analyze:batch", {
  batchId: "batch-456",
  files: [
    { fileId: "f1", filename: "a.ts", source: "..." },
    { fileId: "f2", filename: "b.py", source: "..." }
  ]
});
```

### Servidor → Cliente

#### `connected`
Confirmación de conexión.

```javascript
socket.on("connected", (data) => {
  console.log(`Conectado con ID: ${data.clientId}`);
});
```

#### `finding`
Emitido cuando se detecta un hallazgo.

```javascript
socket.on("finding", (data) => {
  console.log(`[${data.finding.severity}] ${data.finding.message}`);
  // Pintar línea roja/amarilla en el editor
});
```

#### `analyze:complete`
Análisis finalizado.

```javascript
socket.on("analyze:complete", (data) => {
  console.log(`Análisis listo: ${data.findings.length} hallazgos en ${data.duration}ms`);
});
```

#### `analyze:error`
Error durante el análisis.

```javascript
socket.on("analyze:error", (data) => {
  console.error(`Error: ${data.error}`);
});
```

---

## 🐳 Docker Deployment

### Crear Imagen

```bash
# 1. Crear Dockerfile en backend/
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Copiar dependencias
COPY package*.json ./
RUN npm ci --only=production

# Copiar código
COPY src ./src
COPY tsconfig.json ./

# Compilar TypeScript
RUN npx tsc

# Exponer puerto
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 || process.exit(1))"

# Iniciar
CMD ["node", "dist/index.js"]
EOF

# 2. Construir imagen
docker build -t devshield:latest .

# 3. Ejecutar contenedor
docker run -d \
  --name devshield \
  -p 3000:3000 \
  -e DEVSHIELD_API_TOKEN="super-secret-token" \
  -e NODE_ENV=production \
  devshield:latest
```

### Con Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  devshield:
    image: devshield:latest
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      NODE_ENV: production
      DEVSHIELD_API_TOKEN: ${DEVSHIELD_API_TOKEN}
      LOG_LEVEL: info
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
```

```bash
# Ejecutar
DEVSHIELD_API_TOKEN="secret" docker-compose up -d
```

---

## 🐛 Troubleshooting

### "Port 3000 already in use"

```bash
# Cambiar puerto
PORT=3001 npm run dev

# O matar el proceso que ocupa el puerto
lsof -ti:3000 | xargs kill -9
```

### "php -l: command not found"

```bash
# PHP no está instalado. Para desarrollo:
brew install php  # macOS
apt-get install php-cli  # Ubuntu/Debian
```

### "WebSocket connection refused"

- Verificar que el servidor está corriendo: `curl http://localhost:3000/health`
- Verificar CORS en `src/index.ts` permite el origen del cliente
- En producción, usar WSS (WebSocket Secure) con certificados SSL

### "401 Unauthorized"

```bash
# Verificar que se envía el token correctamente
curl -H "Authorization: Bearer devshield-secret-token-dev" \
     http://localhost:3000/api/analyze \
     -d '{"filename":"test.ts","source":"const x = 1;"}'
```

### "Module not found"

```bash
# Reinstalar dependencias
rm -rf node_modules package-lock.json
npm install
npm run typecheck
```

---

## 📊 Monitoreo en Producción

### Logs

```bash
# Ver logs en tiempo real
docker logs -f devshield

# O con grep para errores
docker logs devshield | grep ERROR
```

### Métricas Recomendadas

- Número de conexiones WebSocket activas
- Latencia de análisis por lenguaje
- Tasa de errores por runner
- Memoria y CPU consumida

---

## 🔐 Checklist de Seguridad

- [ ] DEVSHIELD_API_TOKEN es único y fuerte (>32 caracteres)
- [ ] .env no está en control de versiones
- [ ] HTTPS/WSS en producción
- [ ] CORS restricto a dominios conocidos
- [ ] Logs no exponen tokens o credenciales
- [ ] Análisis de código corre en contenedores aislados (Docker)
- [ ] Límites de memoria/CPU en contenedores
- [ ] Rotación de tokens cada 90 días

---

**¿Preguntas? Revisa `backend/README.md` o abre un issue.**
