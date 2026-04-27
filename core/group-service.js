const GroupService = {
  ensureProfesorMap(grupo) {
    if (!grupo.profesoresPorAsignatura || typeof grupo.profesoresPorAsignatura !== "object") {
      grupo.profesoresPorAsignatura = {};
    }
    return grupo.profesoresPorAsignatura;
  },

  ensureStructureMap(grupo) {
    if (!grupo.estructuraPorAsignatura || typeof grupo.estructuraPorAsignatura !== "object") {
      grupo.estructuraPorAsignatura = {};
    }
    return grupo.estructuraPorAsignatura;
  },

  getPlanAsignaturaIds(grupo) {
    const plan = Array.isArray(grupo?.planAsignaturas) ? grupo.planAsignaturas : [];
    return plan
      .map((item) => (typeof item === "string" ? item : item?.asignaturaId))
      .filter(Boolean);
  },

  getPlanAsignaturas(app, grupo) {
    const ids = new Set(this.getPlanAsignaturaIds(grupo));
    return app.data.asignaturas.filter((asignatura) => ids.has(asignatura.id));
  },

  getSessions(app, grupoId) {
    return app.horario.getSesionesByGrupo?.(grupoId) || [];
  },

  getRequiredBlocks(asignatura, variantKey = null) {
    return asignatura?.getRequiredBlocks?.(variantKey) || [];
  },

  getRequiredSegments(asignatura, variantKey = null) {
    return this.getRequiredBlocks(asignatura, variantKey).reduce(
      (total, block) => total + block.duration,
      0,
    );
  },

  getScheduledSegments(app, grupoId, asignaturaId) {
    return app.horario.sesiones.filter(
      (sesion) =>
        sesion.grupoId === grupoId && sesion.asignaturaId === asignaturaId,
    ).length;
  },

  hasSameSubjectOnDay(app, grupoId, asignaturaId, day) {
    return app.horario.sesiones.some(
      (sesion) =>
        sesion.grupoId === grupoId &&
        sesion.asignaturaId === asignaturaId &&
        sesion.dia === day,
    );
  },

  getScheduledBlocks(app, grupoId, asignaturaId) {
    const sessions = app.horario.sesiones
      .filter(
        (sesion) =>
          sesion.grupoId === grupoId && sesion.asignaturaId === asignaturaId,
      )
      .sort((a, b) => {
        if (a.dia !== b.dia) return a.dia - b.dia;
        return a.hora - b.hora;
      });

    const blocks = [];
    sessions.forEach((sesion) => {
      const kind = sesion.tipoSesion ?? "clase";
      const last = blocks[blocks.length - 1];
      if (
        last &&
        last.kind === kind &&
        last.dia === sesion.dia &&
        last.horaFin + 1 === sesion.hora
      ) {
        last.horaFin = sesion.hora;
        last.duration += 1;
        return;
      }

      blocks.push({
        kind,
        dia: sesion.dia,
        horaInicio: sesion.hora,
        horaFin: sesion.hora,
        duration: 1,
      });
    });

    return blocks;
  },

  clearScheduledSubjectSessions(app, grupoId, asignaturaId) {
    const before = app.horario.sesiones.length;
    app.horario.sesiones = app.horario.sesiones.filter(
      (sesion) =>
        !(sesion.grupoId === grupoId && sesion.asignaturaId === asignaturaId),
    );
    return before - app.horario.sesiones.length;
  },

  getVariantMatchSummary(requiredBlocks, scheduledBlocks) {
    const remaining = [...scheduledBlocks];
    let coveredCount = 0;

    const plan = requiredBlocks.map((block) => {
      const matchIndex = remaining.findIndex(
        (item) =>
          item.kind === block.kind &&
          (this.isSingleInstanceKind(block.kind) || item.duration === block.duration),
      );
      const covered = matchIndex >= 0;
      if (covered) {
        remaining.splice(matchIndex, 1);
        coveredCount += 1;
      }
      return { ...block, covered };
    });

    return {
      plan,
      coveredCount,
      extraScheduled: remaining.length,
      pendingBlocks: plan.filter((block) => !block.covered),
    };
  },

  isSingleInstanceKind(kind) {
    return kind === "laboratorio" || kind === "estudio";
  },

  getProfesorScheduleFitnessForBlocks(app, grupo, asignatura, profesor, pendingBlocks) {
    if (pendingBlocks.length === 0) {
      return {
        totalStarts: 0,
        feasibleBlocks: 0,
        blockedBlocks: 0,
      };
    }

    let totalStarts = 0;
    let feasibleBlocks = 0;

    pendingBlocks.forEach((block) => {
      const starts = this.countValidStartsForBlock(
        app,
        grupo,
        asignatura,
        profesor,
        block,
      );
      totalStarts += starts;
      if (starts > 0) feasibleBlocks += 1;
    });

    return {
      totalStarts,
      feasibleBlocks,
      blockedBlocks: pendingBlocks.length - feasibleBlocks,
    };
  },

  selectBestStructureVariant(app, grupo, asignatura) {
    const scheduledBlocks = this.getScheduledBlocks(app, grupo.id, asignatura.id);
    const assignedProfesor =
      this.getAssignedProfesor(app, grupo, asignatura.id) ||
      this.getSuggestedProfesor(app, grupo, asignatura.id);
    const variants = asignatura?.getBlockVariants?.() || [
      { key: "default", label: "Base", blocks: this.getRequiredBlocks(asignatura) },
    ];

    const scored = variants.map((variant, index) => {
      const match = this.getVariantMatchSummary(variant.blocks, scheduledBlocks);
      const fitness = assignedProfesor
        ? this.getProfesorScheduleFitnessForBlocks(
            app,
            grupo,
            asignatura,
            assignedProfesor,
            match.pendingBlocks,
          )
        : {
            totalStarts: 0,
            feasibleBlocks: 0,
            blockedBlocks: match.pendingBlocks.length,
          };

      const score =
        match.coveredCount * 500 -
        match.extraScheduled * 400 -
        match.pendingBlocks.length * 120 -
        fitness.blockedBlocks * 80 +
        fitness.feasibleBlocks * 25 +
        fitness.totalStarts +
        (variant.key === "default" ? 18 : 0) -
        index;

      return {
        key: variant.key,
        label: variant.label,
        score,
        match,
        fitness,
        variant,
      };
    });

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.match.extraScheduled !== b.match.extraScheduled) {
        return a.match.extraScheduled - b.match.extraScheduled;
      }
      if (a.fitness.blockedBlocks !== b.fitness.blockedBlocks) {
        return a.fitness.blockedBlocks - b.fitness.blockedBlocks;
      }
      if (a.fitness.totalStarts !== b.fitness.totalStarts) {
        return b.fitness.totalStarts - a.fitness.totalStarts;
      }
      return a.variant.blocks.length - b.variant.blocks.length;
    });

    return scored[0] || null;
  },

  getSelectedStructureVariantKey(app, grupo, asignatura) {
    return this.resolveStructureVariantKey(app, grupo, asignatura, { useVariants: true });
  },

  resolveStructureVariantKey(app, grupo, asignatura, { useVariants = true } = {}) {
    if (!useVariants) return "default";

    const structureMap = this.ensureStructureMap(grupo);
    const currentKey = structureMap[asignatura.id];
    const variants = asignatura?.getBlockVariants?.() || [];

    if (currentKey && variants.some((variant) => variant.key === currentKey)) {
      return currentKey;
    }

    const best = this.selectBestStructureVariant(app, grupo, asignatura);
    const chosenKey = best?.key || variants[0]?.key || "default";
    structureMap[asignatura.id] = chosenKey;
    return chosenKey;
  },

  getRequirementStatus(app, grupo, asignatura, { variantKey = null, useVariants = true } = {}) {
    const resolvedVariantKey =
      variantKey ||
      this.resolveStructureVariantKey(app, grupo, asignatura, { useVariants });
    const requiredBlocks = this.getRequiredBlocks(asignatura, resolvedVariantKey);
    const scheduledBlocks = this.getScheduledBlocks(app, grupo.id, asignatura.id);
    const match = this.getVariantMatchSummary(requiredBlocks, scheduledBlocks);

    return {
      requiredBlocks,
      scheduledBlocks,
      plan: match.plan,
      pendingBlocks: match.pendingBlocks,
      variantKey: resolvedVariantKey,
      variantLabel: asignatura?.getVariantLabel?.(resolvedVariantKey) || "Base",
      laboratorioCubierto: match.plan.some(
        (block) => block.kind === "laboratorio" && block.covered,
      ),
      estudioCubierto: match.plan.some(
        (block) => block.kind === "estudio" && block.covered,
      ),
    };
  },

  getBlockDurationForKind(app, grupo, asignatura, kind = "clase", { useVariants = true } = {}) {
    const status = this.getRequirementStatus(app, grupo, asignatura, { useVariants });
    const pendingMatch = status.pendingBlocks.find((block) => block.kind === kind);
    if (pendingMatch) return pendingMatch.duration;

    const requiredMatch = status.requiredBlocks.find((block) => block.kind === kind);
    if (requiredMatch) return requiredMatch.duration;

    if (kind === "estudio") return 2;
    return Math.max(1, asignatura?.duracionSegmentos || 1);
  },

  getPendingSegments(app, grupo, asignaturaId) {
    const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
    if (!asignatura) return 0;

    const variantKey = this.resolveStructureVariantKey(app, grupo, asignatura, {
      useVariants: true,
    });
    return Math.max(
      0,
      this.getRequiredSegments(asignatura, variantKey) -
        this.getScheduledSegments(app, grupo.id, asignaturaId),
    );
  },

  getGrupoTimeWindow(grupo) {
    if (grupo?.turno === "vespertino") {
      return { inicio: "14:00", fin: "20:00" };
    }
    return { inicio: "08:00", fin: "14:00" };
  },

  getProfesorTimeWindow(profesor) {
    if (profesor?.turno === "matutino") {
      return { inicio: "08:00", fin: "16:00" };
    }
    if (profesor?.turno === "vespertino") {
      return { inicio: "12:00", fin: "20:00" };
    }
    return { inicio: "08:00", fin: "20:00" };
  },

  hasProfesorTurnOverlapWithGrupo(profesor, grupo) {
    if (!profesor || !grupo) return false;

    const grupoWindow = this.getGrupoTimeWindow(grupo);
    const profesorWindow = this.getProfesorTimeWindow(profesor);
    return (
      profesorWindow.inicio < grupoWindow.fin &&
      profesorWindow.fin > grupoWindow.inicio
    );
  },

  getProfesorTurnAffinity(profesor, grupo) {
    if (!profesor || !grupo) return Number.POSITIVE_INFINITY;
    if (profesor.turno === grupo.turno) return 0;
    if (this.hasProfesorTurnOverlapWithGrupo(profesor, grupo)) return 1;
    return Number.POSITIVE_INFINITY;
  },

  compareProfesorLoad(loadA, loadB) {
    if (loadA.grupos !== loadB.grupos) return loadA.grupos - loadB.grupos;
    if (loadA.asignaciones !== loadB.asignaciones) {
      return loadA.asignaciones - loadB.asignaciones;
    }
    if (loadA.segmentosProgramados !== loadB.segmentosProgramados) {
      return loadA.segmentosProgramados - loadB.segmentosProgramados;
    }
    return 0;
  },

  isHourWithinWindow(app, hourIndex, window) {
    const label = app.hours?.[hourIndex];
    if (!label || !window) return false;
    return label >= window.inicio && label < window.fin;
  },

  buildCandidateHourRange(app, startHour, duration, grupoWindow, profesorWindow) {
    const hours = [];

    for (let offset = 0; offset < duration; offset += 1) {
      const hourIndex = startHour + offset;
      if (
        !this.isHourWithinWindow(app, hourIndex, grupoWindow) ||
        !this.isHourWithinWindow(app, hourIndex, profesorWindow)
      ) {
        return null;
      }
      hours.push(hourIndex);
    }

    return hours;
  },

  countValidStartsForBlock(app, grupo, asignatura, profesor, block) {
    const duration = Math.max(1, block?.duration || asignatura?.duracionSegmentos || 1);
    const grupoWindow = this.getGrupoTimeWindow(grupo);
    const profesorWindow = this.getProfesorTimeWindow(profesor);
    let count = 0;

    for (let day = 0; day < 5; day += 1) {
      if (this.hasSameSubjectOnDay(app, grupo.id, asignatura.id, day)) continue;

      for (let startHour = 0; startHour < (app.hours || []).length; startHour += 1) {
        const hourRange = this.buildCandidateHourRange(
          app,
          startHour,
          duration,
          grupoWindow,
          profesorWindow,
        );
        if (!hourRange) continue;

        let addedSegments = 0;
        let valid = true;

        for (const hourIndex of hourRange) {
          const check = Rules.validateSession(
            app.horario,
            profesor,
            grupo.id,
            null,
            day,
            hourIndex,
            asignatura.id,
            (asignatura.totalSegmentosSemana ?? null) - addedSegments,
            asignatura.academiaId,
            Rules.getAcademiaRoomOptions(app.data, asignatura.academiaId),
          );

          if (!check.valid) {
            valid = false;
            break;
          }

          addedSegments += 1;
        }

        if (valid) count += 1;
      }
    }

    return count;
  },

  getProfesorScheduleFitness(app, grupo, asignatura, profesor) {
    const status = this.getRequirementStatus(app, grupo, asignatura);
    return this.getProfesorScheduleFitnessForBlocks(
      app,
      grupo,
      asignatura,
      profesor,
      status.pendingBlocks || [],
    );
  },

  getCompatibleProfesores(app, grupo, asignaturaId) {
    const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
    if (!asignatura) return [];

    const assignedToGroup = new Set(
      app.data.profesores
        .filter((profesor) => (profesor.gruposAsignados || []).includes(grupo.id))
        .map((profesor) => profesor.id),
    );

    return app.data.profesores
      .filter(
        (profesor) =>
          profesor.activo !== false &&
          profesor.academiaId === asignatura.academiaId &&
          this.isProfesorCompatibleWithGrupoTurno(profesor, grupo),
      )
      .sort((a, b) => {
        const affinityA = this.getProfesorTurnAffinity(a, grupo);
        const affinityB = this.getProfesorTurnAffinity(b, grupo);
        const aAssigned = assignedToGroup.has(a.id) ? 0 : 1;
        const bAssigned = assignedToGroup.has(b.id) ? 0 : 1;
        if (affinityA !== affinityB) return affinityA - affinityB;
        if (aAssigned !== bAssigned) return aAssigned - bAssigned;
        return a.nombre.localeCompare(b.nombre, "es");
      });
  },

  getAssignedProfesorId(grupo, asignaturaId) {
    return this.ensureProfesorMap(grupo)[asignaturaId] || null;
  },

  getAssignedProfesor(app, grupo, asignaturaId) {
    const profesorId = this.getAssignedProfesorId(grupo, asignaturaId);
    return app.data.profesores.find((profesor) => profesor.id === profesorId) || null;
  },

  getProfesorLoadSummary(app, profesorId) {
    const gruposUnicos = new Set();
    let asignaciones = 0;

    app.data.grupos.forEach((grupo) => {
      const mapa = this.ensureProfesorMap(grupo);
      const materias = Object.entries(mapa)
        .filter(([, currentProfesorId]) => currentProfesorId === profesorId)
        .map(([asignaturaId]) => asignaturaId);

      if (materias.length > 0) {
        gruposUnicos.add(grupo.id);
        asignaciones += materias.length;
      }
    });

    const segmentosProgramados = app.horario.sesiones.filter(
      (sesion) => sesion.profesorId === profesorId,
    ).length;

    return {
      grupos: gruposUnicos.size,
      asignaciones,
      segmentosProgramados,
    };
  },

  getProfesorGroupIds(app, profesorId) {
    return app.data.grupos
      .filter((grupo) => {
        const mapa = this.ensureProfesorMap(grupo);
        return Object.values(mapa).some((currentProfesorId) => currentProfesorId === profesorId);
      })
      .map((grupo) => grupo.id);
  },

  getProfesorAssignedAcademiaSubjects(app, grupo, profesor) {
    if (!grupo || !profesor) return [];

    const mapa = this.ensureProfesorMap(grupo);
    return this.getPlanAsignaturas(app, grupo)
      .filter(
        (asignatura) =>
          asignatura.academiaId === profesor.academiaId &&
          mapa[asignatura.id] === profesor.id,
      )
      .map((asignatura) => asignatura.id);
  },

  getProfesorAvailableAcademiaSubjects(app, grupo, profesor) {
    if (!grupo || !profesor) return [];

    const mapa = this.ensureProfesorMap(grupo);
    return this.getPlanAsignaturas(app, grupo).filter((asignatura) => {
      if (asignatura.academiaId !== profesor.academiaId) return false;
      if (mapa[asignatura.id]) return false;
      return this.getCompatibleProfesores(app, grupo, asignatura.id).some(
        (candidate) => candidate.id === profesor.id,
      );
    });
  },

  getGroupLoadSummary(app, grupoId) {
    const sesiones = app.horario.sesiones.filter((sesion) => sesion.grupoId === grupoId);
    const dayLoads = Array.from({ length: 5 }, (_, day) =>
      sesiones.filter((sesion) => sesion.dia === day).length,
    );
    const usedLoads = dayLoads.filter((load) => load > 0);
    const maxLoad = usedLoads.length > 0 ? Math.max(...usedLoads) : 0;
    const minLoad = usedLoads.length > 0 ? Math.min(...usedLoads) : 0;
    const balanceGap = usedLoads.length > 0 ? maxLoad - minLoad : 0;
    const occupiedDays = usedLoads.length;
    const lockedSegments = sesiones.filter((sesion) => sesion.locked === true).length;

    return {
      segmentosProgramados: sesiones.length,
      occupiedDays,
      balanceGap,
      maxLoad,
      minLoad,
      lockedSegments,
      dayLoads,
    };
  },

  getAcademiaLoadSummary(app, academiaId) {
    const profesores = (app.data.profesores || []).filter(
      (profesor) => profesor.academiaId === academiaId && profesor.activo !== false,
    );
    const loads = profesores.map((profesor) => ({
      profesor,
      ...this.getProfesorLoadSummary(app, profesor.id),
    }));
    const segmentLoads = loads.map((item) => item.segmentosProgramados);
    const maxSegments = segmentLoads.length > 0 ? Math.max(...segmentLoads) : 0;
    const minSegments = segmentLoads.length > 0 ? Math.min(...segmentLoads) : 0;

    return {
      profesoresActivos: profesores.length,
      segmentosMaximos: maxSegments,
      segmentosMinimos: minSegments,
      brechaSegmentos: maxSegments - minSegments,
      cargas: loads,
    };
  },

  resetProfesorGrupoAssignments(app) {
    app.data.profesores.forEach((profesor) => {
      profesor.gruposAsignados = [];
    });
  },

  rebuildProfesorGroupLinks(app) {
    this.resetProfesorGrupoAssignments(app);

    app.data.grupos.forEach((grupo) => {
      const mapa = this.ensureProfesorMap(grupo);
      Object.values(mapa).forEach((profesorId) => {
        const profesor = app.data.profesores.find((item) => item.id === profesorId);
        if (!profesor) return;
        profesor.gruposAsignados = Array.isArray(profesor.gruposAsignados)
          ? profesor.gruposAsignados
          : [];
        if (!profesor.gruposAsignados.includes(grupo.id)) {
          profesor.gruposAsignados.push(grupo.id);
        }
      });
    });
  },

  assignProfesor(app, grupo, asignaturaId, profesorId) {
    this.ensureProfesorMap(grupo)[asignaturaId] = profesorId;

    const profesor = app.data.profesores.find((item) => item.id === profesorId);
    if (profesor) {
      profesor.gruposAsignados = Array.isArray(profesor.gruposAsignados)
        ? profesor.gruposAsignados
        : [];
      if (!profesor.gruposAsignados.includes(grupo.id)) {
        profesor.gruposAsignados.push(grupo.id);
      }
    }
  },

  compareProfesorAssignmentCandidates(app, grupo, asignatura, getFitness, minGroups, a, b) {
    const loadA = this.getProfesorLoadSummary(app, a.id);
    const loadB = this.getProfesorLoadSummary(app, b.id);
    const affinityA = this.getProfesorTurnAffinity(a, grupo);
    const affinityB = this.getProfesorTurnAffinity(b, grupo);
    const fitnessA = getFitness(a);
    const fitnessB = getFitness(b);
    const overloadA = Math.max(0, loadA.grupos - (minGroups + 1));
    const overloadB = Math.max(0, loadB.grupos - (minGroups + 1));
    const effectiveGroupsA = loadA.grupos + affinityA * 0.5;
    const effectiveGroupsB = loadB.grupos + affinityB * 0.5;

    if (overloadA !== overloadB) {
      return overloadA - overloadB;
    }

    if (loadA.grupos !== loadB.grupos && Math.abs(loadA.grupos - loadB.grupos) > 1) {
      return loadA.grupos - loadB.grupos;
    }

    if (fitnessA.blockedBlocks !== fitnessB.blockedBlocks) {
      return fitnessA.blockedBlocks - fitnessB.blockedBlocks;
    }

    if (fitnessA.feasibleBlocks !== fitnessB.feasibleBlocks) {
      return fitnessB.feasibleBlocks - fitnessA.feasibleBlocks;
    }

    if (fitnessA.totalStarts !== fitnessB.totalStarts) {
      return fitnessB.totalStarts - fitnessA.totalStarts;
    }

    if (effectiveGroupsA !== effectiveGroupsB) {
      return effectiveGroupsA - effectiveGroupsB;
    }

    const loadComparison = this.compareProfesorLoad(loadA, loadB);
    if (loadComparison !== 0) {
      return loadComparison;
    }

    if (affinityA !== affinityB) return affinityA - affinityB;

    return a.nombre.localeCompare(b.nombre, "es");
  },

  autoAssignProfesor(app, grupo, asignaturaId) {
    const compatibles = this.getCompatibleProfesores(app, grupo, asignaturaId);
    if (compatibles.length === 0) return null;
    const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
    if (!asignatura) return null;
    const fitnessCache = new Map();
    const getFitness = (profesor) => {
      if (!fitnessCache.has(profesor.id)) {
        fitnessCache.set(
          profesor.id,
          this.getProfesorScheduleFitness(app, grupo, asignatura, profesor),
        );
      }
      return fitnessCache.get(profesor.id);
    };
    const sortCandidates = (candidates) => {
      const minGroups = candidates.reduce((minValue, profesor) => {
        const load = this.getProfesorLoadSummary(app, profesor.id);
        return Math.min(minValue, load.grupos);
      }, Number.POSITIVE_INFINITY);
      return [...candidates].sort((a, b) =>
        this.compareProfesorAssignmentCandidates(
          app,
          grupo,
          asignatura,
          getFitness,
          minGroups,
          a,
          b,
        ),
      );
    };

    const sameTurnCandidates = compatibles.filter(
      (profesor) => this.getProfesorTurnAffinity(profesor, grupo) === 0,
    );
    const crossTurnCandidates = compatibles.filter(
      (profesor) => this.getProfesorTurnAffinity(profesor, grupo) === 1,
    );

    let chosen = null;

    if (sameTurnCandidates.length > 0) {
      const bestSameTurn = sortCandidates(sameTurnCandidates)[0];
      const sameTurnLoad = this.getProfesorLoadSummary(app, bestSameTurn.id);

      if (sameTurnLoad.grupos < 4) {
        chosen = bestSameTurn;
      } else {
        const eligibleCrossTurn = crossTurnCandidates.filter((profesor) => {
          const load = this.getProfesorLoadSummary(app, profesor.id);
          return load.grupos < sameTurnLoad.grupos;
        });

        chosen =
          eligibleCrossTurn.length > 0
            ? sortCandidates(eligibleCrossTurn)[0]
            : bestSameTurn;
      }
    } else {
      chosen = sortCandidates(compatibles)[0];
    }

    this.assignProfesor(app, grupo, asignaturaId, chosen.id);
    return chosen;
  },

  rebalanceAcademiaAssignments(app, academiaId) {
    if (!academiaId || academiaId === "__ALL__") return { changed: 0 };

    const affected = [];

    app.data.grupos.forEach((grupo) => {
      const planIds = this.getPlanAsignaturaIds(grupo);
      planIds.forEach((asignaturaId) => {
        const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
        if (!asignatura || asignatura.academiaId !== academiaId) return;
        affected.push({
          grupo,
          asignaturaId,
          previousProfesorId: this.getAssignedProfesorId(grupo, asignaturaId),
        });
      });
    });

    affected.sort((a, b) => {
      const asigA = app.data.asignaturas.find((item) => item.id === a.asignaturaId);
      const asigB = app.data.asignaturas.find((item) => item.id === b.asignaturaId);
      const diffA = (asigA?.duracionSegmentos || 1) * (asigA?.sesionesPorSemana || 1);
      const diffB = (asigB?.duracionSegmentos || 1) * (asigB?.sesionesPorSemana || 1);
      return diffB - diffA;
    });

    affected.forEach(({ grupo, asignaturaId }) => {
      this.ensureProfesorMap(grupo)[asignaturaId] = null;
    });

    this.rebuildProfesorGroupLinks(app);

    let changed = 0;

    affected.forEach(({ grupo, asignaturaId, previousProfesorId }) => {
      const profesor = this.autoAssignProfesor(app, grupo, asignaturaId);
      const nextProfesorId = profesor?.id || null;
      if (!nextProfesorId) return;

      if (previousProfesorId !== nextProfesorId) changed += 1;

      app.horario.sesiones.forEach((sesion) => {
        if (sesion.grupoId === grupo.id && sesion.asignaturaId === asignaturaId) {
          sesion.profesorId = nextProfesorId;
        }
      });
    });

    this.rebuildProfesorGroupLinks(app);
    return { changed };
  },

  ensureProfesorAssignments(app, grupo) {
    this.getPlanAsignaturaIds(grupo).forEach((asignaturaId) => {
      const assigned = this.getAssignedProfesor(app, grupo, asignaturaId);
      if (assigned) return;
      this.autoAssignProfesor(app, grupo, asignaturaId);
    });
  },

  autoAssignProfesores(app) {
    let assignedNow = 0;
    let alreadyAssigned = 0;

    (app.data.grupos || []).forEach((grupo) => {
      this.getPlanAsignaturaIds(grupo).forEach((asignaturaId) => {
        const existing = this.getAssignedProfesor(app, grupo, asignaturaId);
        if (existing) {
          alreadyAssigned += 1;
          return;
        }
        const profesor = this.autoAssignProfesor(app, grupo, asignaturaId);
        if (profesor) assignedNow += 1;
      });
    });

    this.rebuildProfesorGroupLinks(app);
    return {
      grupos: (app.data.grupos || []).length,
      asignadosNuevos: assignedNow,
      yaAsignados: alreadyAssigned,
      totalAsignaciones: alreadyAssigned + assignedNow,
    };
  },

  isProfesorCompatibleWithGrupoTurno(profesor, grupo) {
    return Number.isFinite(this.getProfesorTurnAffinity(profesor, grupo));
  },

  getSuggestedProfesor(app, grupo, asignaturaId) {
    return this.getCompatibleProfesores(app, grupo, asignaturaId)[0] || null;
  },

  buildAsignaturaSummaries(app, grupo, { useVariants = true } = {}) {
    return this.getPlanAsignaturas(app, grupo).map((asignatura) => {
      const programados = this.getScheduledSegments(app, grupo.id, asignatura.id);
      const requeridos = this.getRequiredSegments(asignatura);
      const pendientes = Math.max(0, requeridos - programados);
      const status = this.getRequirementStatus(app, grupo, asignatura, { useVariants });
      const sugerido =
        this.getAssignedProfesor(app, grupo, asignatura.id) ||
        this.getSuggestedProfesor(app, grupo, asignatura.id);

      return {
        asignatura,
        programados,
        requeridos,
        pendientes,
        variantKey: status.variantKey,
        variantLabel: status.variantLabel,
        bloquesProgramados: status.scheduledBlocks.length,
        bloquesRequeridos: status.requiredBlocks.length,
        pendientesBloque: status.pendingBlocks.length,
        estudioRequerido: status.requiredBlocks.some((block) => block.kind === "estudio"),
        estudioPendiente: status.pendingBlocks.some((block) => block.kind === "estudio"),
        laboratorioRequerido: status.requiredBlocks.some(
          (block) => block.kind === "laboratorio",
        ),
        laboratorioPendiente: status.pendingBlocks.some(
          (block) => block.kind === "laboratorio",
        ),
        profesorAsignado: sugerido,
      };
    });
  },

  buildSchedulePlan(app, grupo, { includeCovered = false, useVariants = true } = {}) {
    const requests = [];

    this.getPlanAsignaturas(app, grupo).forEach((asignatura) => {
      const profesorId =
        this.getAssignedProfesor(app, grupo, asignatura.id)?.id || null;
      const status = this.getRequirementStatus(app, grupo, asignatura, { useVariants });

      const blocks = includeCovered ? status.requiredBlocks : status.pendingBlocks;
      blocks.forEach((block) => {
        requests.push({
          asignaturaId: asignatura.id,
          profesorId,
          kind: block.kind,
          blockDuration: block.duration,
          variantKey: status.variantKey,
        });
      });
    });

    return requests;
  },

  buildScheduleRequest(app, grupo, { useVariants = true } = {}) {
    return this.buildSchedulePlan(app, grupo, { includeCovered: false, useVariants });
  },

  buildFullSchedulePlan(app, grupo, { useVariants = true } = {}) {
    return this.buildSchedulePlan(app, grupo, { includeCovered: true, useVariants });
  },
};
