# Generación local en Jetson — plan de implementación

**Objetivo:** ofrecer Qwen 2.5 3B Instruct en la Jetson Orin Nano 8 GB como alternativa a los proveedores cloud existentes.
**Arquitectura:** Ollama escucha solo en loopback de la Jetson. Un túnel SSH sobre USB lo conecta al acompañante HTTP de la laptop, también en loopback. El acompañante reutiliza el orquestador y validadores del backend; Convex vuelve a autorizar y validar las propuestas antes de mostrarlas y al guardarlas. La generación cloud conserva su contrato.
**Tecnología:** Ollama ARM64, modelo qwen2.5:3b-instruct-q4_K_M, TypeScript/Node, Convex, React.
**Alcance autorizado:** instalación por SSH, integración y PRs; no sustituir servicios Mimix, reflashear ni fusionar PRs nuevos.

## Restricciones
- No exponer Ollama en LAN; puerto HTTP local 127.0.0.1, Host y Origin permitidos explícitamente, JSON y tamaño acotado.
- Sin secretos ni datos de alumnos; sin claves cloud en navegador.
- Inferencia local; guardar/asignar y sesión siguen usando Convex e internet.
- Mantener proveedores cloud y API existentes; agregar reviewLocal con autenticación.
- Separar worktrees y pasar npm run verify antes de cada commit.

## Tareas
- [ ] Instalar Ollama como servicio y descargar modelo; comprobar GPU e inferencia JSON real.
- [ ] Pruebas primero para adaptador Ollama: formato estructurado, errores, límites, cancelación y reparación.
- [ ] Acompañante local: pruebas HTTP reales de orígenes/Host/JSON/límites/concurrencia, reutilizando generación y tiempos locales.
- [ ] Acción Convex reviewLocal: pruebas de autenticación, misiones imposibles/malformadas, grados y cálculo autorizado de métricas; guardar sigue validando.
- [ ] Selector nube/Jetson e instrucciones cortas; cliente HTTP con tiempo acotado y pruebas de generación local→revisión→guardado sin llamar al proveedor cloud.
- [ ] Instalar túnel/acompañante en laptop; prueba real de modelo→HTTP USB→Convex→misión resoluble.
- [ ] Verificación completa, revisión, documentación operativa, commits y dos PRs enlazados.

## Focos de revisión
- Arranque frío del modelo y duración mayor que cloud.
- Cable desconectado y respuesta cancelada; no solicitudes ilimitadas en GPU de 8 GB.
- Orígenes de previews Vercel requieren permiso explícito; Chrome puede pedir acceso a red local.
- Una respuesta JSON puede ser insoluble: nunca ofrecer plantilla como si fuera IA.
- Convex no puede acceder a IP USB de la laptop/Jetson; nunca configurarlo como endpoint cloud.
