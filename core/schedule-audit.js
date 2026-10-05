/** Read-only review of the effective weekly variants and the complete timetable. */
const ScheduleAudit = {
  inspect(app) {
    // Requirement resolution can normalize old variant keys. Work on a detached
    // copy so opening a review never changes the schedule or teacher assignments.
    const state = Persistence.hydrateState(
      JSON.parse(JSON.stringify(Persistence.buildExportData(app))), { exact: true },
    );
    const checked = { ...app, data: state.data, horario: state.horario };
    const { data, horario } = checked;
    const groups = new Map(data.grupos.map((item) => [item.id, item]));
    const subjects = new Map(data.asignaturas.map((item) => [item.id, item]));
    const teachers = new Map(data.profesores.map((item) => [item.id, item]));
    const rooms = new Map(data.aulas.map((item) => [item.id, item]));
    const issues = new Map();
    const add = (severity, code, message, details = {}) => {
      const key = JSON.stringify([code, details.grupoId, details.asignaturaId, details.resourceId]);
      if (issues.has(key)) {
        issues.get(key).count += 1;
      } else {
        issues.set(key, { severity, code, message, ...details, count: 1 });
      }
    };
    ["grupos", "asignaturas", "profesores", "aulas", "academias"].forEach((collection) => {
      const seen = new Set();
      data[collection].forEach((entity) => {
        if (seen.has(entity.id)) add("error", `duplicate_${collection}`, `Hay identificadores duplicados en ${collection}: ${entity.id}.`, { resourceId: entity.id });
        seen.add(entity.id);
      });
    });
    if (!groups.size) add("warning", "no_groups", "La copia de trabajo no tiene grupos.");
    let incompleteSubjects = 0;
    data.grupos.forEach((grupo) => {
      const plan = GroupService.getPlanAsignaturaIds(grupo);
      if (!plan.length) add("warning", "empty_plan", `El grupo ${grupo.nombre} no tiene materias.`, { grupoId: grupo.id });
      const usedSlots = new Set();
      plan.forEach((subjectId) => {
        const details = { grupoId: grupo.id, asignaturaId: subjectId };
        const subject = subjects.get(subjectId);
        if (!subject) {
          add("error", "missing_plan_subject", `El grupo ${grupo.nombre} incluye una materia inexistente: ${subjectId}.`, details);
          return;
        }
        const label = `${grupo.nombre} · ${subject.nombre}`;
        const status = GroupService.getRequirementStatus(checked, grupo, subject);
        if (status.pendingSegments > 0) {
          incompleteSubjects += 1;
          add("warning", "pending_subject", `${label}: faltan ${status.pendingSegments} segmentos de 30 min (${status.variantLabel}).`, details);
        }
        if (status.extraSegments > 0) {
          add("error", "extra_subject", `${label}: hay ${status.extraSegments} segmentos extra o bloques que no corresponden a la variante ${status.variantLabel}.`, details);
        }
        const teacherId = GroupService.getAssignedProfesorId(grupo, subjectId);
        if (!teacherId) {
          add("warning", "unassigned_teacher", `${label}: no tiene profesor asignado.`, details);
        } else {
          const teacher = teachers.get(teacherId);
          if (!teacher || teacher.activo === false || teacher.academiaId !== subject.academiaId ||
            !Number.isFinite(Rules.getProfessorTurnAffinity(data, teacher, grupo))) {
            add("error", "invalid_assigned_teacher", `${label}: el profesor asignado no existe, está inactivo o no es compatible con la materia/horario.`, details);
          }
        }
        if (grupo.tipo === "optativa") {
          const selected = Rules.getOptativeSlotIds(grupo, subjectId);
          const available = new Set(GroupService.getAvailableOptativeSlots(checked, grupo).map((slot) => slot.id));
          if (!selected.length || selected.some((id) => !available.has(id))) {
            add("warning", "invalid_optative_slot", `${label}: falta una franja optativa válida.`, details);
          }
          selected.forEach((id) => {
            if (usedSlots.has(id)) add("error", "repeated_optative_slot", `El grupo ${grupo.nombre} usa la misma franja en varias materias.`, { grupoId: grupo.id });
            usedSlots.add(id);
          });
        }
      });
    });

    const occupied = { grupoId: new Map(), profesorId: new Map(), aulaId: new Map() };
    horario.sesiones.forEach((session) => {
      const grupo = groups.get(session.grupoId);
      const subject = subjects.get(session.asignaturaId);
      const teacher = teachers.get(session.profesorId);
      const room = rooms.get(session.aulaId);
      const details = { grupoId: session.grupoId, asignaturaId: session.asignaturaId, dia: session.dia, hora: session.hora };
      const label = `${grupo?.nombre || session.grupoId} · ${subject?.nombre || session.asignaturaId}`;
      if (!grupo || !subject) add("error", "orphan_session", `${label}: hay sesiones de un grupo o una materia inexistente.`, details);
      if (grupo && !GroupService.getPlanAsignaturaIds(grupo).includes(session.asignaturaId)) {
        add("error", "session_outside_plan", `${label}: la sesión no pertenece al plan del grupo.`, details);
      }
      const start = app.hours[session.hora];
      const end = app.hours[session.hora + 1];
      if (!Number.isInteger(session.dia) || session.dia < 0 || session.dia >= 5 ||
        !Number.isInteger(session.hora) || !start || !end) {
        add("error", "invalid_slot", `${label}: tiene días u horas fuera de la cuadrícula.`, details);
      } else {
        const groupWindow = grupo?.tipo === "optativa"
          ? Rules.getConfiguredTimeWindow(data, "profesor", grupo.turno)
          : Rules.getGroupTimeWindow(data, grupo);
        if (grupo && (!Rules.isHourWithinWindow(start, groupWindow) || end > groupWindow.fin)) {
          add("error", "outside_group_window", `${label}: hay sesiones fuera del horario del grupo.`, details);
        }
        if (teacher) {
          const window = Rules.getProfessorTimeWindow(data, teacher);
          if (!Rules.isHourWithinWindow(start, window) || end > window.fin || !teacher.isAvailable(session.dia, session.hora)) {
            add("error", "unavailable_teacher", `${label}: hay sesiones fuera del horario laboral o de la disponibilidad de ${teacher.nombre}.`, details);
          }
        }
        const optativeCheck = Rules.validateOptativeWindow(data, grupo, session.asignaturaId, session.dia, [session.hora], app.hours);
        if (!optativeCheck.valid) add("error", "outside_optative_slot", `${label}: ${optativeCheck.error}`, details);
      }
      if (!teacher) {
        add(session.profesorId ? "error" : "warning", "missing_session_teacher", `${label}: hay sesiones sin profesor válido.`, details);
      } else if (subject && teacher.academiaId !== subject.academiaId) {
        add("error", "teacher_academy", `${label}: ${teacher.nombre} no pertenece a la academia de esta materia.`, details);
      }
      const assignedTeacher = grupo && GroupService.getAssignedProfesorId(grupo, session.asignaturaId);
      if (assignedTeacher && session.profesorId !== assignedTeacher) {
        add("error", "teacher_mismatch", `${label}: el profesor de las sesiones difiere del asignado en el plan.`, details);
      }
      if (!room) {
        add(session.aulaId ? "error" : "warning", "missing_room", `${label}: hay sesiones sin aula válida.`, details);
      } else if (subject && !SessionService.getAllowedAulas(checked, subject.id, session.tipoSesion).some((item) => item.id === room.id)) {
        add("error", "invalid_room_type", `${label}: el tipo de aula no corresponde a la sesión.`, details);
      }
      const blocked = Rules.checkBlocked(horario, {
        ...session, academiaId: subject?.academiaId,
      });
      const globalBlock = horario.hasBloqueo("GLOBAL", null, session.dia, session.hora);
      if (!blocked.valid || globalBlock) {
        add("error", "blocked_session", `${label}: ${globalBlock ? "invade un bloqueo global." : blocked.error}`, details);
      }
      if (subject && teacher) {
        const capacity = Rules.checkAcademiaRoomLimit(horario, subject.academiaId,
          session.dia, session.hora, teacher.id, Rules.getAcademiaRoomOptions(data, subject.academiaId));
        if (!capacity.valid) add("error", "academy_room_limit", `${label}: ${capacity.error}`, details);
      }
      Object.entries(occupied).forEach(([field, slots]) => {
        if (!session[field]) return;
        const key = JSON.stringify([session[field], session.dia, session.hora]);
        if (!slots.has(key)) slots.set(key, []);
        slots.get(key).push(session);
      });
    });
    Object.entries(occupied).forEach(([field, slots]) => {
      slots.forEach((sessions) => {
        if (sessions.length < 2) return;
        const first = sessions[0];
        const entity = { grupoId: groups, profesorId: teachers, aulaId: rooms }[field].get(first[field]);
        const kind = { grupoId: "Grupo", profesorId: "Profesor", aulaId: "Aula" }[field];
        add("error", `conflict_${field}`, `${kind} ${entity?.nombre || first[field]}: tiene sesiones simultáneas.`, {
          grupoId: first.grupoId, resourceId: first[field], dia: first.dia, hora: first.hora,
        });
      });
    });
    const result = [...issues.values()].sort((a, b) =>
      (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1) || a.message.localeCompare(b.message, "es"));
    return {
      issues: result,
      errors: result.filter((item) => item.severity === "error").length,
      warnings: result.filter((item) => item.severity === "warning").length,
      groups: data.grupos.length, sessions: horario.sesiones.length, incompleteSubjects,
    };
  },
};
