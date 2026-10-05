# Generador semiautomático de horarios escolares

Aplicación web local para preparar, completar y revisar horarios escolares. Permite administrar grupos, profesores, academias y aulas; crear sesiones manualmente; y usar asistentes automáticos que respetan turnos, bloqueos, cargas, laboratorios y franjas de optativas.

El proyecto funciona únicamente en el navegador y no requiere servidor, compilación ni dependencias de npm. Los datos permanecen en el equipo y se intercambian mediante archivos JSON.

## Funciones principales

- Creación, edición, duplicado y eliminación de grupos regulares u optativos, con confirmación.
- Deshacer y Rehacer para cambios aplicados, incluidos los llenados automáticos completos.
- Recuperación local automática y revisión de pendientes/conflictos antes de exportar.
- Plan de materias, estructura semanal y profesor por asignatura.
- Asignación automática de profesores con balance de carga y compatibilidad de turno.
- Programación manual por bloques y autoprogramación de un grupo o de todos los grupos.
- Variantes de duración para distribuir los segmentos semanales de una asignatura.
- Restricciones por grupo, profesor, academia y aula, además de sesiones fijadas con `LOCK` y acciones para bloquear o desbloquear todo un grupo.
- Tratamiento separado de clases, laboratorios y horas de estudio.
- Autoasignación de aulas sin reemplazar las aulas que ya fueron elegidas.
- Vistas de horarios por grupo, profesor, aula y academia.
- Exportación de horarios por grupo o profesor en HTML y del concentrado de Escolares en TXT.
- Planeador estudiantil para combinar materias y ordenar alternativas según preferencias.
- Editor de la copia de trabajo para horarios por turno, franjas optativas, reglas fijas, modalidad de grupos y variantes semanales.
- Variantes de ciencias con laboratorio, estudio, clases de 90 minutos y clases extendidas de 120 minutos.
- Autoasignación de aulas con mapa mayoritario configurable por grupo y preferencias de respaldo para recursamiento.
- Catálogo flexible de variantes por asignatura: clases de 60, 90, 120 o 150 minutos, estudio separado y distribuciones personalizadas.

## Inicio rápido

No hay dependencias que instalar. Abre una de estas entradas en un navegador moderno:

- `index.html`: administración y generación general de horarios.
- `estudiante.html`: planeador de horario para estudiantes.

También puedes servir la carpeta con cualquier servidor estático. Por ejemplo, si tienes Python instalado:

```powershell
python -m http.server 8000
```

Después visita `http://localhost:8000/`.

## Flujo recomendado

1. Abre `index.html` y carga la plantilla fija del semestre impar o par, o importa un JSON de trabajo anterior.
2. Usa **Editar JSON de trabajo** para ajustar horarios por turno, franjas optativas, reglas fijas, la regla automática de estructura/recursamiento y las variantes semanales sin modificar la plantilla incluida.
3. Revisa academias, profesores y aulas.
4. Crea o ajusta los grupos y su plan de materias.
5. En los grupos optativos, asigna las materias, el profesor y una o más franjas permitidas.
6. Autoasigna profesores o corrige sus asignaciones manualmente.
7. Programa sesiones desde la cuadrícula, autoprograma el grupo seleccionado o procesa todos los grupos.
8. Usa `LOCK` en los bloques que no deban moverse durante una reoptimización.
9. Autoasigna las aulas faltantes y revisa los horarios desde las distintas vistas.
10. Usa **Revisar horario** o revisa el resumen que aparece al exportar; corrige los problemas o exporta con pendientes para guardar un respaldo.
11. Exporta el JSON actualizado y genera los reportes necesarios.

Antes de cargar una plantilla o ejecutar una reasignación masiva, conserva una copia del JSON de trabajo.

## Protección y recuperación del trabajo

**Eliminar grupo**, en el editor del grupo seleccionado, borra el grupo, sus sesiones (también las que tienen `LOCK`), sus bloqueos y sus vínculos con profesores. No elimina profesores, asignaturas ni aulas; conserva las reglas y preferencias reutilizables de la plantilla. La confirmación muestra cuántos segmentos y segmentos con `LOCK` se quitarán.

**Deshacer** y **Rehacer** conservan las últimas 20 acciones aplicadas durante la sesión: grupos, planes, variantes, profesores, franjas, configuración, sesiones, bloqueos y automatizaciones. Cada llenado automático completo cuenta como una acción, aunque mueva sesiones de varios grupos. También se puede deshacer una importación o la carga de otra plantilla. Los atajos son `Ctrl+Z`, `Ctrl+Y` y `Ctrl+Shift+Z`; dentro de campos de texto se conserva la edición normal del navegador. Restaurar no vuelve a autoasignar profesores ni recrea bloqueos que se quitaron manualmente.

Los cambios **aplicados** se respaldan automáticamente en `localStorage`, bajo la clave `generador-horarios:workspace:v1`. Al volver a abrir la página, se ofrece **Restaurar copia**; **Ahora no** permite posponerla sin borrarla. Cargar o modificar otra copia de trabajo sustituye ese respaldo. El historial de Deshacer no se conserva al recargar. Los borradores sin guardar y los campos todavía no aplicados no forman parte del respaldo.

La recuperación pertenece al navegador y origen utilizados (por ejemplo, GitHub Pages y localhost tienen copias distintas). No se sincroniza entre equipos, no escribe en GitHub ni modifica el JSON importado. Las pestañas del mismo navegador/origen comparten el respaldo más reciente: evita editar dos copias a la vez en ellas. Si el almacenamiento no está disponible o se llena, se muestra un aviso y se puede seguir trabajando/exportando. Borrar los datos del navegador o usar navegación privada puede perder la recuperación; exporta siempre un JSON independiente. Se avisa al cerrar con cambios no exportados.

**Revisar horario** reúne materias incompletas, exceso o estructura incorrecta según la variante efectiva, profesores pendientes/incompatibles, aulas pendientes, sesiones fuera de horario/franja, referencias inexistentes, bloqueos y sesiones simultáneas de grupo, profesor o aula. La revisión no modifica los datos y permite ir directamente al grupo afectado. También aparece antes de exportar JSON, HTML o TXT; no impide exportar un horario parcial como respaldo.

## Reglas relevantes

- La configuración actual trabaja con segmentos de 30 minutos entre las 08:00 y las 20:00.
- Los grupos matutinos ocupan normalmente la franja 08:00–14:00 y los vespertinos la franja 14:00–20:00.
- Los profesores matutinos pueden atender de 08:00 a 16:00 y los vespertinos de 12:00 a 20:00.
- Un profesor de turno distinto es válido por defecto cuando su horario laboral se cruza con el del grupo: normalmente 12:00–14:00 para un profesor vespertino en un grupo matutino y 14:00–16:00 en el caso inverso.
- La asignación automática prefiere profesores del mismo turno; la asignación manual muestra también los cruces válidos y su intervalo disponible.
- Cada profesor puede tener un `horarioLaboral` excepcional que sustituye la ventana normal de su turno.
- Una sesión se rechaza si genera conflicto de grupo, profesor o aula, invade un bloqueo o incumple la franja de una optativa.
- Las materias que requieren laboratorio distinguen sus bloques de laboratorio de las clases regulares.
- La autoasignación de aulas completa únicamente las sesiones que todavía no tienen aula.
- Si un grupo no declara `modalidad`, se clasifica automáticamente: en periodo impar los grados 1, 3 y 5 son de estructura; en periodo par lo son los grados 2, 4 y 6. El editor del grupo permite elegir explícitamente `estructura` o `recursamiento` cuando exista una excepción.

Las reglas y los intervalos efectivos provienen del objeto `config` y de las colecciones `reglasFijas` y `franjasOptativas` del JSON cargado. Dentro de `config` se pueden ajustar `aulasPorGrupo` para cambiar el aula principal de un grupo y `preferenciaAulasRecursamiento` para definir el orden de respaldo por periodo y turno.

Las asignaturas exponen variantes semanales completas mediante `weeklyBlockVariants`. También se generan opciones comunes automáticamente, incluyendo quitar o agregar el estudio y distribuir la carga en sesiones de 60, 90, 120 o 150 minutos. Las materias de ciencias conservan sus cuatro estructuras iniciales con laboratorio. Las preferencias suaves se pueden declarar en `variantPreferences` por periodo o modalidad; la elección manual del grupo siempre tiene prioridad.

Ejemplo de una variante personalizada:

```json
{
  "matematicas_i": {
    "variants": [
      {
        "key": "cuatro_clases_60",
        "label": "4 clases de 60 minutos",
        "blocks": [
          { "kind": "clase", "duration": 2 },
          { "kind": "clase", "duration": 2 },
          { "kind": "clase", "duration": 2 },
          { "kind": "clase", "duration": 2 }
        ]
      }
    ],
    "preferences": {
      "byModality": { "recursamiento": "cuatro_clases_60" }
    }
  }
}
```

La modalidad automática se puede ajustar en `config.reglaModalidad`; una modalidad explícita en `grupos[].modalidad` la sobrescribe.

Las plantillas incluyen cuatro franjas de optativas. La cuarta ocurre los lunes y miércoles a las 18:00, con duración de 90 minutos.

## Archivos de datos

La aplicación incluye plantillas para ambos periodos:

- `data/semestre_A.json`: semestre impar.
- `data/semestre_B.json`: semestre par.
- `data/template-bundles.js`: copia embebida de las plantillas para poder abrir la aplicación sin servidor.

Las plantillas son inmutables durante el uso de la aplicación. Al cargarlas se crea una copia en memoria: cada usuario puede editarla y descargarla como JSON sin cambiar los archivos publicados ni afectar a otras personas. **Importar JSON de trabajo** permite continuar posteriormente desde esa copia personalizada.

Al exportar, la aplicación genera el formato versión 6 e incluye el catálogo y la configuración junto con `sesiones` y `bloqueos`. La importación mantiene compatibilidad con archivos versión 4 y 5:

- conserva grupos, sesiones, bloqueos, profesores y aulas existentes;
- interpreta como regulares los grupos antiguos que no declaran un tipo;
- acepta los campos heredados que todavía tienen equivalencia en el modelo actual;
- tolera archivos UTF-8 con BOM.

El archivo `prueba_semestre_A_nuevo.json 3.json` es un caso de datos real utilizado por las regresiones. Conviene tratarlo como fixture de prueba, no como plantilla base.

## Planeador estudiantil

`estudiante.html` carga un JSON ya programado y permite elegir materias y grupos disponibles. El generador descarta choques de horario y ordena las combinaciones según:

- horas objetivo por día;
- hora mínima de entrada y máxima de salida;
- turno preferido;
- días que se desean evitar;
- peso de la carga diaria y de los huecos entre clases.

Las preferencias y el espacio de trabajo del planeador se guardan en `localStorage` del navegador.

## Estructura del proyecto

```text
core/                   Modelos, reglas, persistencia, programación y reportes
data/                   Plantillas JSON y sus versiones embebidas
tests/                  Pruebas de regresión ejecutables con Node.js
ui/                     Controladores y vistas de las dos interfaces
index.html              Aplicación principal
estudiante.html         Planeador estudiantil
styles.css              Estilos compartidos de la aplicación
student-styles.css      Estilos específicos del planeador estudiantil
chessPosition.html      Generador histórico de posiciones de ajedrez
chess_styles.css        Estilos de la herramienta histórica
script.js               Lógica de la herramienta histórica
```

Los archivos de ajedrez se conservan como herramienta heredada, pero ya no forman parte del flujo principal del generador de horarios.

## Verificación

Se necesita Node.js únicamente para ejecutar las pruebas, no para usar la aplicación:

```powershell
node tests/regression.test.js
node tests/workspace.test.js
node tests/workspace-ui.test.js
```

La prueba comprueba la migración del formato anterior, la conservación de sesiones y bloqueos, las restricciones de optativas, la selección de laboratorios y la autoasignación no destructiva de aulas. Si el fixture real no está disponible, utiliza `data/semestre_A.json`.

Las pruebas de espacio de trabajo cubren eliminación/cancelación, limpieza de referencias, Deshacer/Rehacer, recuperación exacta, fallos de almacenamiento, límites del historial y revisión sin autoconflictos ni cambios en los datos.

La prueba de interfaz carga los scripts de `index.html` en un DOM de prueba sin dependencias externas y verifica los botones, el guardado, los bloqueos, la revisión/exportación y el arranque con recuperación. No sustituye una revisión visual en un navegador real.

Para validar además la sintaxis de un archivo JavaScript concreto:

```powershell
node --check core/scheduler.js
```
