/**
 * Semi-Automatic Scheduler
 */

class Scheduler {
  constructor(horario, dataStore) {
    this.horario = horario;
    this.dataStore = dataStore;
  }

  scheduleGroup(grupoId, asignaturasToSchedule, { optimizeOptions = {} } = {}) {
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

    const optimizationRequests = this.buildOptimizationRequests(grupo.id, sortedRequests);
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
    if (grupo.turno === "vespertino") {
      return { inicio: "14:00", fin: "20:00" };
    }
    return { inicio: "08:00", fin: "14:00" };
  }

  getPreferredGroupEnd(grupo) {
    if (grupo.turno === "vespertino") return "19:30";
    return "14:00";
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

    if (profesor?.turno === "matutino") {
      return label >= "08:00" && label < "16:00";
    }

    if (profesor?.turno === "vespertino") {
      return label >= "12:00" && label < "20:00";
    }

    return true;
  }

  getAllowedHourIndices(grupo) {
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
    randomizeTop = false,
    excludeBlock = null,
  }) {
    const candidates = this.collectCandidates({
      grupo,
      asignatura,
      profesores,
      dur,
      kind,
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
    excludeBlock = null,
  }) {
    const allowedHours = this.getAllowedHourIndices(grupo);
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

  validateCandidate(grupo, asignatura, profesor, day, hourRange, kind = "clase") {
    let addedSegments = 0;

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
        (asignatura.totalSegmentosSemana ?? null) - addedSegments,
        asignatura.academiaId,
        this.getAcademiaRoomOptions(asignatura.academiaId),
      );

      if (!check.valid) return check;
      addedSegments += 1;
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
        last.endHour + 1 === sesion.hora
      ) {
        last.endHour = sesion.hora;
        last.hours.push(sesion.hora);
        return;
      }

      blocks.push({
        grupoId,
        asignaturaId: sesion.asignaturaId,
        profesorId: sesion.profesorId,
        kind: sesion.tipoSesion ?? "clase",
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
    this.horario.sesiones = this.horario.sesiones.filter(
      (sesion) =>
        !(
          sesion.grupoId === grupoId &&
          sesion.asignaturaId === block.asignaturaId &&
          sesion.profesorId === block.profesorId &&
          (sesion.tipoSesion ?? "clase") === (block.kind ?? "clase") &&
          sesion.dia === block.day &&
          hourSet.has(sesion.hora)
        ),
    );
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

  buildOptimizationRequests(grupoId, pendingRequests = []) {
    const currentBlocks = this.getBlocksForGroup(grupoId).map((block) => ({
      asignaturaId: block.asignaturaId,
      profesorId: block.profesorId ?? null,
      kind: block.kind || "clase",
      blockDuration: Math.max(1, block.hours?.length || 1),
      horasPendientes: Math.max(1, block.hours?.length || 1),
    }));

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
        const hardEndIndex = this.dataStore.hours.indexOf("20:00") - 1;
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
