/**
 * Validation Rules
 */

const Rules = {
  getAcademiaRoomOptions: (data, academiaId) => {
    const academia = (data?.academias || []).find((item) => item.id === academiaId);
    return {
      limiteSalon: academia?.limiteSalon ?? null,
      academiaNombre: academia?.nombre ?? academiaId,
      getSessionAcademiaId: (sesion) =>
        (data?.asignaturas || []).find((item) => item.id === sesion.asignaturaId)
          ?.academiaId ?? null,
    };
  },

  // Check if a slot is blocked by any scope (GLOBAL, PROFESOR, GRUPO, AULA, ACADEMIA)
  checkBlocked: (
    horario,
    {
      dia,
      hora,
      grupoId = null,
      profesorId = null,
      aulaId = null,
      academiaId = null,
    },
  ) => {
    // Profesor
    if (profesorId && horario.hasBloqueo?.("PROFESOR", profesorId, dia, hora)) {
      return { valid: false, error: "Horario bloqueado para el profesor." };
    }

    // Grupo
    if (grupoId && horario.hasBloqueo?.("GRUPO", grupoId, dia, hora)) {
      return { valid: false, error: "Horario bloqueado para el grupo." };
    }

    // Aula
    if (aulaId && horario.hasBloqueo?.("AULA", aulaId, dia, hora)) {
      return { valid: false, error: "Horario bloqueado para el aula." };
    }

    // Academia
    if (academiaId && horario.hasBloqueo?.("ACADEMIA", academiaId, dia, hora)) {
      return { valid: false, error: "Horario bloqueado para la academia." };
    }

    return { valid: true };
  },

  // Check if professor is already booked at this time
  checkProfessorConflict: (horario, profesorId, dia, hora) => {
    const conflict = horario.sesiones.find(
      (s) => s.profesorId === profesorId && s.dia === dia && s.hora === hora,
    );
    return conflict
      ? { valid: false, error: "El profesor ya tiene clase a esta hora." }
      : { valid: true };
  },

  // Check if group already has a class at this time
  checkGroupConflict: (horario, grupoId, dia, hora) => {
    const conflict = horario.sesiones.find(
      (s) => s.grupoId === grupoId && s.dia === dia && s.hora === hora,
    );
    return conflict
      ? { valid: false, error: "El grupo ya tiene clase a esta hora." }
      : { valid: true };
  },

  // Check if classroom is already booked
  checkClassroomConflict: (horario, aulaId, dia, hora) => {
    const conflict = horario.sesiones.find(
      (s) => s.aulaId === aulaId && s.dia === dia && s.hora === hora,
    );
    return conflict
      ? { valid: false, error: "El aula ya está ocupada a esta hora." }
      : { valid: true };
  },

  checkAcademiaRoomLimit: (
    horario,
    academiaId,
    dia,
    hora,
    profesorId,
    { limiteSalon = null, academiaNombre = null, getSessionAcademiaId = null } = {},
  ) => {
    const limit = Number(limiteSalon);
    if (!academiaId || !Number.isFinite(limit) || limit <= 0) {
      return { valid: true };
    }

    const sessionAcademiaId =
      typeof getSessionAcademiaId === "function" ? getSessionAcademiaId : null;
    if (!sessionAcademiaId) return { valid: true };

    const profesoresOcupados = new Set(
      horario.sesiones
        .filter((s) => s.dia === dia && s.hora === hora)
        .filter((s) => sessionAcademiaId(s) === academiaId)
        .map((s) => s.profesorId)
        .filter(Boolean),
    );

    if (profesorId) profesoresOcupados.delete(profesorId);
    if (profesoresOcupados.size < limit) return { valid: true };

    const label = academiaNombre || academiaId;
    return {
      valid: false,
      error: `La academia ${label} ya ocupa su salon disponible a esta hora.`,
    };
  },

  // Check if professor is available at this time
  checkProfessorAvailability: (profesor, dia, hora) => {
    if (!profesor.isAvailable(dia, hora)) {
      return {
        valid: false,
        error: "El profesor no está disponible a esta hora.",
      };
    }
    return { valid: true };
  },

  // Check if weekly hours for subject are exceeded (optional, usually checked before assignment)
  checkWeeklyHours: (horario, grupoId, asignaturaId, maxHours) => {
    const count = horario.sesiones.filter(
      (s) => s.grupoId === grupoId && s.asignaturaId === asignaturaId,
    ).length;

    if (count >= maxHours) {
      return {
        valid: false,
        error: "Se han cubierto las horas semanales para esta asignatura.",
      };
    }
    return { valid: true };
  },

  // Combined validation for a potential session
  validateSession: (
    horario,
    profesor,
    grupoId,
    aulaId,
    dia,
    hora,
    asignaturaId = null,
    maxHours = null,
    academiaId = null,
    options = {},
  ) => {
    // 0. Blocked slots (GLOBAL / entity)
    let check = Rules.checkBlocked(horario, {
      dia,
      hora,
      grupoId,
      profesorId: profesor?.id,
      aulaId,
      academiaId,
    });
    if (!check.valid) return check;

    // 1. Professor Availability
    check = Rules.checkProfessorAvailability(profesor, dia, hora);
    if (!check.valid) return check;

    // 2. Professor Conflict
    check = Rules.checkProfessorConflict(horario, profesor.id, dia, hora);
    if (!check.valid) return check;

    // 3. Group Conflict
    check = Rules.checkGroupConflict(horario, grupoId, dia, hora);
    if (!check.valid) return check;

    // 4. Classroom Conflict
    if (aulaId) {
      check = Rules.checkClassroomConflict(horario, aulaId, dia, hora);
      if (!check.valid) return check;
    }

    // 5. Academia room capacity
    check = Rules.checkAcademiaRoomLimit(
      horario,
      academiaId,
      dia,
      hora,
      profesor?.id,
      options,
    );
    if (!check.valid) return check;

    // 6. Weekly Hours (if applicable)
    if (asignaturaId && maxHours !== null) {
      check = Rules.checkWeeklyHours(horario, grupoId, asignaturaId, maxHours);
      if (!check.valid) return check;
    }

    return { valid: true };
  },
};
