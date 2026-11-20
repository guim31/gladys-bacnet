# BACnet/IP

Lee y escribe los objetos de un equipo BACnet/IP: climatizadoras, bombas de
calor y enfriadoras, reguladores de sala o de sala de calderas, contadores,
pasarelas BACnet (Siemens Desigo, Daikin, Flexit, Distech, Honeywell...). Cada
objeto declarado se convierte en una función de un dispositivo de Gladys.

**Desarrollada sin equipos de edificio reales**: probada contra el servidor de
demostración de bacnet-stack. Sus comentarios son bienvenidos, en el foro o en
las issues del repositorio.

## Lo que obtiene

- Un dispositivo de Gladys por equipo BACnet, una función por objeto declarado:
  los objetos analógicos como números con su unidad (temperatura, humedad,
  presión, CO2, potencia, energía en kWh...), los objetos binarios como
  encendido/apagado, los objetos multiestado como número de estado o como texto
  del estado («Confort», «Noche»).
- Los valores leídos al intervalo elegido, solo los cambios enviados a Gladys.
- La escritura, desactivada por defecto: encendido/apagado y consignas de
  temperatura desde el panel, «Escribir un valor» y «Liberar una prioridad»
  para cualquier objeto declarado, con la prioridad BACnet elegida.
- Disparadores de escena cuando el equipo se pierde o vuelve, y cuando un
  objeto pasa a alarma o a fallo.
- Un widget de panel con los primeros valores y el estado del enlace.

Frente a la integración Flexit (`LM1LC3N7/gladys-flexit`), hecha para las
unidades de ventilación Flexit con sus objetos ya asignados, esta habla con
cualquier equipo BACnet/IP: usted elige los objetos.

## Requisitos

- Gladys Assistant 5.1 o posterior.
- Un equipo que hable BACnet/IP (UDP, puerto 47808 por defecto) con una
  dirección IP fija, accesible desde el servidor Gladys. Los equipos BACnet
  MS/TP (RS-485) necesitan un router o una pasarela BACnet/IP.
- Su instancia de equipo, si el equipo no la indica (la mayoría lo hace).

## Configuración

Integraciones → BACnet/IP → Configuración. Guarde tras cada paso: el estado en
la parte superior de la pantalla indica si el equipo responde.

### Equipo

- **Dirección IP**: la dirección del equipo o de su pasarela BACnet/IP. Un
  puerto distinto de 47808 puede seguirla (`192.168.1.50:47809`) o ir en
  **Puerto UDP**.
- **Instancia del equipo**: déjela vacía, la integración la lee en el equipo
  (instancia comodín 4194303). Introdúzcala cuando el equipo no responda a esa
  petición, o detrás de una pasarela que sirve varios equipos.

La integración solo envía sus peticiones a esta dirección (unicast): Gladys la
ejecuta en una red en puente, desde la que un Who-Is en broadcast no alcanza la
red del edificio. No hay descubrimiento automático.

### Objetos

Pulse **Listar los objetos**: se lee la lista de objetos del equipo y se dan
los objetos analógicos, binarios y multiestado con su nombre, listos para
copiar. Rellene luego **Objetos**, entradas separadas por punto y coma:

```
Nombre: tipo:instancia [tipo de valor] [write] [opciones]
```

```
Impulsión: ai:1; Retorno: ai:2; Ventilador: bo:1 switch; Modo: msv:1 text
```

- **Nombre** (opcional, seguido de dos puntos y un espacio): el nombre de la
  función. Sin él, se usa el objectName del equipo.
- **tipo:instancia**: `analog-input:1` o `ai:1`, `analog-output` (`ao`),
  `analog-value` (`av`), `binary-input` (`bi`), `binary-output` (`bo`),
  `binary-value` (`bv`), `multi-state-input` (`msi`), `multi-state-output`
  (`mso`), `multi-state-value` (`msv`). `AI1` y `OBJECT_ANALOG_INPUT:1`
  también funcionan.
- **tipo de valor** (opcional): por defecto sigue las unidades BACnet del objeto
  (°C → temperature, %HR → humidity, Pa → pressure, kWh → energy...). Tipos:
  `temperature`, `humidity`, `pressure`, `co2`, `illuminance`, `power`,
  `energy`, `voltage`, `current`, `volume`, `duration`, `value` (cualquier
  número), `setpoint` (temperatura modificable), `binary`, `switch`
  (encendido/apagado modificable), `state` (número del estado), `text` (texto
  del estado).
- **write**: el objeto puede escribirse (solo salidas y valores: una entrada
  BACnet no se escribe).
- **Opciones**: `unit=` (°C, %, Pa, kPa, bar, ppm, W, kW, Wh, kWh, V, A, L, m3,
  s, min, h...), `scale=` y `offset=` (valor × scale + offset), `min=` y `max=`
  (límites de una escritura y del indicador), `precision=` (decimales).

Hasta 100 objetos. **Comprobar la configuración** enumera los errores entrada
por entrada. Añada luego el equipo desde la pestaña **Descubrimiento**.

### Intervalo de lectura

Cada 10 s, 30 s (por defecto), 1 min o 5 min, con una petición
ReadPropertyMultiple por cada 8 objetos; un equipo sin ese servicio se lee
propiedad por propiedad. Gladys acepta 300 valores por minuto: con muchos
objetos, el intervalo se alarga (100 objetos: cada 25 s como mínimo).

### Escritura

Active **Permitir la escritura** y declare `write` los objetos que Gladys puede
modificar. Escribir un objeto equivocado puede detener o dañar una instalación:
declare solo lo que Gladys deba modificar, y compruébelo con el instalador.

BACnet controla salidas y valores mediante 16 prioridades: 1 es la más alta
(seguridad de las personas), 16 la más baja. Gana el valor de mayor prioridad;
un valor escrito con una prioridad permanece hasta que se libera. **Prioridad
de escritura** vale 8 (operador manual) por defecto; evite 1 a 5. Liberar una
prioridad (escribir `null`) devuelve el control a la prioridad siguiente, o al
valor por defecto del objeto. Un objeto sin tabla de prioridades (muchos
valores analógicos y binarios) toma el valor directamente y no tiene nada que
liberar.

Desde el panel, solo los objetos `switch` y `setpoint` son controles (una
entrada de encendido/apagado y una temperatura objetivo, nunca un interruptor o
un termostato controlable por voz). Cualquier otro objeto declarado se escribe
con las acciones. Una consigna sin `min=` ni `max=` se mantiene entre 0 y 100 °C (32 y 212 °F).

## Acciones

- **Listar los objetos**: hasta 60 objetos utilizables con su nombre.
- **Comprobar la configuración**: si el equipo responde, y los errores.
- **Escribir un valor**: un objeto (su nombre o `av:3`), un valor (un número,
  0 / 1 u on / off, un número de estado o su texto), una prioridad opcional.
- **Liberar una prioridad**: un objeto y una prioridad opcional.

## Escenas

- Disparadores: **Se pierde el equipo BACnet** (con el error), **El equipo
  BACnet ha vuelto**, **Un objeto BACnet pasa a alarma** (statusFlags en alarma
  o en fallo, una vez hasta que desaparece; el nombre del objeto y el indicador
  son variables).
- Acciones: **Escribir un objeto BACnet** y **Liberar una prioridad BACnet**,
  los mismos campos que los botones. Un rechazo hace fallar la acción, no la
  escena.
- Cada función también funciona con los disparadores habituales de los
  dispositivos de Gladys (una temperatura por encima de un umbral, un
  ventilador que se detiene).

## Panel

El widget **Equipo BACnet** muestra los seis primeros valores del equipo y un
bloque de estado: si el equipo responde, los objetos en alarma o en fallo, la
hora del último valor. El bloque de estado puede ocultarse en los ajustes del
widget.

## Límites

- Sin descubrimiento Who-Is, sin suscripción COV: los valores se leen
  periódicamente.
- Un equipo BACnet por instalación de la integración.
- Solo objetos analógicos, binarios y multiestado; ni horarios, ni históricos,
  ni calendarios, ni reconocimiento de alarmas.
- Ni BBMD ni registro como «foreign device»: el equipo debe ser accesible en
  unicast desde el servidor Gladys.
- La integración escucha el puerto UDP 47808 en su contenedor. Un equipo que
  responde al puerto 47808 del emisor en lugar del puerto de origen de la
  petición puede no atravesar la traducción de direcciones de Docker.

## Solución de problemas

- «No responde»: compruebe la dirección y el puerto, que BACnet/IP esté
  activado en el equipo, y que ningún cortafuegos bloquee el UDP 47808 entre
  Gladys y el equipo.
- «No tiene esta instancia»: vacíe **Instancia del equipo**, o introduzca la
  que indica la herramienta del instalador.
- Un objeto «no existe»: compare con **Listar los objetos**.
- «El equipo rechazó la escritura (write-access-denied)»: el objeto es de solo
  lectura, está fuera de servicio, o el equipo pide una contraseña.
- Todo el detalle con la variable `LOG_LEVEL=debug` en los registros de la
  integración.

## Créditos

- [@bacnet-js/client](https://github.com/bacnet-js/client) (MIT), la pila
  BACnet en JavaScript mantenida por Innovation-System, fork de `node-bacstack`
  de Fabio Huser.
- [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) de Steve Karg,
  cuyo servidor de demostración sirvió para las pruebas.
- BACnet® es una marca registrada de ASHRAE. Esta integración no está afiliada
  ni a ASHRAE ni a ningún fabricante de equipos.
