/**
 * Semi-Automatic Scheduler
 */

class Scheduler {
  constructor(horario, dataStore) {
    this.horario = horario;
    this.dataStore = dataStore;
  }

  scheduleGroup(
    grupoId,
    asignaturasToSchedule,
    { optimizeOptions = {}, useVariants = true } = {},
  ) {
    const report = {
      assigned: [],
      conflicts: [],
      unassigned: [],
    };

    const grupo = this.dataStore.getGrupo(grupoId);
    if (!grupo) {
      report.conflicts.push({ error: `Grupo ${grupoId} no encontrado` });
      return report;
    }

    const beforeSnapshot = this.cloneGroupSessions(grupo.id);
    const duplicateCleanup = this.cleanupDuplicateSingleInstanceBlocks(grupo.id);
    const sortedRequests = [...asignaturasToSchedule].sort((a, b) => {
      const difficultyA = this.getRequestDifficulty(a);
      const difficultyB = this.getRequestDifficulty(b);
      return difficultyB - difficultyA;
    });

    for (const req of sortedRequests) {
      const asignatura = this.dataStore.getAsignatura(req.asignaturaId);
      if (!asignatura) {
        report.unassigned.push({
          asignatura: req.asignaturaId,
          reason: "Asignatura no encontrada",
        });
        continue;
      }

      const profesores = this.getCandidateProfesores(
        asignatura,
        req.profesorId,
        !!req.profesorId,
      );
      if (profesores.length === 0) {
        report.unassigned.push({
          asignatura: asignatura.nombre,
          reason: "No hay profesor disponible",
        });
        continue;
      }

      const dur = Math.max(
        1,
        req.blockDuration ?? (asignatura.duracionSegmentos || 1),
      );

      const candidate = this.findBestCandidate({
        grupo,
        asignatura,
        profesores,
        dur,
        kind: req.kind || "clase",
        variantKey: req.variantKey || null,
        randomizeTop: false,
      });

      if (!candidate) continue;

      this.applyCandidate(
        grupo.id,
        asignatura.id,
        candidate,
        report.assigned,
        req.kind || "clase",
      );
    }

    const optimizationRequests = this.buildOptimizationRequests(
      grupo.id,
      sortedRequests,
      { useVariants },
    );
    report.optimization = this.optimizeGroupWithGenerations(
      grupo,
      optimizationRequests,
      optimizeOptions,
    );

    const afterSnapshot = this.cloneGroupSessions(grupo.id);
    report.assigned = this.diffAddedSessions(beforeSnapshot, afterSnapshot);
    report.duplicatesRemoved = duplicateCleanup.removedSessions;
    report.unassigned = this.buildUnassignedReport(sortedRequests, grupo.id);
    return report;
  }

  improveGroupSchedule(grupoId, requests, optimizeOptions = {}) {
    const grupo = this.dataStore.getGrupo(grupoId);
    if (!grupo) {
      return {
        beforeScore: Number.POSITIVE_INFINITY,
        afterScore: Number.POSITIVE_INFINITY,
      };
    }

    const requestList = [...requests];
    this.cleanupDuplicateSingleInstanceBlocks(grupo.id);
    const beforeScore = this.evaluateGroupSchedule(grupo.id, requestList);

    this.optimizeGroupWithGenerations(grupo, requestList, {
      childrenPerGeneration: 50,
      generations: 50,
      removedBlocksPerChild: this.getRecommendedRemovalCount(grupo.id, requestList),
      ...optimizeOptions,
    });

    const afterScore = this.evaluateGroupSchedule(grupo.id, requestList);
    return { beforeScore, afterScore };
  }

  getGroupBreakStats(grupoId) {
    const hoursByDay = Array.from({ length: 5 }, () => new Set());
    this.horario.sesiones
      .filter((sesion) => sesion.grupoId === grupoId)
      .forEach((sesion) => {
        if (sesion.dia < 0 || sesion.dia >= 5) return;
        hoursByDay[sesion.dia].add(sesion.hora);
      });

    const breaksByDay = hoursByDay.map((occupiedSet) => {
      const hours = [...occupiedSet].sort((a, b) => a - b);
      let freeSlots = 0;
      for (let index = 1; index < hours.length; index += 1) {
        freeSlots += Math.max(0, hours[index] - hours[index - 1] - 1);
      }
      return freeSlots;
    });

    return {
      internalFreeSlots: breaksByDay.reduce((total, value) => total + value, 0),
      daysWithBreak: breaksByDay.filter((value) => value > 0).length,
      breaksByDay,
    };
  }

  countInternalFreeSlots(hours = []) {
    const sorted = [...new Set(hours)].sort((a, b) => a - b);
    let freeSlots = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      freeSlots += Math.max(0, sorted[index] - sorted[index - 1] - 1);
    }
    return freeSlots;
  }

  getWeeklyAdvisoryBreakTarget() {
    return 8;
  }

  getAdvisoryBreakDayTarget(daysUsed) {
    return Math.min(3, Math.max(0, daysUsed));
  }

  buildUnassignedReport(requests, grupoId, { includeDiagnostics = true } = {}) {
    const currentCounts = new Map();
    this.getBlocksForGroup(grupoId).forEach((block) => {
      const key = this.getBlockKey(block);
      currentCounts.set(key, (currentCounts.get(key) || 0) + 1);
    });

    const unassigned = [];
    requests.forEach((req) => {
      const key = this.getRequestKey(req);
      const count = currentCounts.get(key) || 0;
      if (count > 0) {
        currentCounts.set(key, count - 1);
        return;
      }

      const asignatura = this.dataStore.getAsignatura(req.asignaturaId);
      const grupo = this.dataStore.getGrupo(grupoId);
      const diagnosis =
        includeDiagnostics && grupo && asignatura
          ? this.diagnoseRequestFailure(grupo, asignatura, req)
          : null;
      unassigned.push({
        asignatura: asignatura
          ? this.getRequestLabel(asignatura, req)
          : req.asignaturaId,
        reason: diagnosis?.summary || "No se encontraron huecos validos",
        diagnostics: diagnosis,
      });
    });

    return unassigned;
  }

  getRequestDifficulty(req) {
    const asignatura = this.dataStore.getAsignatura(req.asignaturaId);
    if (!asignatura) return -1;

    const profesores = this.getCandidateProfesores(
      asignatura,
      req.profesorId,
      !!req.profesorId,
    );
    const profesorFactor = profesores.length > 0 ? 10 / profesores.length : 10;
    const durationFactor =
      Math.max(1, req.blockDuration ?? (asignatura.duracionSegmentos || 1)) * 3;
    const pendingFactor = req.horasPendientes || req.blockDuration || 0;
    const labFactor = req.kind === "laboratorio" ? 12 : 0;
    const studyFactor = req.kind === "estudio" ? 6 : 0;
    const roomFactor = asignatura.requiereLaboratorio ? 4 : 0;

    return (
      profesorFactor +
      durationFactor +
      pendingFactor +
      roomFactor +
      labFactor +
      studyFactor
    );
  }

  getRequestLabel(asignatura, req) {
    const suffix =
      req.kind === "laboratorio"
        ? " (Laboratorio)"
        : req.kind === "estudio"
          ? " (Estudio)"
          : "";
    return `${asignatura.nombre}${suffix}`;
  }

  summarizeFailureCounts(reasonCounts) {
    const labels = {
      same_day_duplicate: "la materia ya ocupa los dias disponibles",
      outside_group_window: "no hay bloque continuo dentro del turno del grupo",
      professor_turn: "los profesores disponibles no cubren esa franja",
      blocked_slot: "hay bloqueos de horario",
      professor_conflict: "los profesores ya estan ocupados",
      group_conflict: "el grupo ya esta ocupado",
      academy_room: "la academia ya ocupa su salon disponible",
      weekly_limit: "se alcanza el limite semanal al intentar colocarlo",
      no_professor: "no hay profesor compatible",
      no_candidate: "no se encontro un hueco valido",
    };

    const topReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([key]) => labels[key] || key);

    if (topReasons.length === 0) return "No se encontraron huecos validos";
    if (topReasons.length === 1) return `No cabe porque ${topReasons[0]}.`;
    return `No cabe porque ${topReasons[0]} y ${topReasons[1]}.`;
  }

  diagnoseRequestFailure(grupo, asignatura, req) {
    const profesores = this.getCandidateProfesores(
      asignatura,
      req.profesorId,
      !!req.profesorId,
    );
    if (profesores.length === 0) {
      return {
        summary: "No hay profesor compatible para esta materia.",
        counts: { no_professor: 1 },
      };
    }

    const duration = Math.max(
      1,
      req.blockDuration ?? (asignatura.duracionSegmentos || 1),
    );
    const allowedHours = this.getAllowedHourIndices(grupo);
    const allowedHourSet = new Set(allowedHours);
    const reasonCounts = new Map();
    let checkedRanges = 0;

    const addReason = (key) => {
      reasonCounts.set(key, (reasonCounts.get(key) || 0) + 1);
    };

    for (let day = 0; day < 5; day += 1) {
      const alreadyScheduledSameDay = this.horario.sesiones.some(
        (sesion) =>
          sesion.grupoId === grupo.id &&
          sesion.asignaturaId === asignatura.id &&
          sesion.dia === day,
      );
      if (alreadyScheduledSameDay) {
        addReason("same_day_duplicate");
        continue;
      }

      for (const startHour of allowedHours) {
        const hourRange = [];
        for (let offset = 0; offset < duration; offset += 1) {
          const hourIndex = startHour + offset;
          if (!allowedHourSet.has(hourIndex)) {
            hourRange.length = 0;
            break;
          }
          hourRange.push(hourIndex);
        }

        if (hourRange.length !== duration) {
          addReason("outside_group_window");
          continue;
        }

        checkedRanges += 1;
        let rangeWorked = false;

        for (const profesor of profesores) {
          const validation = this.validateCandidate(
            grupo,
            asignatura,
            profesor,
            day,
            hourRange,
            req.kind || "clase",
            { variantKey: req.variantKey || null },
          );

          if (validation.valid) {
            rangeWorked = true;
            break;
          }

          const message = String(validation.error || "").toLowerCase();
          if (message.includes("fuera de su turno")) addReason("professor_turn");
          else if (message.includes("bloqueado")) addReason("blocked_slot");
          else if (message.includes("profesor ya tiene clase")) {
            addReason("professor_conflict");
          } else if (message.includes("grupo ya tiene clase")) {
            addReason("group_conflict");
          } else if (message.includes("salon disponible")) {
            addReason("academy_room");
          } else if (message.includes("horas semanales")) {
            addReason("weekly_limit");
          } else {
            addReason("no_candidate");
          }
        }

        if (rangeWorked) {
          return {
            summary: "Hay huecos posibles; conviene reintentar con otra distribucion.",
            counts: Object.fromEntries(reasonCounts),
            checkedRanges,
          };
        }
      }
    }

    if (checkedRanges === 0 && reasonCounts.size === 0) {
      addReason("outside_group_window");
    }

    return {
      summary: this.summarizeFailureCounts(reasonCounts),
      counts: Object.fromEntries(reasonCounts),
      checkedRanges,
    };
  }

  getCandidateProfesores(
    asignatura,
    preferredProfesorId = null,
    strictPreferred = false,
  ) {
    const allCompatibles = this.dataStore
      .getProfesoresByAcademia(asignatura.academiaId)
      .filter((profesor) => profesor?.activo !== false)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    if (!preferredProfesorId) return allCompatibles;

    const preferred = allCompatibles.find(
      (profesor) => profesor.id === preferredProfesorId,
    );
    if (!preferred) return strictPreferred ? [] : allCompatibles;
    if (strictPreferred) return [preferred];

    return [
      preferred,
      ...allCompatibles.filter((profesor) => profesor.id !== preferredProfesorId),
    ];
  }

  getGroupTimeWindow(grupo) {
    return Rules.getGroupTimeWindow(this.dataStore.data, grupo);
  }

  getPreferredGroupEnd(grupo) {
    const window = this.getGroupTimeWindow(grupo);
    if (grupo.turno !== "vespertino") return window.fin;
    const endIndex = this.dataStore.hours.indexOf(window.fin);
    return this.dataStore.hours[Math.max(0, endIndex - 1)] || window.fin;
  }

  getApplicableTutoriaRules(grupo) {
    const rules = Array.isArray(this.dataStore.reglasFijas)
      ? this.dataStore.reglasFijas
      : [];

    return rules.filter((rule) => {
      if (rule.scope !== "GRUPO") return false;
      if (!String(rule.motivo || "").toLowerCase().includes("tutoria")) return false;
      if (rule.filters?.turno && rule.filters.turno !== grupo.turno) return false;
      return true;
    });
  }

  getDayIndex(value) {
    if (typeof value === "number") return value;
    return {
      lunes: 0,
      martes: 1,
      miercoles: 2,
      miércoles: 2,
      jueves: 3,
      viernes: 4,
    }[String(value || "").trim().toLowerCase()];
  }

  getHourIndex(label) {
    return this.dataStore.hours.indexOf(label);
  }

  getTutoriaWindow(grupo, day) {
    const matchingRule = this.getApplicableTutoriaRules(grupo).find(
      (rule) => this.getDayIndex(rule.dia) === day,
    );
    if (!matchingRule) return null;

    const startIndex = this.getHourIndex(matchingRule.inicio);
    const endIndex = this.getHourIndex(matchingRule.fin);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return null;

    return {
      startIndex,
      endIndex,
      beforeIndex: startIndex - 1,
      afterIndex: endIndex,
    };
  }

  isProfessorAvailableForHour(profesor, hourIndex) {
    const label = this.dataStore.hours[hourIndex];
    if (!label) return false;
    return Rules.isHourWithinWindow(
      label,
      Rules.getProfessorTimeWindow(this.dataStore.data, profesor),
    );
  }

  getAllowedHourIndices(grupo, asignaturaId = null) {
    if (grupo?.tipo === "optativa" && asignaturaId) {
      const allowed = new Set();
      Rules.getOptativeSlots(this.dataStore.data || {}, grupo, asignaturaId).forEach(
        (slot) => {
          const startIndex = this.dataStore.hours.indexOf(slot.inicio);
          const endLabel =
            slot.fin ||
            (() => {
              const [hour, minute] = String(slot.inicio || "00:00")
                .split(":")
                .map(Number);
              const total = hour * 60 + minute + Number(slot.duracionMin || 90);
              return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
                total % 60,
              ).padStart(2, "0")}`;
            })();
          const endIndex = this.dataStore.hours.indexOf(endLabel);
          for (let index = startIndex; index >= 0 && index < endIndex; index += 1) {
            allowed.add(index);
          }
        },
      );
      return [...allowed].sort((a, b) => a - b);
    }
    return this.dataStore.hours
      .map((label, index) => ({ label, index }))
      .filter(({ label }) => this.isHourAllowedForGroup(grupo, label))
      .map(({ index }) => index);
  }

  isHourAllowedForGroup(grupo, hhmm) {
    const window = this.getGroupTimeWindow(grupo);
    return hhmm >= window.inicio && hhmm < window.fin;
  }

  findBestCandidate({
    grupo,
    asignatura,
    profesores,
    dur,
    kind = "clase",
    variantKey = null,
    randomizeTop = false,
    excludeBlock = null,
  }) {
    const candidates = this.collectCandidates({
      grupo,
      asignatura,
      profesores,
      dur,
      kind,
      variantKey,
      excludeBlock,
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);

    if (!randomizeTop) return candidates[0];

    const top = candidates.slice(0, Math.min(6, candidates.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  collectCandidates({
    grupo,
    asignatura,
    profesores,
    dur,
    kind = "clase",
    variantKey = null,
    excludeBlock = null,
  }) {
    const allowedHours = this.getAllowedHourIndices(grupo, asignatura.id);
    const allowedHourSet = new Set(allowedHours);
    const candidates = [];

    for (let day = 0; day < 5; day += 1) {
      const alreadyScheduledSameDay = this.horario.sesiones.some(
        (sesion) =>
          sesion.grupoId === grupo.id &&
          sesion.asignaturaId === asignatura.id &&
          sesion.dia === day,
      );
      if (alreadyScheduledSameDay) continue;

      for (const startHour of allowedHours) {
        const hourRange = [];
        for (let offset = 0; offset < dur; offset += 1) {
          const hourIndex = startHour + offset;
          if (!allowedHourSet.has(hourIndex)) {
            hourRange.length = 0;
            break;
          }
          hourRange.push(hourIndex);
        }

        if (hourRange.length !== dur) continue;

        if (
          excludeBlock &&
          excludeBlock.day === day &&
          excludeBlock.startHour === startHour
        ) {
          continue;
        }

        for (const profesor of profesores) {
          const validation = this.validateCandidate(
            grupo,
            asignatura,
            profesor,
            day,
            hourRange,
            kind,
            { variantKey },
          );

          if (!validation.valid) continue;

          candidates.push({
            day,
            hours: hourRange,
            profesor,
            score: this.scoreCandidate(grupo, profesor, day, hourRange, kind),
          });
        }
      }
    }

    return candidates;
  }

  validateCandidate(
    grupo,
    asignatura,
    profesor,
    day,
    hourRange,
    kind = "clase",
    { variantKey = null } = {},
  ) {
    const validationApp = {
      data: this.dataStore.data,
      horario: this.horario,
    };
    const requirement = GroupService.getRequirementStatus(
      validationApp,
      grupo,
      asignatura,
      { variantKey, useVariants: true },
    );
    const requiredSegments = requirement.requiredBlocks.reduce(
      (total, block) => total + block.duration,
      0,
    );
    const scheduledSegments = this.horario.sesiones.filter(
      (sesion) =>
        sesion.grupoId === grupo.id && sesion.asignaturaId === asignatura.id,
    ).length;
    if (scheduledSegments + hourRange.length > requiredSegments) {
      return {
        valid: false,
        error: "El bloque rebasa los segmentos requeridos para esta asignatura.",
      };
    }

    const optativeWindow = Rules.validateOptativeWindow(
      this.dataStore.data || {},
      grupo,
      asignatura.id,
      day,
      hourRange,
      this.dataStore.hours,
    );
    if (!optativeWindow.valid) return optativeWindow;

    if (
      this.isSingleInstanceSessionKind(kind) &&
      this.horario.sesiones.some(
        (sesion) =>
          sesion.grupoId === grupo.id &&
          sesion.asignaturaId === asignatura.id &&
          (sesion.tipoSesion ?? "clase") === kind,
      )
    ) {
      return {
        valid: false,
        error: `Ya existe una sesion de ${kind} para esta asignatura.`,
      };
    }

    for (const hourIndex of hourRange) {
      if (!this.isProfessorAvailableForHour(profesor, hourIndex)) {
        return {
          valid: false,
          error: "Profesor fuera de su turno",
        };
      }

      const check = Rules.validateSession(
        this.horario,
        profesor,
        grupo.id,
        null,
        day,
        hourIndex,
        asignatura.id,
        requiredSegments,
        asignatura.academiaId,
        this.getAcademiaRoomOptions(asignatura.academiaId),
      );

      if (!check.valid) return check;
    }

    return { valid: true };
  }

  isSingleInstanceSessionKind(kind) {
    return kind === "laboratorio" || kind === "estudio";
  }

  getAcademiaRoomOptions(academiaId) {
    const academia = this.dataStore.getAcademia?.(academiaId) || null;
    return {
      limiteSalon: academia?.limiteSalon ?? null,
      academiaNombre: academia?.nombre ?? academiaId,
      getSessionAcademiaId: (sesion) =>
        this.dataStore.getAsignatura(sesion.asignaturaId)?.academiaId ?? null,
    };
  }

  scoreCandidate(grupo, profesor, day, hourRange, kind = "clase") {
    let score = 0;

    const startHour = hourRange[0];
    const endHour = hourRange[hourRange.length - 1];

    const groupSessionsSameDay = this.horario.sesiones
      .filter((sesion) => sesion.grupoId === grupo.id && sesion.dia === day)
      .map((sesion) => sesion.hora)
      .sort((a, b) => a - b);

    if (groupSessionsSameDay.length === 0) {
      score += 8;
    } else {
      const breaksBefore = this.countInternalFreeSlots(groupSessionsSameDay);
      const breaksAfter = this.countInternalFreeSlots([
        ...groupSessionsSameDay,
        ...hourRange,
      ]);
      const addedBreaks = Math.max(0, breaksAfter - breaksBefore);
      if (addedBreaks > 0) {
        // Prefer leaving short internal spaces while still allowing the
        // optimizer to trade them against the rest of the schedule.
        score += Math.min(addedBreaks, 2) * 7;
      }

      const nearestDistance = Math.min(
        ...groupSessionsSameDay.map((hour) => Math.abs(hour - startHour)),
      );
      score += Math.max(0, 6 - nearestDistance);

      const extendsExistingBlock =
        groupSessionsSameDay.includes(startHour - 1) ||
        groupSessionsSameDay.includes(endHour + 1);
      if (extendsExistingBlock) score += 5;
    }

    const professorSessionsSameDay = this.horario.sesiones
      .filter((sesion) => sesion.profesorId === profesor.id && sesion.dia === day)
      .map((sesion) => sesion.hora);
    if (professorSessionsSameDay.length === 0) score += 2;

    const centerBias = grupo.turno === "matutino" ? 4 : 16;
    score -= Math.abs(startHour - centerBias) * 0.15;

    if (kind === "laboratorio") score += 9;
    if (kind === "estudio") score += 3;

    const tutoria = this.getTutoriaWindow(grupo, day);
    if (tutoria) {
      const daySessions = this.horario.sesiones
        .filter((sesion) => sesion.grupoId === grupo.id && sesion.dia === day)
        .map((sesion) => sesion.hora);
      const occupied = new Set([...daySessions, ...hourRange]);
      const hasBefore = [...occupied].some((hour) => hour < tutoria.startIndex);
      const hasAfter = [...occupied].some((hour) => hour >= tutoria.endIndex);

      const touchesBefore = hourRange.includes(tutoria.beforeIndex);
      const touchesAfter = hourRange.includes(tutoria.afterIndex);

      if (!hasBefore && touchesBefore) score += 14;
      if (!hasAfter && touchesAfter) score += 14;

      const nearestToBefore = Math.min(
        ...hourRange.map((hour) => Math.abs(hour - tutoria.beforeIndex)),
      );
      const nearestToAfter = Math.min(
        ...hourRange.map((hour) => Math.abs(hour - tutoria.afterIndex)),
      );
      score += Math.max(0, 4 - nearestToBefore) * 1.5;
      score += Math.max(0, 4 - nearestToAfter) * 1.5;

      if (touchesBefore && touchesAfter) score += 8;
    }

    return score;
  }

  applyCandidate(
    grupoId,
    asignaturaId,
    candidate,
    collector = null,
    kind = "clase",
  ) {
    candidate.hours.forEach((hourIndex) => {
      const sesion = new Sesion(
        grupoId,
        asignaturaId,
        candidate.profesor.id,
        null,
        candidate.day,
        hourIndex,
        kind,
        false,
      );
      this.horario.addSesion(sesion);
      if (collector) collector.push(sesion);
    });
  }

  captureAllSessions() {
    return this.horario.sesiones.map((sesion) => ({
      grupoId: sesion.grupoId,
      asignaturaId: sesion.asignaturaId,
      profesorId: sesion.profesorId,
      aulaId: sesion.aulaId ?? null,
      dia: sesion.dia,
      hora: sesion.hora,
      tipoSesion: sesion.tipoSesion ?? "clase",
      locked: sesion.locked === true,
      blockId: sesion.blockId ?? null,
    }));
  }

  restoreAllSessions(snapshot = []) {
    this.horario.sesiones = snapshot.map(
      (sesion) =>
        new Sesion(
          sesion.grupoId,
          sesion.asignaturaId,
          sesion.profesorId,
          sesion.aulaId ?? null,
          sesion.dia,
          sesion.hora,
          sesion.tipoSesion ?? "clase",
          sesion.locked === true,
          sesion.blockId ?? null,
        ),
    );
  }

  getBlockForSession(sesion) {
    return (
      this.getBlocksForGroup(sesion.grupoId).find(
        (block) =>
          block.asignaturaId === sesion.asignaturaId &&
          block.profesorId === sesion.profesorId &&
          block.kind === (sesion.tipoSesion ?? "clase") &&
          block.day === sesion.dia &&
          (block.blockId
            ? block.blockId === sesion.blockId
            : block.hours.includes(sesion.hora)),
      ) || null
    );
  }

  getBlockSessions(block) {
    const hourSet = new Set(block.hours || []);
    return this.horario.sesiones.filter((sesion) => {
      if (sesion.grupoId !== block.grupoId) return false;
      if (block.blockId) return sesion.blockId === block.blockId;
      return (
        sesion.asignaturaId === block.asignaturaId &&
        sesion.profesorId === block.profesorId &&
        (sesion.tipoSesion ?? "clase") === (block.kind ?? "clase") &&
        sesion.dia === block.day &&
        hourSet.has(sesion.hora)
      );
    });
  }

  isBlockLocked(block) {
    return this.getBlockSessions(block).some((sesion) => sesion.locked === true);
  }

  getRepairBlockKey(block) {
    return [
      block.grupoId,
      block.asignaturaId,
      block.profesorId ?? "",
      block.kind ?? "clase",
      block.day,
      block.startHour,
      (block.hours || []).join(","),
    ].join("|");
  }

  collectRepairCandidateProposals({ grupo, asignatura, profesores, dur, kind }) {
    const allowedHours = this.getAllowedHourIndices(grupo, asignatura.id);
    const allowedHourSet = new Set(allowedHours);
    const proposals = [];

    for (let day = 0; day < 5; day += 1) {
      const alreadyScheduledSameDay = this.horario.sesiones.some(
        (sesion) =>
          sesion.grupoId === grupo.id &&
          sesion.asignaturaId === asignatura.id &&
          sesion.dia === day,
      );
      if (alreadyScheduledSameDay) continue;

      for (const startHour of allowedHours) {
        const hourRange = [];
        for (let offset = 0; offset < dur; offset += 1) {
          const hourIndex = startHour + offset;
          if (!allowedHourSet.has(hourIndex)) {
            hourRange.length = 0;
            break;
          }
          hourRange.push(hourIndex);
        }
        if (hourRange.length !== dur) continue;

        const optativeWindow = Rules.validateOptativeWindow(
          this.dataStore.data || {},
          grupo,
          asignatura.id,
          day,
          hourRange,
          this.dataStore.hours,
        );
        if (!optativeWindow.valid) continue;

        for (const profesor of profesores) {
          if (
            hourRange.some(
              (hourIndex) => !this.isProfessorAvailableForHour(profesor, hourIndex),
            )
          ) {
            continue;
          }

          const hasHardBlock = hourRange.some(
            (hourIndex) =>
              !Rules.checkBlocked(this.horario, {
                dia: day,
                hora: hourIndex,
                grupoId: grupo.id,
                profesorId: profesor.id,
                academiaId: asignatura.academiaId,
              }).valid,
          );
          if (hasHardBlock) continue;

          proposals.push({
            day,
            hours: hourRange,
            profesor,
            score: this.scoreCandidate(grupo, profesor, day, hourRange, kind),
          });
        }
      }
    }

    return proposals.sort((a, b) => b.score - a.score);
  }

  collectConflictBlocksForProposal(grupo, asignatura, candidate) {
    const blocks = new Map();
    const addSessionBlock = (sesion) => {
      if (sesion.grupoId === grupo.id) {
        return false;
      }
      const block = this.getBlockForSession(sesion);
      if (!block) return false;
      blocks.set(this.getRepairBlockKey(block), block);
      return true;
    };

    const academy = this.dataStore.getAcademia?.(asignatura.academiaId);
    const roomLimit = Number(academy?.limiteSalon);

    for (const hourIndex of candidate.hours) {
      const sessionsAtHour = this.horario.sesiones.filter(
        (sesion) => sesion.dia === candidate.day && sesion.hora === hourIndex,
      );

      if (
        sessionsAtHour.some(
          (sesion) => sesion.grupoId === grupo.id,
        )
      ) {
        return { hardConflict: true, blocks: [] };
      }

      sessionsAtHour
        .filter((sesion) => sesion.profesorId === candidate.profesor.id)
        .forEach(addSessionBlock);

      if (Number.isFinite(roomLimit) && roomLimit > 0) {
        const academySessions = sessionsAtHour.filter((sesion) => {
          const sessionSubject = this.dataStore.getAsignatura(sesion.asignaturaId);
          return sessionSubject?.academiaId === asignatura.academiaId;
        });
        const occupiedByProfessor = new Map();
        academySessions.forEach((sesion) => {
          if (!occupiedByProfessor.has(sesion.profesorId)) {
            occupiedByProfessor.set(sesion.profesorId, sesion);
          }
        });
        occupiedByProfessor.delete(candidate.profesor.id);

        const needed = occupiedByProfessor.size - roomLimit + 1;
        if (needed > 0) {
          const candidates = [...occupiedByProfessor.values()]
            .map((sesion) => this.getBlockForSession(sesion))
            .filter(Boolean)
            .filter((block) => !this.isBlockLocked(block))
            .sort((a, b) => a.hours.length - b.hours.length);
          const selectedProfessors = new Set();
          for (const block of candidates) {
            if (selectedProfessors.size >= needed) break;
            selectedProfessors.add(block.profesorId);
            blocks.set(this.getRepairBlockKey(block), block);
          }
          if (selectedProfessors.size < needed) {
            return { hardConflict: true, blocks: [] };
          }
        }
      }
    }

    const blockList = [...blocks.values()];
    if (blockList.some((block) => this.isBlockLocked(block))) {
      return { hardConflict: true, blocks: [] };
    }
    return { hardConflict: false, blocks: blockList };
  }

  relocateBlock(block, { excludeOriginal = true } = {}) {
    const grupo = this.dataStore.getGrupo(block.grupoId);
    const asignatura = this.dataStore.getAsignatura(block.asignaturaId);
    if (!grupo || !asignatura || this.isBlockLocked(block)) return null;
    const variantKey = GroupService.getRequirementStatus(
      { data: this.dataStore.data, horario: this.horario },
      grupo,
      asignatura,
      { useVariants: true },
    ).variantKey;

    const profesores = this.getCandidateProfesores(
      asignatura,
      block.profesorId,
      true,
    );
    if (profesores.length === 0) return null;

    const candidate = this.findBestCandidate({
      grupo,
      asignatura,
      profesores,
      dur: Math.max(1, block.hours?.length || 1),
      kind: block.kind || "clase",
      variantKey,
      randomizeTop: true,
      excludeBlock: excludeOriginal
        ? { day: block.day, startHour: block.startHour }
        : null,
    });
    if (!candidate) return null;

    const validation = this.validateCandidate(
      grupo,
      asignatura,
      candidate.profesor,
      candidate.day,
      candidate.hours,
      block.kind || "clase",
      { variantKey },
    );
    if (!validation.valid) return null;

    const movedSessions = [];
    this.applyCandidate(
      grupo.id,
      asignatura.id,
      candidate,
      movedSessions,
      block.kind || "clase",
    );
    return { candidate, movedSessions };
  }

  repairRequestWithGlobalMove(
    grupo,
    request,
    { maxCandidates = 36, maxDisplacedBlocks = 4 } = {},
  ) {
    const asignatura = this.dataStore.getAsignatura(request.asignaturaId);
    if (!asignatura) return null;

    const profesores = this.getCandidateProfesores(
      asignatura,
      request.profesorId,
      !!request.profesorId,
    );
    if (profesores.length === 0) return null;

    const proposals = this.collectRepairCandidateProposals({
      grupo,
      asignatura,
      profesores,
      dur: Math.max(
        1,
        request.blockDuration ?? (asignatura.duracionSegmentos || 1),
      ),
      kind: request.kind || "clase",
    });

    for (const proposal of proposals.slice(0, maxCandidates)) {
      const conflict = this.collectConflictBlocksForProposal(
        grupo,
        asignatura,
        proposal,
      );
      if (conflict.hardConflict || conflict.blocks.length === 0) {
        continue;
      }
      if (conflict.blocks.length > maxDisplacedBlocks) continue;

      const snapshot = this.captureAllSessions();
      conflict.blocks.forEach((block) => this.removeBlock(block.grupoId, block));

      const targetValidation = this.validateCandidate(
        grupo,
        asignatura,
        proposal.profesor,
        proposal.day,
        proposal.hours,
        request.kind || "clase",
        { variantKey: request.variantKey || null },
      );
      if (!targetValidation.valid) {
        this.restoreAllSessions(snapshot);
        continue;
      }

      const assigned = [];
      this.applyCandidate(
        grupo.id,
        asignatura.id,
        proposal,
        assigned,
        request.kind || "clase",
      );

      const displacedGroupIds = new Set();
      let successful = true;
      for (const block of conflict.blocks) {
        const relocation = this.relocateBlock(block);
        if (!relocation) {
          successful = false;
          break;
        }
        displacedGroupIds.add(block.grupoId);
      }

      if (successful) {
        return {
          assigned,
          displacedGroupIds: [...displacedGroupIds],
          movedBlocks: conflict.blocks.length,
        };
      }
      this.restoreAllSessions(snapshot);
    }

    return null;
  }

  repairGroupScheduleGlobally(
    grupoId,
    requests,
    { maxCandidates = 36, maxDisplacedBlocks = 4 } = {},
  ) {
    const grupo = this.dataStore.getGrupo(grupoId);
    if (!grupo) {
      return {
        assigned: [],
        displacedGroupIds: [],
        movedBlocks: 0,
        attempted: 0,
      };
    }

    const pendingRequests = [...requests].sort(
      (a, b) => this.getRequestDifficulty(b) - this.getRequestDifficulty(a),
    );
    const result = {
      assigned: [],
      displacedGroupIds: new Set(),
      movedBlocks: 0,
      attempted: 0,
    };

    pendingRequests.forEach((request) => {
      result.attempted += 1;
      const repair = this.repairRequestWithGlobalMove(grupo, request, {
        maxCandidates,
        maxDisplacedBlocks,
      });
      if (!repair) return;
      result.assigned.push(...repair.assigned);
      repair.displacedGroupIds.forEach((id) => result.displacedGroupIds.add(id));
      result.movedBlocks += repair.movedBlocks;
    });

    result.displacedGroupIds = [...result.displacedGroupIds];
    return result;
  }

  cloneGroupSessions(grupoId) {
    return this.horario.sesiones
      .filter((sesion) => sesion.grupoId === grupoId)
      .map((sesion) => ({
        grupoId: sesion.grupoId,
        asignaturaId: sesion.asignaturaId,
        profesorId: sesion.profesorId,
        aulaId: sesion.aulaId ?? null,
        dia: sesion.dia,
        hora: sesion.hora,
        tipoSesion: sesion.tipoSesion ?? "clase",
        locked: sesion.locked === true,
      }));
  }

  restoreGroupSessions(grupoId, snapshot) {
    this.horario.sesiones = this.horario.sesiones.filter(
      (sesion) => sesion.grupoId !== grupoId,
    );

    snapshot.forEach((sesion) => {
      this.horario.addSesion(
        new Sesion(
          sesion.grupoId,
          sesion.asignaturaId,
          sesion.profesorId,
          sesion.aulaId,
          sesion.dia,
          sesion.hora,
          sesion.tipoSesion ?? "clase",
          sesion.locked === true,
        ),
      );
    });
  }

  diffAddedSessions(before, after) {
    const beforeKeys = new Set(before.map((sesion) => this.getSessionKey(sesion)));
    return after
      .filter((sesion) => !beforeKeys.has(this.getSessionKey(sesion)))
      .map(
        (sesion) =>
          new Sesion(
            sesion.grupoId,
            sesion.asignaturaId,
            sesion.profesorId,
            sesion.aulaId,
            sesion.dia,
            sesion.hora,
            sesion.tipoSesion ?? "clase",
            sesion.locked === true,
          ),
      );
  }

  getSessionKey(sesion) {
    return [
      sesion.grupoId,
      sesion.asignaturaId,
      sesion.profesorId,
      sesion.aulaId ?? "",
      sesion.dia,
      sesion.hora,
      sesion.tipoSesion ?? "clase",
      sesion.locked === true ? "1" : "0",
    ].join("|");
  }

  getBlocksForGroup(grupoId) {
    const sessions = this.horario.sesiones
      .filter((sesion) => sesion.grupoId === grupoId)
      .sort((a, b) => {
        if (a.asignaturaId !== b.asignaturaId) {
          return String(a.asignaturaId).localeCompare(String(b.asignaturaId), "es");
        }
        const kindA = a.tipoSesion ?? "clase";
        const kindB = b.tipoSesion ?? "clase";
        if (kindA !== kindB) return kindA.localeCompare(kindB, "es");
        if (a.dia !== b.dia) return a.dia - b.dia;
        return a.hora - b.hora;
      });

    const blocks = [];

    sessions.forEach((sesion) => {
      const last = blocks[blocks.length - 1];
      if (
        last &&
        last.asignaturaId === sesion.asignaturaId &&
        last.profesorId === sesion.profesorId &&
        last.kind === (sesion.tipoSesion ?? "clase") &&
        last.day === sesion.dia &&
        ((!last.blockId && !sesion.blockId) || last.blockId === sesion.blockId) &&
        last.endHour + 1 === sesion.hora
      ) {
        last.endHour = sesion.hora;
        last.hours.push(sesion.hora);
        last.locked = last.locked || sesion.locked === true;
        return;
      }

      blocks.push({
        grupoId,
        asignaturaId: sesion.asignaturaId,
        profesorId: sesion.profesorId,
        kind: sesion.tipoSesion ?? "clase",
        blockId: sesion.blockId || null,
        locked: sesion.locked === true,
        day: sesion.dia,
        startHour: sesion.hora,
        endHour: sesion.hora,
        hours: [sesion.hora],
      });
    });

    return blocks;
  }

  removeBlock(grupoId, block) {
    const hourSet = new Set(block.hours);
    this.horario.sesiones = this.horario.sesiones.filter((sesion) => {
      if (block.blockId) {
        return !(sesion.grupoId === grupoId && sesion.blockId === block.blockId);
      }
      return !(
        sesion.grupoId === grupoId &&
        sesion.asignaturaId === block.asignaturaId &&
        sesion.profesorId === block.profesorId &&
        (sesion.tipoSesion ?? "clase") === (block.kind ?? "clase") &&
        sesion.dia === block.day &&
        hourSet.has(sesion.hora)
      );
    });
  }

  cleanupOverassignedBlocks(grupoId, { useVariants = true } = {}) {
    const grupo = this.dataStore.getGrupo(grupoId);
    if (!grupo) {
      return { removedBlocks: [], removedSessions: 0, lockedExtras: 0 };
    }

    const validationApp = {
      data: this.dataStore.data,
      horario: this.horario,
    };
    const removedBlocks = [];
    let removedSessions = 0;
    let lockedExtras = 0;

    GroupService.getPlanAsignaturas(validationApp, grupo).forEach((asignatura) => {
      const status = GroupService.getRequirementStatus(
        validationApp,
        grupo,
        asignatura,
        { useVariants },
      );
      const remaining = this.getBlocksForGroup(grupoId).filter(
        (block) => block.asignaturaId === asignatura.id,
      );

      (status.requiredBlocks || []).forEach((requiredBlock) => {
        const exactIndex = remaining.findIndex(
          (block) =>
            block.kind === requiredBlock.kind &&
            block.hours.length === requiredBlock.duration,
        );
        const matchIndex =
          exactIndex >= 0
            ? exactIndex
            : remaining.findIndex(
                (block) =>
                  block.kind === requiredBlock.kind &&
                  GroupService.isSingleInstanceKind(requiredBlock.kind) &&
                  block.hours.length >= requiredBlock.duration,
              );
        if (matchIndex < 0) return;

        const matched = remaining.splice(matchIndex, 1)[0];
        const isOverlong =
          GroupService.isSingleInstanceKind(requiredBlock.kind) &&
          matched.hours.length > requiredBlock.duration;
        if (isOverlong) {
          // Rebuild the complete block at the requested duration.  Trimming
          // one hour in place could leave a stale blockId or a locked segment
          // in the middle of it.
          if (matched.locked) {
            lockedExtras += matched.hours.length - requiredBlock.duration;
          } else {
            removedSessions += matched.hours.length;
            this.removeBlock(grupoId, matched);
            removedBlocks.push(matched);
          }
        }
      });

      remaining.forEach((block) => {
        if (block.locked) {
          lockedExtras += block.hours.length;
          return;
        }
        removedSessions += block.hours.length;
        this.removeBlock(grupoId, block);
        removedBlocks.push(block);
      });
    });

    return { removedBlocks, removedSessions, lockedExtras };
  }

  cleanupDuplicateSingleInstanceBlocks(grupoId) {
    const blocks = this.getBlocksForGroup(grupoId)
      .filter((block) => this.isSingleInstanceSessionKind(block.kind))
      .sort((a, b) => {
        if (a.asignaturaId !== b.asignaturaId) {
          return String(a.asignaturaId).localeCompare(String(b.asignaturaId), "es");
        }
        if (a.kind !== b.kind) return String(a.kind).localeCompare(String(b.kind), "es");
        if (a.locked !== b.locked) return a.locked ? -1 : 1;
        if (a.day !== b.day) return a.day - b.day;
        return a.startHour - b.startHour;
      });
    const seen = new Set();
    const removedBlocks = [];
    let removedSessions = 0;

    blocks.forEach((block) => {
      const key = `${block.asignaturaId}|${block.kind}`;
      if (!seen.has(key)) {
        seen.add(key);
        return;
      }
      if (block.locked) return;

      removedSessions += block.hours.length;
      this.removeBlock(grupoId, block);
      removedBlocks.push(block);
    });

    return { removedBlocks, removedSessions };
  }

  optimizeGroupWithGenerations(
    grupo,
    requests,
    {
      childrenPerGeneration = 100,
      generations = 100,
      removedBlocksPerChild = 3,
      maxMilliseconds = Number.POSITIVE_INFINITY,
      stopAfterStaleGenerations = Number.POSITIVE_INFINITY,
    } = {},
  ) {
    const startedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    const requestList = [...requests];
    const adaptiveRemovalCount = Math.max(
      removedBlocksPerChild,
      this.getRecommendedRemovalCount(grupo.id, requestList),
    );
    let parentSnapshot = this.cloneGroupSessions(grupo.id);
    let bestGlobalSnapshot = parentSnapshot;
    const initialScore = this.evaluateGroupSchedule(grupo.id, requestList);
    let bestGlobalScore = initialScore;
    let generationsRun = 0;
    let staleGenerations = 0;
    let timedOut = false;

    for (let generation = 0; generation < generations; generation += 1) {
      const now =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      if (now - startedAt >= maxMilliseconds) {
        timedOut = true;
        break;
      }

      let bestChildSnapshot = parentSnapshot;
      let bestChildScore = Number.POSITIVE_INFINITY;
      const missingKinds = this.getMissingRequestLabels(grupo.id, requestList);

      for (let child = 0; child < childrenPerGeneration; child += 1) {
        const childNow =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
        if (childNow - startedAt >= maxMilliseconds) {
          timedOut = true;
          break;
        }
        this.restoreGroupSessions(grupo.id, parentSnapshot);

        const removedBlocks = this.removeRandomBlocks(
          grupo.id,
          adaptiveRemovalCount,
          requestList,
          { missingKinds },
        );
        const rebuilt = this.fillMissingBlocksHeuristically(grupo, requestList, {
          randomizeTop: true,
        });

        if (removedBlocks.length === 0 && rebuilt.inserted === 0) {
          const score = this.evaluateGroupSchedule(grupo.id, requestList);
          if (score < bestChildScore) {
            bestChildScore = score;
            bestChildSnapshot = this.cloneGroupSessions(grupo.id);
          }
          continue;
        }

        const childScore = this.evaluateGroupSchedule(grupo.id, requestList);
        if (childScore < bestChildScore) {
          bestChildScore = childScore;
          bestChildSnapshot = this.cloneGroupSessions(grupo.id);
        }
      }

      if (timedOut) break;

      parentSnapshot = bestChildSnapshot;
      this.restoreGroupSessions(grupo.id, parentSnapshot);

      if (bestChildScore < bestGlobalScore) {
        bestGlobalScore = bestChildScore;
        bestGlobalSnapshot = bestChildSnapshot;
        staleGenerations = 0;
      } else {
        staleGenerations += 1;
      }

      generationsRun += 1;

      if (staleGenerations >= stopAfterStaleGenerations) {
        break;
      }
    }

    this.restoreGroupSessions(grupo.id, bestGlobalSnapshot);
    return {
      beforeScore: initialScore,
      afterScore: this.evaluateGroupSchedule(grupo.id, requestList),
      generationsRun,
      timedOut,
      staleGenerations,
    };
  }

  getMissingRequestCount(grupoId, requests) {
    return this.buildUnassignedReport(requests, grupoId, {
      includeDiagnostics: false,
    }).length;
  }

  getMissingRequestLabels(grupoId, requests) {
    return new Set(
      this.buildUnassignedReport(requests, grupoId, {
        includeDiagnostics: false,
      }).map((item) => item.asignatura),
    );
  }

  getRecommendedRemovalCount(grupoId, requests) {
    const missingCount = this.getMissingRequestCount(grupoId, requests);
    if (missingCount >= 4) return 7;
    if (missingCount >= 2) return 5;
    if (missingCount >= 1) return 4;
    return 3;
  }

  removeRandomBlocks(
    grupoId,
    maxBlocksToRemove,
    requests = [],
    { missingKinds = null } = {},
  ) {
    const blocks = this.getBlocksForGroup(grupoId).filter((block) => !block.locked);
    if (blocks.length === 0) return [];

    const count = Math.min(maxBlocksToRemove, blocks.length);
    const missingLabels = missingKinds || this.getMissingRequestLabels(grupoId, requests);
    const blocksByDay = new Map();
    blocks.forEach((block) => {
      const dayBlocks = blocksByDay.get(block.day) || [];
      dayBlocks.push(block);
      blocksByDay.set(block.day, dayBlocks);
    });
    blocksByDay.forEach((dayBlocks) => {
      dayBlocks.sort((a, b) => a.startHour - b.startHour);
    });

    const weighted = blocks.map((block) => {
      let weight = 1;
      const dayBlocks = blocksByDay.get(block.day) || [];
      const first = dayBlocks[0];
      const last = dayBlocks[dayBlocks.length - 1];
      if (first === block || last === block) weight += 2;

      const blockLabel = this.getRequestLabel(
        this.dataStore.getAsignatura(block.asignaturaId) || { nombre: block.asignaturaId },
        {
          asignaturaId: block.asignaturaId,
          kind: block.kind,
          blockDuration: block.hours.length,
        },
      );
      if (!missingLabels.has(blockLabel)) weight += 1;

      return { block, weight };
    });

    const removed = [];
    for (let i = 0; i < count && weighted.length > 0; i += 1) {
      const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
      let ticket = Math.random() * totalWeight;
      let pickedIndex = 0;
      for (let index = 0; index < weighted.length; index += 1) {
        ticket -= weighted[index].weight;
        if (ticket <= 0) {
          pickedIndex = index;
          break;
        }
      }

      const [{ block }] = weighted.splice(pickedIndex, 1);
      this.removeBlock(grupoId, block);
      removed.push(block);
    }

    return removed;
  }

  getRequestKey(req) {
    if (this.isSingleInstanceSessionKind(req.kind || "clase")) {
      return [
        req.asignaturaId,
        req.kind || "clase",
        "single",
      ].join("|");
    }

    return [
      req.asignaturaId,
      req.kind || "clase",
      req.blockDuration || 0,
    ].join("|");
  }

  buildOptimizationRequests(grupoId, pendingRequests = [], { useVariants = true } = {}) {
    const grupo = this.dataStore.getGrupo(grupoId);
    const variantKeys = new Map(
      pendingRequests
        .filter((request) => request?.variantKey)
        .map((request) => [request.asignaturaId, request.variantKey]),
    );
    const currentBlocks = this.getBlocksForGroup(grupoId).map((block) => {
      let variantKey = variantKeys.get(block.asignaturaId) || null;
      if (!variantKey && grupo) {
        const asignatura = this.dataStore.getAsignatura(block.asignaturaId);
        if (asignatura) {
          variantKey = GroupService.getRequirementStatus(
            {
              data: this.dataStore.data,
              horario: this.horario,
            },
            grupo,
            asignatura,
            { useVariants },
          ).variantKey;
        }
      }
      return {
        asignaturaId: block.asignaturaId,
        profesorId: block.profesorId ?? null,
        kind: block.kind || "clase",
        variantKey,
        blockDuration: Math.max(1, block.hours?.length || 1),
        horasPendientes: Math.max(1, block.hours?.length || 1),
      };
    });

    return [...currentBlocks, ...pendingRequests];
  }

  getBlockKey(block) {
    if (this.isSingleInstanceSessionKind(block.kind || "clase")) {
      return [
        block.asignaturaId,
        block.kind || "clase",
        "single",
      ].join("|");
    }

    return [
      block.asignaturaId,
      block.kind || "clase",
      block.hours?.length || 0,
    ].join("|");
  }

  buildMissingBlockTasks(requests, grupoId) {
    const currentCounts = new Map();
    this.getBlocksForGroup(grupoId).forEach((block) => {
      const key = this.getBlockKey(block);
      currentCounts.set(key, (currentCounts.get(key) || 0) + 1);
    });

    const tasks = [];

    requests.forEach((req) => {
      const asignatura = this.dataStore.getAsignatura(req.asignaturaId);
      if (!asignatura) return;
      const key = this.getRequestKey(req);
      const scheduledCount = currentCounts.get(key) || 0;
      if (scheduledCount > 0) {
        currentCounts.set(key, scheduledCount - 1);
        return;
      }

      tasks.push({
        asignaturaId: req.asignaturaId,
        profesorId: req?.profesorId ?? null,
        kind: req.kind || "clase",
        variantKey: req.variantKey || null,
        blockDuration: Math.max(
          1,
          req.blockDuration ?? (asignatura.duracionSegmentos || 1),
        ),
        horasPendientes: Math.max(
          1,
          req.blockDuration ?? (asignatura.duracionSegmentos || 1),
        ),
      });
    });

    return tasks.sort((a, b) => {
      const difficultyA = this.getRequestDifficulty(a);
      const difficultyB = this.getRequestDifficulty(b);
      return difficultyB - difficultyA;
    });
  }

  fillMissingBlocksHeuristically(
    grupo,
    requests,
    { randomizeTop = true } = {},
  ) {
    const tasks = this.buildMissingBlockTasks(requests, grupo.id);
    let inserted = 0;
    let skipped = 0;

    for (const task of tasks) {
      const asignatura = this.dataStore.getAsignatura(task.asignaturaId);
      if (!asignatura) {
        skipped += 1;
        continue;
      }

      const profesores = this.getCandidateProfesores(
        asignatura,
        task.profesorId,
        !!task.profesorId,
      );
      if (profesores.length === 0) {
        skipped += 1;
        continue;
      }

      const candidate = this.findBestCandidate({
        grupo,
        asignatura,
        profesores,
        dur: task.blockDuration,
        kind: task.kind || "clase",
        variantKey: task.variantKey || null,
        randomizeTop,
      });

      if (!candidate) {
        skipped += 1;
        continue;
      }

      this.applyCandidate(
        grupo.id,
        asignatura.id,
        candidate,
        null,
        task.kind || "clase",
      );
      inserted += 1;
    }

    return { complete: skipped === 0, inserted, skipped };
  }

  evaluateGroupSchedule(grupoId, requests = []) {
    const grupo = this.dataStore.getGrupo(grupoId);
    if (!grupo) return Number.POSITIVE_INFINITY;

    const groupSessions = this.horario.sesiones.filter(
      (sesion) => sesion.grupoId === grupoId,
    );
    const blocks = this.getBlocksForGroup(grupoId);
    let score = 0;

    const blocksBySubject = new Map();
    const blocksByRequirement = new Map();
    blocks.forEach((block) => {
      const list = blocksBySubject.get(block.asignaturaId) || [];
      list.push(block);
      blocksBySubject.set(block.asignaturaId, list);

      const reqList = blocksByRequirement.get(this.getBlockKey(block)) || [];
      reqList.push(block);
      blocksByRequirement.set(this.getBlockKey(block), reqList);
    });

    const remainingCounts = new Map();
    blocksByRequirement.forEach((list, key) => {
      remainingCounts.set(key, list.length);
    });

    requests.forEach((req) => {
      const key = this.getRequestKey(req);
      const currentBlocks = remainingCounts.get(key) || 0;
      if (currentBlocks > 0) {
        remainingCounts.set(key, currentBlocks - 1);
        return;
      }
      const asignatura = this.dataStore.getAsignatura(req.asignaturaId);
      const baseDuration = Math.max(
        1,
        req.blockDuration ?? (asignatura?.duracionSegmentos || 1),
      );
      const kindPenalty =
        req.kind === "laboratorio" ? 60 : req.kind === "estudio" ? 35 : 0;
      score += 220 + baseDuration * 25 + kindPenalty;
    });

    const daysUsed = new Set(blocks.map((block) => block.day));
    const targetDays = Math.min(5, blocks.length);
    score += Math.max(0, targetDays - daysUsed.size) * 20;

    const dayLoads = Array.from({ length: 5 }, () => 0);
    const hoursByDay = Array.from({ length: 5 }, () => []);
    groupSessions.forEach((sesion) => {
      if (sesion.dia < 0 || sesion.dia >= 5) return;
      dayLoads[sesion.dia] += 1;
      hoursByDay[sesion.dia].push(sesion.hora);
    });
    const usedLoads = dayLoads.filter((load) => load > 0);
    if (usedLoads.length > 0) {
      score += Math.max(...usedLoads) - Math.min(...usedLoads);
    }

    const breakStats = this.getGroupBreakStats(grupoId);
    const breakTarget = groupSessions.length > 0
      ? this.getWeeklyAdvisoryBreakTarget()
      : 0;
    const missingBreaks = Math.max(
      0,
      breakTarget - breakStats.internalFreeSlots,
    );
    const breakDayTarget = this.getAdvisoryBreakDayTarget(daysUsed.size);
    const missingBreakDays = Math.max(
      0,
      breakDayTarget - breakStats.daysWithBreak,
    );
    // A half-hour between two classes is useful for advising and student
    // movement. Keep the target as a soft objective so hard constraints and
    // complete subject coverage always remain more important.
    score += missingBreaks * 9;
    score += missingBreakDays * 7;

    for (let day = 0; day < 5; day += 1) {
      const hours = hoursByDay[day].sort((a, b) => a - b);

      if (hours.length === 0) continue;

      const first = hours[0];
      const last = hours[hours.length - 1];
      const occupied = new Set(hours);

      let gapRun = 0;
      let halfHourBreaks = 0;
      let longGaps = 0;
      for (let h = first; h <= last; h += 1) {
        if (!occupied.has(h)) {
          gapRun += 1;
          continue;
        }
        if (gapRun === 1) halfHourBreaks += 1;
        if (gapRun > 1) {
          score += gapRun * 2;
          longGaps += 1;
        }
        gapRun = 0;
      }
      if (gapRun === 1) halfHourBreaks += 1;
      if (gapRun > 1) {
        score += gapRun * 2;
        longGaps += 1;
      }

      const blockCountForDay = blocks.filter((block) => block.day === day).length;
      if (blockCountForDay >= 3) {
        if (halfHourBreaks === 0) score += 6;
        else score -= Math.min(halfHourBreaks, 2) * 2;
      }
      if (halfHourBreaks > 0 && longGaps === 0) {
        score -= Math.min(halfHourBreaks, 2);
      }

      const window = this.getGroupTimeWindow(grupo);
      const preferredEnd = this.getPreferredGroupEnd(grupo);
      const edgeDistance =
        Math.abs(this.dataStore.hours.indexOf(window.inicio) - first) +
        Math.abs(this.dataStore.hours.indexOf(preferredEnd) - 1 - last);
      score += edgeDistance * 0.7;

      if (grupo.turno === "vespertino") {
        const hardEndIndex = this.dataStore.hours.indexOf(window.fin) - 1;
        if (last >= hardEndIndex) score += 4;
      }
    }

    this.getApplicableTutoriaRules(grupo).forEach((rule) => {
      const ruleDay = this.getDayIndex(rule.dia);

      const startIndex = this.getHourIndex(rule.inicio);
      const endIndex = this.getHourIndex(rule.fin);
      if (ruleDay == null || startIndex < 0 || endIndex < 0) return;

      const dayHours = hoursByDay[ruleDay] || [];

      const hasBefore = dayHours.some((hour) => hour < startIndex);
      const hasAfter = dayHours.some((hour) => hour >= endIndex);

      if (!hasBefore && !hasAfter) {
        score += 35;
        return;
      }
      if (!hasBefore || !hasAfter) {
        score += 18;
      }
    });

    blocksBySubject.forEach((subjectBlocks) => {
      subjectBlocks.sort((a, b) => a.day - b.day);

      for (let i = 0; i < subjectBlocks.length; i += 1) {
        for (let j = i + 1; j < subjectBlocks.length; j += 1) {
          const dayGap = Math.abs(subjectBlocks[i].day - subjectBlocks[j].day);
          if (dayGap === 1) score += 15;
          if (dayGap === 0) score += 100;
          if (dayGap === 4) score += 12;

          const hourGap = Math.abs(
            subjectBlocks[i].startHour - subjectBlocks[j].startHour,
          );
          score += Math.min(hourGap, 6) * 0.8;
        }
      }
    });

    return score;
  }
}
