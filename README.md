# Generador semiautomático de horarios escolares

Aplicación web local para preparar, completar y revisar horarios escolares. Permite administrar grupos, profesores, academias y aulas; crear sesiones manualmente; y usar asistentes automáticos que respetan turnos, bloqueos, cargas, laboratorios y franjas de optativas.

El proyecto funciona únicamente en el navegador y no requiere servidor, compilación ni dependencias de npm. Los datos permanecen en el equipo y se intercambian mediante archivos JSON.

## Funciones principales

- Creación, edición y duplicado de grupos regulares u optativos.
- Plan de materias, estructura semanal y profesor por asignatura.
- Asignación automática de profesores con balance de carga y compatibilidad de turno.
- Programación manual por bloques y autoprogramación de un grupo o de todos los grupos.
- Variantes de duración para distribuir los segmentos semanales de una asignatura.
- Restricciones por grupo, profesor, academia y aula, además de sesiones fijadas con `LOCK`.
- Tratamiento separado de clases, laboratorios y horas de estudio.
- Autoasignación de aulas sin reemplazar las aulas que ya fueron elegidas.
- Vistas de horarios por grupo, profesor, aula y academia.
- Exportación de horarios por grupo o profesor en HTML y del concentrado de Escolares en TXT.
- Planeador estudiantil para combinar materias y ordenar alternativas según preferencias.
- Editor de la copia de trabajo para horarios por turno, franjas optativas y reglas fijas.

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
2. Usa **Editar JSON de trabajo** para ajustar horarios por turno, franjas optativas o reglas fijas sin modificar la plantilla incluida.
3. Revisa academias, profesores y aulas.
4. Crea o ajusta los grupos y su plan de materias.
5. En los grupos optativos, asigna las materias, el profesor y una o más franjas permitidas.
6. Autoasigna profesores o corrige sus asignaciones manualmente.
7. Programa sesiones desde la cuadrícula, autoprograma el grupo seleccionado o procesa todos los grupos.
8. Usa `LOCK` en los bloques que no deban moverse durante una reoptimización.
9. Autoasigna las aulas faltantes y revisa los horarios desde las distintas vistas.
10. Exporta el JSON actualizado como respaldo y genera los reportes necesarios.

Antes de cargar una plantilla o ejecutar una reasignación masiva, conserva una copia del JSON de trabajo.

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

Las reglas y los intervalos efectivos provienen del objeto `config` y de las colecciones `reglasFijas` y `franjasOptativas` del JSON cargado.

## Archivos de datos

La aplicación incluye plantillas para ambos periodos:

- `data/semestre_A.json`: semestre impar.
- `data/semestre_B.json`: semestre par.
- `data/template-bundles.js`: copia embebida de las plantillas para poder abrir la aplicación sin servidor.

Las plantillas son inmutables durante el uso de la aplicación. Al cargarlas se crea una copia en memoria: cada usuario puede editarla y descargarla como JSON sin cambiar los archivos publicados ni afectar a otras personas. **Importar JSON de trabajo** permite continuar posteriormente desde esa copia personalizada.

Al exportar, la aplicación genera el formato versión 5 e incluye el catálogo y la configuración junto con `sesiones` y `bloqueos`. La importación mantiene compatibilidad con archivos versión 4:

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
```

La prueba comprueba la migración del formato anterior, la conservación de sesiones y bloqueos, las restricciones de optativas, la selección de laboratorios y la autoasignación no destructiva de aulas. Si el fixture real no está disponible, utiliza `data/semestre_A.json`.

Para validar además la sintaxis de un archivo JavaScript concreto:

```powershell
node --check core/scheduler.js
```
