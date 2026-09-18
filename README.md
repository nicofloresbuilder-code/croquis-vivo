# Croquis Vivo

**En vivo: https://croquis-vivo.vercel.app**

Simulador de evacuacion sobre el croquis de tu propio inmueble. Dibujas el plano, activas la alarma, y el sistema detecta los errores que un simulacro de asistencia nunca registra: quien no escucho la alerta y por que, que estorbo bloquea la ruta y cuanto recorrido extra cuesta, y donde se hace la fila.

**AI 2041 - Semana 6 - Capitulo 5 "My Haunting Idol" - Rol MONEY - Vacio: compliance-upgrade.**

## Que hace

- **Croquis editable**: muros, puertas con abatimiento, ventanas, salidas, escaleras de emergencia, mobiliario, estorbos, altavoces, maquinas ruidosas y personas. Tres sitios de ejemplo (hospital, escuela primaria, casa) o uno en blanco. Se puede calcar la foto de un croquis real.
- **Simulacro por agentes**: cada persona solo arranca si la alerta es audible donde esta; si no la oye, puede salir tarde porque un companero le avisa. Camina por un campo de flujo hacia la salida o escalera mas cercana, rodea muros y mobiliario y pierde velocidad al aglomerarse.
- **Acustica**: perdida por distancia y por cada barrera cruzada (muro, puerta cerrada y ventana pierden distinto). Audible cuando supera el ruido de fondo por 15 dB, criterio NFPA 72.
- **Hallazgos con evidencia**: numerados como notas de plano, con severidad y cifras en dB, metros y segundos.
- **Corregir y volver a simular**: aplicas una correccion y el mismo escenario se recalcula con la misma semilla para comparar antes y despues.

## Como correrlo

```bash
npm install
npm run dev
```

Ya esta conectado GitHub con Vercel: cada `git push` a `main` dispara un deploy automatico.

## Estructura

| Archivo | Que contiene |
|---|---|
| `src/lib/engine.ts` | Acustica, campo de flujo, agentes y analisis contrafactual. Sin DOM. |
| `src/lib/sites.ts` | Croquis de ejemplo. |
| `src/components/CroquisVivo.tsx` | Canvas, edicion, panel de hallazgos y reporte. |
| `docs/PACKET.md` | Packet del ship: problema, usuario, exito, diagramas, benchmark, scope cut, stack y plan de pruebas. |
| `docs/PERSONA.md` | Persona test con una directora de primaria y los arreglos que salieron de ahi. |
| `DECISIONS.md` | Decisiones de diseno y bugs encontrados. |

## Limites

Simulacion por agentes en 2D, no VR inmersiva. No es una app de informacion sobre sismos: no avisa, no alerta y no dice que hacer durante un temblor. **No constituye certificacion legal** y no sustituye la validacion de la autoridad de Proteccion Civil. Todo el personal, las escuelas y los hospitales del demo son inventados; no se captura ni se envia dato personal de nadie.
