# Generador semiautomatico de horarios

Aplicacion web sin dependencias de servidor para preparar grupos, asignar
profesores, programar sesiones y distribuir aulas. El creador historico de
miniaturas de ajedrez se conserva en `chessPosition.html`, pero la entrada
principal del proyecto es `index.html`.

## Flujo recomendado

1. Importa el JSON de trabajo o carga una plantilla.
2. Crea los grupos antes de programar horarios.
3. Para un grupo regular, selecciona grado, turno y plan de materias.
4. Para un grupo optativo, selecciona una o dos materias y configura en cada
   una su profesor y su franja permitida.
5. Programa manualmente o usa la autoprogramacion.
6. Ejecuta la autoasignacion de aulas para completar solamente las sesiones
   que aun no tengan aula.
7. Exporta el JSON actualizado como respaldo.

Los grupos optativos se comportan como grupos normales, pero sus materias solo
pueden colocarse dentro de la franja configurada. El turno determina los
profesores compatibles y las franjas que pueden atender: matutino 08:00-16:00
y vespertino 12:00-20:00.

## Compatibilidad de archivos

- Los JSON v4 se importan sin modificar grupos, sesiones, bloqueos, profesores
  ni aulas existentes.
- Los grupos de archivos v4 se consideran de tipo `regular`.
- Al exportar, la aplicacion usa la version 5 y agrega de forma compatible los
  campos `tipo` y `franjasOptativasPorAsignatura`.
- La carga tolera archivos UTF-8 que incluyan BOM.

Antes de usar una plantilla o ejecutar una reasignacion masiva, conserva una
copia del JSON de trabajo.

## Verificacion

Ejecuta las regresiones con:

```powershell
node tests/regression.test.js
```

Si existe `prueba_semestre_A_nuevo.json 3.json` en la raiz, la prueba lo usa
como caso real; de lo contrario comprueba la plantilla de Semestre A.
