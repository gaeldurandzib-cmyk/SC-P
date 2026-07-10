# DevShield — módulos de backend

Tres piezas reales y probadas de la plataforma descrita en la especificación:

```
src/
  vault/crypto.ts          Cifrado AES-256-GCM de credenciales SSH + rotación de llave maestra
  ssh/sftpClient.ts        Conexión SSH, árbol de directorios remoto, streaming de archivos
  linter/engine.ts         Dispatcher: detecta lenguaje y llama al runner correspondiente
  linter/runners/
    jsRunner.ts             JavaScript/TypeScript vía ESLint
    pyRunner.ts             Python vía flake8 + mypy
    goRunner.ts             Go vía staticcheck (requiere el toolchain de Go)
test/
  fakeSshServer.ts          Servidor SSH real (ssh2 en modo servidor) usado solo en pruebas
```

## Correr las pruebas

```bash
npm install
npm test          # 18 pruebas: cifrado, SSH/SFTP contra un servidor SSH real, y linters reales
npm run typecheck # tsc --noEmit
```

Las pruebas de SSH/SFTP no usan mocks: levantan un servidor SSH de verdad
(`ssh2` en modo `Server`, ver `test/fakeSshServer.ts`) en `127.0.0.1` con un
usuario y contraseña de prueba, y el cliente (`RemoteServerSession`) se
conecta a él igual que se conectaría a un servidor real del cliente.

Las pruebas de Python invocan `flake8` y `mypy` de verdad sobre un archivo
temporal. La prueba de Go verifica que, si `staticcheck` no está instalado,
el runner falla explícitamente en vez de inventar un resultado — así el
frontend puede mostrar "análisis no disponible" en lugar de un falso "sin errores".

## Qué es real y qué queda para producción

| Pieza | Estado aquí | Para producción |
|---|---|---|
| Cifrado AES-256-GCM + rotación de llave | Completo y probado | Igual — solo cambia de dónde se leen las llaves (secret manager) |
| Cliente SSH/SFTP (árbol, streaming, guardado) | Completo y probado contra un servidor SSH real | Igual — se conecta a servidores reales de la misma forma |
| Motor de linters (dispatcher + JS + Python) | Completo, corre los binarios reales | Mover cada runner a un contenedor Docker aislado (`--network none`, ver `dockerCommandFor` en `engine.ts`) para no ejecutar código de terceros en el proceso del backend |
| Runner de Go (staticcheck) | Implementado, pero no ejecutable en este entorno (sin toolchain de Go) | Igual, dentro del contenedor `devshield/staticcheck-runner` que sí lo trae |
| Diffs tipo Myers para versionado, WebSockets + CRDTs para colaboración, proxy de sesión sin exponer credenciales al consultor | No incluido en esta entrega | Siguiente paso natural |

## Decisiones de seguridad relevantes

- Las credenciales SSH descifradas viven solo en memoria del proceso, durante
  el tiempo de una operación; nunca se escriben a disco ni se loguean.
- `MasterKeyNotFoundError` es intencional: si el atacante solo tiene la base
  de datos (sin las variables de entorno del backend), el secreto es
  irrecuperable — está probado en `crypto.test.ts`.
- GCM detecta manipulación del texto cifrado (integridad), no solo lo oculta
  (confidencialidad).
