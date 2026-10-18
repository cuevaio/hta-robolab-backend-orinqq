# Jetson por USB serial

**Objetivo:** conectar el cable, elegir la Jetson desde RoboLab y generar sin instalar software en cada laptop ni configurar red o SSH allí.

**Arquitectura:** Web Serial transporta JSON UTF-8 delimitado por salto de línea por USB CDC ACM. Un servicio de la Jetson atiende su puerto `/dev/ttyGS0` y usa el orquestador TypeScript existente contra Ollama loopback. La web sigue pasando los borradores por `agent.reviewLocal` y guardando en Convex. No se cambia el modelo ni el arranque del SSD.

**Restricciones:** navegador de escritorio compatible con Web Serial y contexto seguro; selección por clic; sin ejecutar comandos recibidos por el puerto; protocolo versionado con identidad de servicio, IDs, límites de tamaño, cancelación y latidos. Una generación por dispositivo. No hay cambio automático a nube. Los registros no incluyen objetivos ni contenido. El acceso SSH de mantenimiento sigue funcionando por USB.

El puerto serie actual tiene un login de consola. Se respalda su configuración y se dedica al servicio de generación mediante systemd; la guía incluye cómo restaurarlo. La prueba en Windows físico se declara pendiente hasta disponer de esa computadora.

## Implementación y verificación

- [x] Protocolo y sesión: pruebas primero de identidad, fragmentación, tamaño, concurrencia, cancelación, pérdida de latidos y privacidad; reutilizar `generateActivity`.
- [x] Arranque: lanzador stdlib que abre el puerto en modo raw y ejecuta Node; unidad systemd y permisos mínimos. Probar con pseudoterminal, sin placa.
- [x] Web: selector de puerto en «Conectar Jetson», verificar identidad, transmitir solicitudes y respuestas, cerrar/cancelar al salir o desconectar. Pruebas con streams reales, conservando certificación Convex.
- [x] Ejecutar verificaciones de ambos repositorios; revisión independiente de cambios.
- [x] Instalar y comprobar en la Jetson real usando el puerto USB de la laptop, sin túnel para inferencia; probar una generación real y arranque del servicio.
- [x] Actualizar los dos PRs y fijar la dependencia HTTPS del frontend.
