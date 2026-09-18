# Croquis Vivo

Simulador de evacuación sobre el croquis de tu propio inmueble. Dibujas el plano, activas la alarma, y el sistema detecta los errores que un simulacro de asistencia nunca registra: quién no escuchó la alerta y por qué, qué estorbo bloquea la ruta y cuánto recorrido extra cuesta, y dónde se hace la fila.

**AI 2041 · Semana 6 · Capítulo 5 "My Haunting Idol" · Rol MONEY · Vacío: compliance-upgrade.**

## Qué hace

- **Croquis editable**: muros, puertas con abatimiento, ventanas, salidas, escaleras de emergencia, mobiliario, estorbos, altavoces, máquinas ruidosas y personas. Tres sitios de ejemplo (hospital, escuela primaria, casa) o uno en blanco. Se puede calcar la foto de un croquis real.
- **Simulacro por agentes**: cada persona sólo arranca si la alerta es audible donde está; si no la oye, puede salir tarde porque un compañero le avisa. Camina por un campo de flujo hacia la salida o escalera más cercana, rodea muros y mobiliario y pierde velocidad al aglomerarse.
- **Acústica**: pérdida por distancia y por cada barrera cruzada (muro, puerta cerrada y ventana pierden distinto). Audible cuando supera el ruido de fondo por 15 dB, criterio NFPA 72.
- **Hallazgos con evidencia**: numerados como notas de plano, con severidad y cifras en dB, metros y segundos.
- **Corregir y volver a simular**: aplicas una corrección y el mismo escenario se recalcula con la misma semilla para comparar antes y después.

## Cómo correrlo

```bash
npm install
npm run dev
```

## Estructura

| Archivo | Qué contiene |
|---|---|
| `src/lib/engine.ts` | Acústica, campo de flujo, agentes y análisis contrafactual. Sin DOM. |
| `src/lib/sites.ts` | Croquis de ejemplo. |
| `src/components/CroquisVivo.tsx` | Canvas, edición, panel de hallazgos y reporte. |
| `docs/PACKET.md` | Packet del ship: problema, usuario, éxito, diagramas, benchmark, scope cut, stack y plan de pruebas. |
| `DECISIONS.md` | Decisiones de diseño y bugs encontrados. |

## Límites

Simulación por agentes en 2D, no VR inmersiva. No es una app de información sobre sismos: no avisa, no alerta y no dice qué hacer durante un temblor. **No constituye certificación legal** y no sustituye la validación de la autoridad de Protección Civil. Todo el personal, las escuelas y los hospitales del demo son inventados; no se captura ni se envía dato personal de nadie.
