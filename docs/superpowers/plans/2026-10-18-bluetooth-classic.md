# Plan de implementación de Bluetooth Classic

> Ejecución en esta sesión con pruebas primero y revisión independiente final.

**Objetivo:** conectar RoboLab a un ESP32 clásico por SPP con el hardware de robi.ino.
**Arquitectura:** dominio puro para el contrato, firmware local con watchdog y
adaptador Web Serial. Convex conserva las funciones educativas y el relé wifi.
**Tecnologías:** TypeScript, React, Web Serial, Arduino-ESP32 3.x, C++.
**Especificación:** ../specs/2026-10-18-bluetooth-classic.md

## Restricciones globales

- Español, comandos A/R/D/Z, máximo 128 pasos, ids 1–36 caracteres.
- LF/CRLF, tramas de hasta 200 caracteres, latido 1000 ms y vencimiento 3500 ms.
- El robot actual anuncia ADZ y ARC; ningún paso de R se ejecuta.
- Sin secretos, cambios aditivos y npm run verify antes de cada commit.

## Riesgos a cubrir

- Fragmentos o ruido no deben convertirse en movimientos.
- Un id repetido o estado tardío no debe ejecutar ni completar otro envío.
- Desconexión, latidos ausentes y STOP apagan los motores.
- Selector cancelado y desmontaje durante conexión no dejan el puerto abierto.
- El envío automático del reto usa el mismo vínculo que el botón manual.

## Tarea 1: contrato y firmware (backend)

- [ ] Crear pruebas fallidas en domain/robot/bluetooth.test.ts y firmware/tests/bluetooth.cpp.
- [ ] Implementar domain/robot/bluetooth.ts: parseBluetoothLine, bluetoothRunFrame,
  bluetoothProgramProblem; reutilizar validateSequence y toRobotText.
- [ ] Crear firmware/robolab_bluetooth/{Protocol.h,Motion.h,Config.h,VidaRobot.h,
  robolab_bluetooth.ino}; adaptar el controlador y efectos del usuario sin wifi.
- [ ] Integrar scripts/test-firmware.mjs en verify y documentar instalación,
  emparejamiento, protocolo y límites del montaje en docs/robot-bluetooth.md.
- [ ] Ejecutar pruebas, compilar para ESP32, verificar, commitear y abrir PR.

## Tarea 2: conexión web

- [ ] Crear pruebas fallidas para bluetoothLink.ts usando streams y para la hoja RobotSend.
- [ ] Implementar bluetoothLink.ts: selector, handshake, framing, latidos,
  correlación por id, STOP, desconexión y liberación de locks.
- [ ] Conservar useWifiRobotLink.ts y extender useRobotLink.ts para elegir
  transporte y exponer la misma conexión a ejecución automática y manual.
- [ ] Actualizar RobotSend.tsx: Bluetooth inicial, wifi alternativo, pasos de
  emparejamiento, compatibilidad, capacidades reales y botón Parar.
- [ ] Fijar dependencia backend al commit del PR por git+https.
- [ ] Ejecutar pruebas, verify, revisión independiente y prueba visual local;
  publicar el PR y dejar la vista previa HTTP levantada.
