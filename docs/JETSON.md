# Generar misiones con una Jetson por USB

RoboLab puede generar con **Qwen 2.5 3B Instruct Q4_K_M** en una Jetson Orin Nano de 8 GB. La nube sigue disponible como opción independiente. No hay cambio automático de local a nube: si la Jetson falla, se informa al docente.

La inferencia se hace en la Jetson. La sesión, la certificación de solvencia, el guardado y la asignación continúan en Convex y necesitan internet. Esto no convierte toda la plataforma en una aplicación sin conexión.

## Recorrido

Web → conector local de la laptop (`127.0.0.1:8765`) → túnel SSH sobre la red USB (`127.0.0.1:11435`) → Ollama en la Jetson (`127.0.0.1:11434`). La propuesta vuelve a la web y pasa por `agent.reviewLocal` en Convex antes de mostrarse; `agent.save` vuelve a validarla al guardar.

Convex cloud no puede acceder a `192.168.55.1` ni al localhost de la laptop. No configures esa dirección como proveedor del despliegue cloud.

## Jetson (una vez)

Con alimentación DC y Ubuntu iniciado normalmente, sin el puente de Recovery:

1. Comprueba `ssh jetson-usb`. Ese alias debe apuntar al usuario de tu Jetson y a `192.168.55.1`, con su clave y huella verificadas. El USB-C debe ser un cable de datos y la laptop debe tener su interfaz de red USB funcionando.
2. Instala Ollama con el [instalador oficial](https://docs.ollama.com/linux). Para ARM64 se necesita el paquete correspondiente; no instales drivers de PC sobre Jetson.
3. Mantén el servicio en loopback y desactiva cloud. En `/etc/systemd/system/ollama.service.d/robolab.conf`:

```ini
[Service]
Environment=OLLAMA_HOST=127.0.0.1:11434
Environment=OLLAMA_NO_CLOUD=1
Environment=OLLAMA_NUM_PARALLEL=1
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_CONTEXT_LENGTH=8192
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
sudo systemctl restart ollama
ollama pull qwen2.5:3b-instruct-q4_K_M
ollama run qwen2.5:3b-instruct-q4_K_M 'Responde en español: listo'
ollama ps
```

La descarga inicial necesita internet. Después el modelo puede inferir sin internet. `ollama ps` debe confirmar uso de GPU; detectar la placa con `nvidia-smi` por sí solo no demuestra que el modelo use la GPU. En L4T R39 se verificó Ollama 0.40.6 con su biblioteca CUDA 13; el instalador puede avisar que no reconoce JetPack aunque el runtime detecte Orin. Comprueba siempre la inferencia real.

## Laptop

Requiere Node >=22.12, SSH y este repositorio:

```bash
npm ci
# Deja esta terminal abierta; toda la inferencia pasa por el cable USB.
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:11435:127.0.0.1:11434 jetson-usb
```

En otra terminal:

```bash
npm run agent:local
```

Abre «Nuevo reto → Crear con el asistente → Jetson por USB». El navegador puede pedir acceso a la red local: permítelo para conectar con el acompañante de esta laptop.

Se permiten por defecto `http://localhost:5173`, `http://localhost:5175`, `https://robolab-web.vercel.app` y `https://robolab-web-omega.vercel.app`. Para otro dominio o una preview Vercel, configura su origen exacto **al iniciar el conector**:

```bash
AGENT_LOCAL_ORIGINS=https://tu-preview.vercel.app,http://localhost:5175 npm run agent:local
```

No uses comodines. El conector escucha solo en `127.0.0.1`; comprueba Host, Origin y JSON, limita cuerpos y rechaza solicitudes concurrentes. No lleva claves de Convex ni del proveedor cloud. `OLLAMA_URL` puede seleccionar otro puerto loopback del túnel; `OLLAMA_MODEL` otro modelo ya descargado. No acepta URLs del navegador.

## Comprobar y diagnosticar

```bash
curl -H 'Origin: http://localhost:5175' http://127.0.0.1:8765/health
ssh jetson-usb 'ollama list; ollama ps; systemctl is-active ollama'
ssh jetson-usb 'sudo journalctl -u ollama -n 40 --no-pager'
```

`ready: true` indica que el conector alcanzó Ollama y encontró el modelo. No equivale a haber generado una misión. El primer arranque carga el modelo y puede tardar más. El límite local es 180 segundos por intento y 540 segundos por solicitud de hasta tres grados, sin cambiar los límites cloud. El formato local fija el grado solicitado y usa por defecto una, dos o tres estaciones para 2.º, 3.º y 4.º, respectivamente; una cantidad explícita en la solicitud tiene prioridad. También fija los cuatro comandos de movimiento para evitar mapas sin giros. Si una propuesta no tiene energía suficiente, el simulador aporta al modelo el costo mínimo de una ruta y el límite solicitado; el modelo debe devolver otra propuesta completa. No se sube el presupuesto ni se aprueba el mapa automáticamente. Esto reduce errores del modelo pequeño, pero no sustituye la validación. El modelo pequeño puede devolver JSON que no tenga solución: se repara hasta dos veces; ninguna plantilla de respaldo se ofrece como contenido generado por IA.

Si se desconecta el USB, conserva el objetivo y usa «Comprobar conexión» después de reconectar. Si cierras la página, la solicitud local se cancela. Nunca apagues la Jetson quitando la alimentación durante escrituras; usa `sudo poweroff` antes de desconectarla.

## Arranque automático y evidencia desde la terminal

En la Jetson, `ollama.service` mantiene la API activa y `robolab-qwen.service` carga el modelo instalado y comprueba que esté completamente en GPU. El preparador usa Python 3 de Ubuntu, sin pip, y solo llama a `127.0.0.1`: no descarga modelos al arrancar ni necesita una clave cloud. Los archivos estándar están en `ops/jetson/`.

Con Ollama y el modelo ya instalados y sin una generación en curso, guarda una copia de cualquier configuración de RoboLab existente. Desde la raíz de este repositorio en la laptop:

```bash
scp ops/jetson/prepare_model.py ops/jetson/robolab-qwen.service ops/jetson/ollama-robolab.conf jetson-usb:/tmp/
ssh jetson-usb 'sudo install -d -m 755 /usr/local/lib/robolab /etc/systemd/system/ollama.service.d; sudo install -m 644 /tmp/prepare_model.py /usr/local/lib/robolab/prepare_model.py; sudo install -m 644 /tmp/robolab-qwen.service /etc/systemd/system/robolab-qwen.service; sudo install -m 644 /tmp/ollama-robolab.conf /etc/systemd/system/ollama.service.d/robolab.conf; sudo systemctl daemon-reload; sudo systemctl enable ollama robolab-qwen && sudo systemctl restart ollama && sudo systemctl restart robolab-qwen'
```

Los reinicios aplican el drop-in incluso si Ollama ya estaba activo y vuelven a ejecutar la comprobación. El preparador aparece como `active (exited)` porque hace una tarea y termina; Ollama continúa ejecutándose. Si el modelo falta o cae a CPU, el preparador informa el error y no lo declara preparado en GPU. El modelo se conserva en memoria diez minutos después de su último uso; si se libera, Ollama lo carga de nuevo cuando recibe una solicitud.

Para comprobar el último arranque:

```bash
ssh jetson-usb 'systemctl is-enabled ollama robolab-qwen; systemctl is-active ollama robolab-qwen; ollama ps'
ssh jetson-usb 'sudo journalctl -b -u robolab-qwen --no-pager'
```

El registro `model_ready` contiene hostname, ID del arranque, modelo, digest, porcentaje GPU, contexto y duración. Para observar las inferencias reales:

```bash
ssh jetson-usb 'sudo journalctl -fu ollama -o short-iso'
```

En la laptop, el túnel USB y el acompañante son procesos distintos de Ollama. En esta instalación se administran con servicios de usuario `robolab-jetson-tunnel` y `robolab-local-generation`, habilitados al iniciar sesión; el túnel se reconecta tras perder el USB. Esto no inicia ni despliega Convex o la web en la Jetson.

```bash
systemctl --user status robolab-jetson-tunnel robolab-local-generation
journalctl --user -u robolab-local-generation -f -o cat
```

Cada solicitud válida registra `started` y su resultado (`completed`, `cancelled` o `failed`) con un `generationId`, proveedor y modelo. Al completarse, incluye llamadas, reparaciones y huella SHA-256 de las misiones ofrecidas. La respuesta HTTP incluye ese mismo `generationId`. La huella ordena recursivamente las claves JSON: se puede comparar aunque Convex reordene las propiedades. No se registran objetivos, prompts, nombres de alumnos ni el JSON completo. Los registros describen la generación local; no sustituyen la autorización ni la certificación de Convex, y no se añaden como una declaración de origen confiable en la tabla de misiones.

Las pruebas del preparador se ejecutan con `npm run test:jetson` (Python 3) y en GitHub Actions, sin Jetson ni descargas. `npm run verify` conserva los requisitos existentes del backend.
