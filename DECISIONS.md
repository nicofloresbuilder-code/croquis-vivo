# DECISIONS — Croquis Vivo

## Por qué esto y no un reporte de cumplimiento
El primer packet describía una plataforma para generar reportes de capacitación. Era defendible pero era papeleo con otro nombre: no había nada que *ensayar*. El forbidden zone de la semana prohíbe construir información y pide ensayo medido, así que el producto se movió a lo que sí es un ensayo: el croquis del inmueble con gente moviéndose dentro, del que salen errores concretos.

## Por qué simulación por agentes y no un modelo de lenguaje
El Dragon Stack pide lógica adaptativa. Lo honesto aquí no es un LLM: es un motor determinista con análisis contrafactual. El sistema no *opina* que el estorbo estorba, vuelve a calcular las rutas sin él y mide la diferencia en metros. Se dice explícitamente en el pie de la página, porque la honestidad técnica se califica.

## Por qué el mobiliario no es un hallazgo y el estorbo sí
Ambos bloquean el paso igual. La diferencia es que la cama de un cuarto de hospital debe estar ahí y las camillas apiladas en el pasillo no. Sin esa distinción, el sistema reportaría cada mueble como una falla y el reporte sería ruido.

## Por qué el criterio de audibilidad es +15 dB
Es el de la NFPA 72: la señal de alerta debe superar el ruido de fondo promedio por 15 dB. Tener un criterio citable es lo que convierte "no se oye bien" en un hallazgo defendible ante una autoridad.

## Por qué se re-simula con la misma semilla
Si la corrección se midiera contra un simulacro con otra aleatoriedad, la comparación no valdría nada. Misma semilla, misma gente, mismos tiempos de reacción: lo único que cambia es la corrección.

## Bugs reales encontrados y corregidos
1. **El conteo de muros inflaba la pérdida de sonido.** La línea entre altavoz y celda contaba cada celda de muro que tocaba, así que una trayectoria casi paralela a una pared contaba seis muros y perdía 60 dB. Se cambió a contar *cruces* de barrera: un muro contiguo vale una vez. Antes del arreglo, media planta del hospital aparecía como "no se escucha la alarma".
2. **`Float32Array` rompía Dijkstra.** El campo de flujo guardaba distancias en `Float32Array`; al sacar un nodo del heap, el valor redondeado quedaba por debajo del que se había insertado y la comparación `d > dist[c]` lo descartaba. El resultado: la propagación no salía de los pasillos y 23 de 28 personas quedaban sin ruta. Se cambió a `Float64Array`.
3. **El estorbo no producía ningún hallazgo** porque dejaba libre suficiente pasillo como para que el desvío fuera despreciable. Se reposicionó para que cierre de verdad el paso oriente, que es el caso que el producto debe detectar.

## Próximo movimiento
Persona test con una directora de primaria y grabación del video de demostración.
