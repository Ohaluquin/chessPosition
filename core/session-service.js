const SessionService = {
  getGroupTimeWindow(app, grupo) {
    return Rules.getGroupTimeWindow(app?.data, grupo);
  },

  isProfesorAvailableForHour(app, profesor, hourIndex) {
    const label = app.hours[hourIndex];
    if (!label) return false;

    return Rules.isHourWithinWindow(
      label,
      Rules.getProfessorTimeWindow(app?.data, profesor),
    );
  },

  getGroupSessions(app, grupoId) {
    return app.horario.getSesionesByGrupo?.(grupoId) || [];
  },

  findGroupSession(app, grupoId, day, hour) {
    return app.horario.findSesion(day, hour, grupoId);
  },

  getAllowedProfesores(app, grupo, asignaturaId) {
    return GroupService.getCompatibleProfesores(app, grupo, asignaturaId);
  },

  getAllowedAulas(app, asignaturaId, tipoSesion = "clase") {
    const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
    if (!asignatura) return app.data.aulas.slice();

    if (!asignatura.requiereLaboratorio) {
      return app.data.aulas.slice();
    }

    if (tipoSesion === "laboratorio") {
      const labs = app.data.aulas.filter((aula) => aula.tipo === "laboratorio");
      return labs.length > 0 ? labs : app.data.aulas.slice();
    }

    const regularRooms = app.data.aulas.filter(
      (aula) => aula.tipo !== "laboratorio",
    );
    return regularRooms.length > 0 ? regularRooms : app.data.aulas.slice();
  },

  hasSameSubjectOnDay(app, grupoId, asignaturaId, day) {
    return app.horario.sesiones.some(
      (sesion) =>
        sesion.grupoId === grupoId &&
        sesion.asignaturaId === asignaturaId &&
        sesion.dia === day,
    );
  },

  buildHourRange(app, startHour, duration) {
    const range = [];
    for (let offset = 0; offset < duration; offset += 1) {
      const hour = startHour + offset;
      if (hour >= app.hours.length) return null;
      range.push(hour);
    }
    return range;
  },

  getBlockSessions(app, grupoId, day, hour) {
    const seed = this.findGroupSession(app, grupoId, day, hour);
    if (!seed) return [];

    const sameTrack = app.horario.sesiones.filter(
      (sesion) =>
        sesion.grupoId === grupoId &&
        sesion.dia === day &&
        sesion.asignaturaId === seed.asignaturaId &&
        sesion.profesorId === seed.profesorId &&
        sesion.aulaId === seed.aulaId &&
        (sesion.tipoSesion ?? "clase") === (seed.tipoSesion ?? "clase") &&
        (sesion.locked === true) === (seed.locked === true),
    );

    const hours = new Set(sameTrack.map((sesion) => sesion.hora));
    const blockHours = [hour];

    for (let h = hour - 1; hours.has(h); h -= 1) {
      blockHours.unshift(h);
    }

    for (let h = hour + 1; hours.has(h); h += 1) {
      blockHours.push(h);
    }

    return blockHours
      .map((blockHour) =>
        sameTrack.find((sesion) => sesion.hora === blockHour) || null,
      )
      .filter(Boolean);
  },

  getBlockDuration(app, grupo, asignatura, tipoSesion = "clase") {
    if (grupo && app) {
      return GroupService.getBlockDurationForKind(app, grupo, asignatura, tipoSesion, {
        useVariants: true,
      });
    }
    if (tipoSesion === "estudio") return 2;
    return Math.max(1, asignatura?.duracionSegmentos || 1);
  },

  removeBlockSessions(app, grupoId, day, hour) {
    const block = this.getBlockSessions(app, grupoId, day, hour);
    block.forEach((sesion) => app.horario.removeSesion(sesion));
    return block;
  },

  validateGroupSession(app, payload) {
    const asignatura = app.data.asignaturas.find(
      (item) => item.id === payload.asignaturaId,
    );
    const profesor = app.data.profesores.find(
      (item) => item.id === payload.profesorId,
    );

    if (!asignatura) {
      return { valid: false, error: "Asignatura invalida." };
    }

    if (!profesor) {
      return { valid: false, error: "Profesor invalido." };
    }

    const grupo = app.data.grupos.find((item) => item.id === payload.grupoId);
    if (!grupo) {
      return { valid: false, error: "Grupo invalido." };
    }

    GroupService.ensureProfesorAssignments(app, grupo);
    const profesorAsignado = GroupService.getAssignedProfesorId(
      grupo,
      payload.asignaturaId,
    );
    if (profesorAsignado && profesorAsignado !== payload.profesorId) {
      return {
        valid: false,
        error: "La asignatura ya tiene un profesor fijo para este grupo.",
      };
    }

    const belongsToGroup = GroupService.getPlanAsignaturaIds(grupo).includes(
      payload.asignaturaId,
    );
    if (!belongsToGroup) {
      return {
        valid: false,
        error: "La asignatura no pertenece al plan del grupo.",
      };
    }

    const allowedProfesores = this.getAllowedProfesores(
      app,
      grupo,
      payload.asignaturaId,
    );
    if (!allowedProfesores.some((item) => item.id === payload.profesorId)) {
      return {
        valid: false,
        error: "El profesor no es compatible con la asignatura seleccionada.",
      };
    }

    const tipoSesion = payload.tipoSesion || "clase";
    const allowedKinds = ["clase"];
    if ((asignatura.estudio?.mode || "none") === "sesion_separate") {
      allowedKinds.push("estudio");
    }
    if (asignatura.requiereLaboratorio) {
      allowedKinds.push("laboratorio");
    }

    if (!allowedKinds.includes(tipoSesion)) {
      return {
        valid: false,
        error: "El tipo de sesion no es valido para esta asignatura.",
      };
    }

    const requirement = GroupService.getRequirementStatus(app, grupo, asignatura);
    const expectedDuration = this.getBlockDuration(app, grupo, asignatura, tipoSesion);
    const matchingPending = requirement.pendingBlocks.find(
      (block) => block.kind === tipoSesion && block.duration === expectedDuration,
    );
    if (!matchingPending) {
      return {
        valid: false,
        error: "Ese tipo de sesion ya esta cubierto para la asignatura.",
      };
    }

    if (this.hasSameSubjectOnDay(app, payload.grupoId, payload.asignaturaId, payload.day)) {
      return {
        valid: false,
        error: "La asignatura ya tiene una sesion programada ese dia.",
      };
    }

    if (payload.aulaId) {
      const allowedAulas = this.getAllowedAulas(
        app,
        payload.asignaturaId,
        tipoSesion,
      );
      if (!allowedAulas.some((item) => item.id === payload.aulaId)) {
        return {
          valid: false,
          error: "El aula no es compatible con la asignatura seleccionada.",
        };
      }
    }

    const duration = this.getBlockDuration(app, grupo, asignatura, tipoSesion);
    const hourRange = this.buildHourRange(app, payload.hour, duration);
    if (!hourRange) {
      return {
        valid: false,
        error: "La sesion no cabe completa en el horario disponible.",
      };
    }

    const optativeWindow = Rules.validateOptativeWindow(
      app.data,
      grupo,
      payload.asignaturaId,
      payload.day,
      hourRange,
      app.hours,
    );
    if (!optativeWindow.valid) return optativeWindow;

    const turnoWindow = this.getGroupTimeWindow(app, grupo);

    const withinTurno =
      grupo.tipo === "optativa" || hourRange.every((hourIndex) => {
      const label = app.hours[hourIndex];
      return label >= turnoWindow.inicio && label < turnoWindow.fin;
      });

    if (!withinTurno) {
      return {
        valid: false,
        error: "La sesion rebasa el turno configurado para el grupo.",
      };
    }

    const professorTurnCompatible = hourRange.every((hourIndex) =>
      this.isProfesorAvailableForHour(app, profesor, hourIndex),
    );

    if (!professorTurnCompatible) {
      return {
        valid: false,
        error: "El profesor no esta disponible en ese horario por su turno.",
      };
    }

    let addedSegments = 0;
    for (const hourIndex of hourRange) {
      const check = Rules.validateSession(
        app.horario,
        profesor,
        payload.grupoId,
        payload.aulaId,
        payload.day,
        hourIndex,
        payload.asignaturaId,
        (asignatura.totalSegmentosSemana ?? null) - addedSegments,
        asignatura.academiaId,
        Rules.getAcademiaRoomOptions(app.data, asignatura.academiaId),
      );

      if (!check.valid) return check;
      addedSegments += 1;
    }

    return { valid: true, hourRange };
  },

  saveGroupSession(app, payload) {
    const existingBlock = this.removeBlockSessions(
      app,
      payload.grupoId,
      payload.day,
      payload.hour,
    );

    const validation = this.validateGroupSession(app, payload);
    if (!validation.valid) {
      existingBlock.forEach((sesion) => app.horario.addSesion(sesion));
      return validation;
    }

    validation.hourRange.forEach((hourIndex) => {
      app.horario.addSesion(
        new Sesion(
          payload.grupoId,
          payload.asignaturaId,
          payload.profesorId,
          payload.aulaId,
          payload.day,
          hourIndex,
          payload.tipoSesion || "clase",
          payload.locked === true,
        ),
      );
    });

    return { valid: true, hourRange: validation.hourRange };
  },
};
