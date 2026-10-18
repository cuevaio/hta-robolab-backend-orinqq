# Generar con la Jetson por USB serial

RoboLab usa **Qwen 2.5 3B Instruct Q4_K_M** en la Jetson Orin Nano de 8 GB. El docente conecta el cable, pulsa **Conectar Jetson**, elige el dispositivo y pide misiones. La computadora puede tener otra Wi-Fi: la generación viaja por el puerto serie virtual del USB, sin IP, SSH, Node ni acompañante instalado en esa computadora.

La sesión, la revisión, el guardado y la asignación siguen en Convex y necesitan internet en la computadora. No hay cambio automático de Jetson a cloud. Una respuesta local es un borrador: `agent.reviewLocal` la certifica antes de mostrarla y `agent.save` vuelve a validarla.

## En cualquier computadora

1. Alimenta la Jetson con su fuente DC y arráncala normalmente, sin Recovery. El modelo y el servicio ya deben estar instalados en ella.
2. Conecta su USB-C con un cable de datos a la computadora.
3. Abre RoboLab por HTTPS (o localhost para desarrollo) en un navegador de escritorio con Web Serial. Chrome y Edge de escritorio son los navegadores previstos; la web detecta si la API no existe.
4. En «Nuevo reto → Crear con el asistente → Jetson por USB», pulsa **Conectar Jetson** y elige su puerto. En Windows aparece como un puerto COM USB. La web verifica que responde el servicio `robolab-jetson`, versión 1, antes de permitir generar.
5. Describe el aprendizaje y genera. La primera carga puede tardar más. Si retiras el cable, el aprendizaje se conserva y debes volver a elegir el dispositivo.

No hace falta que la Jetson y la computadora compartan Wi-Fi. Windows debe reconocer el dispositivo USB CDC ACM con su controlador; si el puerto no aparece, revisa el Administrador de dispositivos y el cable. La prueba física en Windows sigue pendiente; las pruebas del transporte usan streams reales y el servicio se comprueba con el USB real de una laptop Linux.

Fuentes de plataforma: [Web Serial de Chrome](https://developer.chrome.com/docs/capabilities/serial), [USB de Orin Nano](https://docs.nvidia.com/jetson/orin-nano-devkit/user-guide/latest/hardware_layout.html), [controlador USB serial de Windows](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-driver-installation-based-on-compatible-ids).

## Instalación en la Jetson (una vez)

Se realiza mediante acceso de mantenimiento SSH; las computadoras que después usen RoboLab no necesitan ese acceso. Requiere Ubuntu iniciado, Node >=22.12, Python 3 de Ubuntu, Ollama y el modelo descargado. No instales drivers CUDA de PC sobre Jetson. En esta placa se verificó Ollama 0.40.6 ARM64 con CUDA 13 de L4T R39, contexto 8192 y 100 % GPU.

```bash
ollama pull qwen2.5:3b-instruct-q4_K_M
ollama ps
```

Ollama debe escuchar únicamente en `127.0.0.1:11434`, con `OLLAMA_NO_CLOUD=1`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1` y `OLLAMA_CONTEXT_LENGTH=8192`. La descarga inicial necesita internet; la inferencia posterior no.

Instala este repositorio en `/opt/robolab/backend` y ejecuta `npm ci` allí, incluyendo las dependencias de desarrollo porque `tsx` ejecuta el servicio TypeScript. Mientras este cambio esté en revisión, usa la rama `codex/jetson-local-generation` en ambos repositorios. La unidad usa el usuario `jetson` y el grupo `dialout`; ajusta el usuario si tu instalación es diferente.

El puerto `/dev/ttyGS0` tiene una consola de login de fábrica. **Guarda su estado antes de dedicarlo a generación.** Conecta sin generaciones pendientes, conserva el acceso SSH y ejecuta en la Jetson:

```bash
sudo install -d -m 700 /var/backups/robolab-usb
systemctl is-enabled serial-getty@ttyGS0.service | sudo tee /var/backups/robolab-usb/serial-getty-enabled.txt
sudo systemctl cat serial-getty@ttyGS0.service | sudo tee /var/backups/robolab-usb/serial-getty.service
cd /opt/robolab/backend
sudo install -m 644 ops/jetson/99-robolab-usb.rules /etc/udev/rules.d/99-robolab-usb.rules
sudo install -m 644 ops/jetson/robolab-usb.service /etc/systemd/system/robolab-usb.service
sudo systemctl disable --now serial-getty@ttyGS0.service
sudo systemctl mask serial-getty@ttyGS0.service
sudo udevadm control --reload-rules
sudo udevadm trigger --action=change --subsystem-match=tty --sysname-match=ttyGS0
sudo systemctl daemon-reload
sudo systemctl enable --now robolab-usb
```

El lanzador stdlib `open_usb.py` configura el puerto en modo raw, sin eco de consola, y ejecuta `scripts/agent-usb.ts`. Su servicio corre sin root y el permiso del puerto se limita a `dialout`. La generación usa el orquestador compartido y Ollama loopback directamente en la Jetson. No se reciben rutas, URLs ni comandos de shell por USB. La unidad se reinicia si el proceso termina; al abrir el puerto la web verifica nuevamente la identidad del servicio.

Para restaurar la consola USB original, usando SSH:

```bash
sudo systemctl disable --now robolab-usb
sudo systemctl unmask serial-getty@ttyGS0.service
sudo systemctl enable --now serial-getty@ttyGS0.service
```

Esta receta restaura el estado `enabled` de la placa donde se instaló; si tu copia de seguridad indica otro estado, restáuralo. No se cambian el firmware, el SSD, el gadget USB ni la red de mantenimiento.

## Preparar Qwen al arrancar

`ollama.service` mantiene la API del modelo. `robolab-qwen.service` carga el modelo ya instalado y comprueba que esté completamente en GPU. Desde el repositorio instalado:

```bash
sudo install -d -m 755 /usr/local/lib/robolab /etc/systemd/system/ollama.service.d
sudo install -m 644 ops/jetson/prepare_model.py /usr/local/lib/robolab/prepare_model.py
sudo install -m 644 ops/jetson/ollama-robolab.conf /etc/systemd/system/ollama.service.d/robolab.conf
sudo install -m 644 ops/jetson/robolab-qwen.service /etc/systemd/system/robolab-qwen.service
sudo systemctl daemon-reload
sudo systemctl enable ollama robolab-qwen
sudo systemctl restart ollama
sudo systemctl restart robolab-qwen
```

Guarda antes cualquier drop-in existente y ejecuta sin una generación en curso. Los reinicios aplican la configuración aunque Ollama estuviera activo. El preparador queda `active (exited)` porque termina su tarea; no descarga modelos ni usa cloud. El modelo se libera de memoria después de diez minutos sin uso y vuelve a cargarse cuando se solicita.

## Protocolo y evidencia

USB CDC ACM, 115200 en la apertura, JSON UTF-8 con un salto de línea por trama. La versión 1 acepta `hello`, `generate`, `ping` y `cancel`, cada uno con `id`. Ejemplo de identificación:

```json
{"v":1,"id":"prueba","method":"hello"}
```

El resultado identifica `device: robolab-jetson`, `protocol: 1`, proveedor, modelo y disponibilidad. Cada respuesta correlaciona el mismo ID; nunca se ejecuta contenido recibido. Las solicitudes tienen un máximo de 16 KiB y las respuestas de 512 KiB. Solo se acepta una generación simultánea. La web envía latidos cada 4 segundos; después de 15 segundos sin mensajes, el servicio cancela la inferencia. Salir de la pantalla envía una cancelación y cierra el puerto. Los límites de generación son 180 segundos por intento y 540 segundos por solicitud de hasta tres grados.

La propuesta se valida y repara hasta dos veces mediante el orquestador existente. No se presenta una plantilla de respaldo como resultado de IA. La paleta incluye los cuatro movimientos y las reparaciones reciben el costo mínimo calculado por el simulador sin modificar ni aprobar automáticamente la misión.

En la Jetson:

```bash
systemctl is-enabled ollama robolab-qwen robolab-usb
systemctl is-active ollama robolab-qwen robolab-usb
ollama ps
sudo journalctl -fu robolab-usb -o cat
```

Los registros de generación contienen `transport: usb_serial`, UUID de generación, modelo, duración, llamadas y huella SHA-256 de las misiones. Esa huella coincide con el JSON recibido aunque se reordenen sus claves. No se registran objetivos, prompts ni IDs libres del modelo. Es evidencia operativa, no un campo de origen confiable en Convex. El preparador registra también hostname, ID del arranque y digest del modelo.

Pruebas: `npm run verify` y `npm run test:jetson` (stdlib Python en Linux, incluye pseudoterminal y el CLI Node real). La web prueba la selección por clic, streams fragmentados, identidad, desconexión, cancelación y certificación con Convex.

El antiguo `npm run agent:local` y el túnel SSH siguen disponibles como herramientas de mantenimiento y pruebas. La web usa USB serial directamente y no recurre a ese transporte ni a cloud automáticamente.
