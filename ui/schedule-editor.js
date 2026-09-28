const ScheduleEditor = {
  shouldUseVariants(app) {
    return app?.autoScheduleUseVariants === true;
  },

  estimateGroupDifficulty(app, scheduler, grupo) {
    GroupService.ensureProfesorAssignments(app, grupo);
    const requests = GroupService.buildScheduleRequest(app, grupo, {
      useVariants: this.shouldUseVariants(app),
    });
    const pendingSegments = requests.reduce(
      (sum, req) => sum + Math.max(1, req.blockDuration || 1),
      0,
    );
    const blockedSlots = app.horario.bloqueos.filter(
      (bloqueo) => bloqueo.scope === "GRUPO" && bloqueo.targetId === grupo.id,
    ).length;
    const requestDifficulty = requests.reduce(
      (sum, req) => sum + scheduler.getRequestDifficulty(req),
      0,
    );

    return requestDifficulty + pendingSegments * 10 + blockedSlots + (grupo.grado || 0) * 6;
  },

  sortGroupsForGlobalSchedule(app, scheduler, groups) {
    const useVariants = this.shouldUseVariants(app);
    const metrics = groups.map((grupo) => {
      GroupService.ensureProfesorAssignments(app, grupo);
      const pendingRequests = GroupService.buildScheduleRequest(app, grupo, {
        useVariants,
      });
      const fullPlan = GroupService.buildFullSchedulePlan(app, grupo, {
        useVariants,
      });
      const pendingSegments = pendingRequests.reduce(
        (sum, request) => sum + Math.max(1, request.blockDuration || 1),
        0,
      );
      const requestDifficulty = pendingRequests.reduce(
        (sum, request) => sum + scheduler.getRequestDifficulty(request),
        0,
      );
      const blockedSlots = app.horario.bloqueos.filter(
        (bloqueo) => bloqueo.scope === "GRUPO" && bloqueo.targetId === grupo.id,
      ).length;
      const evaluation = scheduler.evaluateGroupSchedule(grupo.id, fullPlan);

      return {
        grupo,
        pendingRequests: pendingRequests.length,
        pendingSegments,
        evaluation,
        difficulty:
          requestDifficulty +
          pendingSegments * 10 +
          blockedSlots +
          (grupo.grado || 0) * 6,
      };
    });

    metrics.sort((a, b) => {
      const aHasPending = a.pendingRequests > 0;
      const bHasPending = b.pendingRequests > 0;
      if (aHasPending !== bHasPending) return aHasPending ? -1 : 1;
      if (aHasPending && a.pendingSegments !== b.pendingSegments) {
        return b.pendingSegments - a.pendingSegments;
      }
      if (a.evaluation !== b.evaluation) {
        if (!Number.isFinite(a.evaluation)) return -1;
        if (!Number.isFinite(b.evaluation)) return 1;
        // Lower scores are better, so work on the worst groups first.
        return b.evaluation - a.evaluation;
      }
      if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
      return a.grupo.nombre.localeCompare(b.grupo.nombre, "es");
    });

    return metrics.map((item) => item.grupo);
  },

  getSuggestedSessionKind(app, grupo, asignaturaId) {
    const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
    if (!asignatura) return "clase";

    const status = GroupService.getRequirementStatus(app, grupo, asignatura, {
      useVariants: true,
    });
    const pendingKinds = status.pendingBlocks.map((block) => block.kind);

    if (pendingKinds.includes("laboratorio")) return "laboratorio";
    if (pendingKinds.includes("estudio")) return "estudio";
    if (pendingKinds.includes("clase")) return "clase";
    return "clase";
  },

  openSessionDialog(app, day, hour, session = null) {
    const grupo = app.currentView?.entity;
    if (!grupo || app.currentView?.type !== "GRUPO") return;
    GroupService.ensureProfesorAssignments(app, grupo);

    document.getElementById("input-day").value = day;
    document.getElementById("input-hour").value = hour;

    const asignaturas = GroupService.getPlanAsignaturas(app, grupo);
    Views.populateSelect("select-asignatura", asignaturas, "nombre");

    const selectAsignatura = document.getElementById("select-asignatura");
    const selectSessionKind = document.getElementById("select-session-kind");
    const selectProfesor = document.getElementById("select-profesor");
    const selectAula = document.getElementById("select-aula");
    const inputSessionLocked = document.getElementById("input-session-locked");
    const durationHint = document.getElementById("session-duration-hint");

    const buildKindOptions = (asignatura, selectedKind = "") => {
      const status =
        asignatura && grupo
          ? GroupService.getRequirementStatus(app, grupo, asignatura, {
              useVariants: true,
            })
          : null;
      const requiredKinds = new Set(
        (status?.requiredBlocks || []).map((block) => block.kind || "clase"),
      );
      const options = [{ id: "clase", nombre: "Clase" }];
      if (requiredKinds.has("estudio")) {
        options.push({ id: "estudio", nombre: "Estudio" });
      }
      if (requiredKinds.has("laboratorio")) {
        options.push({ id: "laboratorio", nombre: "Laboratorio" });
      }

      Views.populateSelect(selectSessionKind, options, "nombre");
      selectSessionKind.value =
        options.some((item) => item.id === selectedKind)
          ? selectedKind
          : options[0]?.id || "clase";
    };

    const getDurationForKind = (asignatura, kind) => {
      if (!asignatura || !grupo) return kind === "estudio" ? 2 : 1;
      return GroupService.getBlockDurationForKind(app, grupo, asignatura, kind, {
        useVariants: true,
      });
    };

    const syncDependentSelects = (
      asignaturaId,
      preferredProfesorId = "",
      preferredAulaId = "",
      preferredKind = "",
    ) => {
      const asignatura = app.data.asignaturas.find((item) => item.id === asignaturaId);
      const suggestedKind =
        preferredKind || this.getSuggestedSessionKind(app, grupo, asignaturaId);
      buildKindOptions(asignatura, suggestedKind);
      const profesorAsignado = GroupService.getAssignedProfesor(
        app,
        grupo,
        asignaturaId,
      );
      const profesores = profesorAsignado
        ? [profesorAsignado]
        : SessionService.getAllowedProfesores(app, grupo, asignaturaId);
      const aulas = SessionService.getAllowedAulas(
        app,
        asignaturaId,
        selectSessionKind.value,
      );

      Views.populateSelect(selectProfesor, profesores, "nombre");
      Views.populateSelect(
        selectAula,
        [{ id: "", nombre: "Sin asignar" }, ...aulas],
        "nombre",
      );

      if (preferredProfesorId && profesores.some((p) => p.id === preferredProfesorId)) {
        selectProfesor.value = preferredProfesorId;
      } else {
        selectProfesor.value = profesores[0]?.id || "";
      }
      selectProfesor.disabled = !!profesorAsignado;

      if (preferredAulaId && aulas.some((a) => a.id === preferredAulaId)) {
        selectAula.value = preferredAulaId;
      } else {
        selectAula.value = "";
      }

      if (durationHint) {
        const segmentos = getDurationForKind(asignatura, selectSessionKind.value);
        const minutos = segmentos * 30;
        durationHint.textContent =
          `Se guardara como un bloque de ${segmentos} segmento(s) (${minutos} min).`;
      }
    };

    if (session) {
      app.groupEditorEditingSession = session;
      app.groupEditorSelectedAsignaturaId = session.asignaturaId;
      selectAsignatura.value = session.asignaturaId;
      syncDependentSelects(
        session.asignaturaId,
        session.profesorId,
        session.aulaId,
        session.tipoSesion || "clase",
      );
      if (inputSessionLocked) inputSessionLocked.checked = session.locked === true;
      document.getElementById("form-delete-session").style.display =
        "inline-block";
    } else {
      app.groupEditorEditingSession = null;
      const preferredAsignaturaId =
        app.groupEditorSelectedAsignaturaId &&
        asignaturas.some((item) => item.id === app.groupEditorSelectedAsignaturaId)
          ? app.groupEditorSelectedAsignaturaId
          : asignaturas[0]?.id || "";

      selectAsignatura.value = preferredAsignaturaId;
      syncDependentSelects(
        selectAsignatura.value,
        "",
        "",
        this.getSuggestedSessionKind(app, grupo, preferredAsignaturaId),
      );
      if (inputSessionLocked) inputSessionLocked.checked = false;
      document.getElementById("form-delete-session").style.display = "none";
    }

    selectAsignatura.onchange = () => {
      app.groupEditorSelectedAsignaturaId = selectAsignatura.value || null;
      syncDependentSelects(
        selectAsignatura.value,
        "",
        "",
        this.getSuggestedSessionKind(app, grupo, selectAsignatura.value),
      );
    };

    selectSessionKind.onchange = () => {
      syncDependentSelects(
        selectAsignatura.value,
        selectProfesor.value,
        selectAula.value,
        selectSessionKind.value,
      );
    };

    Dialogs.open("dialog-session");
  },

  saveSession(app) {
    const v = app.currentView;
    if (!v || v.type !== "GRUPO" || !v.entity) return;

    const day = parseInt(document.getElementById("input-day").value, 10);
    const hour = parseInt(document.getElementById("input-hour").value, 10);
    const asignaturaId = document.getElementById("select-asignatura").value;
    const tipoSesion = document.getElementById("select-session-kind").value || "clase";
    const profesorId = document.getElementById("select-profesor").value;
    const aulaId = document.getElementById("select-aula").value;
    const locked = document.getElementById("input-session-locked")?.checked === true;

    if (!asignaturaId || !profesorId) {
      alert("Asignatura y profesor son obligatorios");
      return;
    }

    const grupo = v.entity;
    const validation = SessionService.saveGroupSession(app, {
      grupoId: grupo.id,
      asignaturaId,
      tipoSesion,
      profesorId,
      aulaId,
      locked,
      day,
      hour,
      existingSession: app.groupEditorEditingSession || null,
    });

    if (!validation.valid) {
      alert(`Error: ${validation.error}`);
      return;
    }

    Dialogs.close("dialog-session");
    app.groupEditorEditingSession = null;
    GroupView.renderEditor(app);
    app.refreshGrid();
  },

  deleteSession(app) {
    const v = app.currentView;
    if (!v || v.type !== "GRUPO" || !v.entity) return;

    const day = parseInt(document.getElementById("input-day").value, 10);
    const hour = parseInt(document.getElementById("input-hour").value, 10);
    SessionService.removeBlockSessions(
      app,
      v.entity.id,
      day,
      hour,
      app.groupEditorEditingSession || null,
    );

    Dialogs.close("dialog-session");
    app.groupEditorEditingSession = null;
    GroupView.renderEditor(app);
    app.refreshGrid();
  },

  async runAutoSchedule(app) {
    const v = app.currentView;
    if (!v || v.type !== "GRUPO" || !v.entity) {
      alert("Selecciona un grupo para programar.");
      return;
    }

    const grupo = v.entity;
    GroupService.ensureProfesorAssignments(app, grupo);
    const scheduler = new Scheduler(app.horario, this.buildDataStore(app));
    const useVariants = this.shouldUseVariants(app);
    const cleanup = scheduler.cleanupOverassignedBlocks(grupo.id, { useVariants });
    const pendingBefore = GroupService.buildScheduleRequest(app, grupo, {
      useVariants,
    });
    app.setAutomationBusy(true);
    app.setAutomationProgress({
      label: "Autoprogramando grupo",
      detail: `Procesando ${grupo.nombre}...`,
      current: 0,
      total: 1,
    });
    try {
      await app.pauseForUi();

      let report = { assigned: [], unassigned: [] };
      if (pendingBefore.length > 0) {
        report = scheduler.scheduleGroup(grupo.id, pendingBefore, {
          optimizeOptions: {
            childrenPerGeneration: 35,
            generations: 35,
            maxMilliseconds: 1800,
            stopAfterStaleGenerations: 8,
          },
          useVariants,
        });
      }

      const pendingAfter = GroupService.buildScheduleRequest(app, grupo, {
        useVariants,
      });
      const fullPlanAfter = GroupService.buildFullSchedulePlan(app, grupo, {
        useVariants,
      });
      const shouldImprove =
        pendingBefore.length === 0 ||
        report.assigned.length === 0;
      const improvement = shouldImprove
        ? scheduler.improveGroupSchedule(grupo.id, fullPlanAfter, {
            childrenPerGeneration: 35,
            generations: 35,
            maxMilliseconds: 1800,
            stopAfterStaleGenerations: 8,
          })
        : null;
      const finalScore = scheduler.evaluateGroupSchedule(grupo.id, fullPlanAfter);
      GroupView.renderEditor(app);
      app.refreshGrid();

      const detailParts = [];
      if (report.assigned.length > 0) {
        detailParts.push(`${report.assigned.length} bloque(s) agregados`);
      }
      if (report.duplicatesRemoved > 0) {
        detailParts.push(`${report.duplicatesRemoved} segmento(s) especial(es) duplicado(s) removido(s)`);
      }
      if (cleanup.removedSessions > 0) {
        detailParts.push(`${cleanup.removedSessions} segmento(s) excedente(s) corregido(s)`);
      }
      if (cleanup.lockedExtras > 0) {
        detailParts.push(`${cleanup.lockedExtras} segmento(s) excedente(s) bloqueado(s)`);
      }
      if (improvement) {
        detailParts.push("distribucion refinada");
      }
      if (pendingAfter.length > 0) {
        detailParts.push(`${pendingAfter.length} bloque(s) pendientes`);
      }
      if (detailParts.length === 0) {
        detailParts.push("sin cambios");
      }

      app.setAutomationProgress({
        label: "Autoprogramacion completada",
        detail: `${grupo.nombre}: ${detailParts.join(" | ")}${useVariants ? " | variantes activas" : " | estructura base"}`,
        current: 1,
        total: 1,
        state: "success",
        autoHideMs: 5000,
      });

      let msg = `Bloques pendientes antes: ${pendingBefore.length}\n`;
      msg += `Bloques agregados: ${report.assigned.length}\n`;
      if (report.duplicatesRemoved > 0) {
        msg += `Duplicados especiales removidos: ${report.duplicatesRemoved} segmento(s)\n`;
      }
      if (cleanup.removedSessions > 0) {
        msg += `Excedentes corregidos: ${cleanup.removedSessions} segmento(s)\n`;
      }
      if (cleanup.lockedExtras > 0) {
        msg += `Excedentes bloqueados conservados: ${cleanup.lockedExtras} segmento(s)\n`;
      }
      msg += `Bloques pendientes despues: ${pendingAfter.length}\n`;
      if (report.unassigned.length > 0) {
        msg += `No asignadas en este intento: ${report.unassigned.length}\n`;
        report.unassigned.forEach((u) => {
          msg += `- ${u.asignatura}: ${u.reason}\n`;
          const diagnosticLabels = {
            same_day_duplicate: "mismo dia ocupado",
            outside_group_window: "fuera del turno",
            professor_turn: "turno del profesor",
            blocked_slot: "bloqueos",
            professor_conflict: "profesor ocupado",
            group_conflict: "grupo ocupado",
            academy_room: "salon de academia ocupado",
            weekly_limit: "limite semanal",
            no_professor: "sin profesor",
            no_candidate: "sin hueco valido",
          };
          const diagnostics = u.diagnostics?.counts || {};
          const details = Object.entries(diagnostics)
            .filter(([, value]) => Number(value) > 0)
            .slice(0, 3)
            .map(([key, value]) => `${diagnosticLabels[key] || key}: ${value}`)
            .join(", ");
          if (details) {
            msg += `  Detalle: ${details}\n`;
          }
        });
      }
      if (improvement) {
        msg += `Mejora de evaluacion: ${improvement.beforeScore} -> ${improvement.afterScore}\n`;
      }
      msg += `Evaluacion actual: ${finalScore}\n`;
      msg += `Modo de estructura: ${useVariants ? "variantes activas" : "base"}\n`;
      alert(msg);
    } catch (error) {
      console.error("Error al autoprogramar el grupo", error);
      const detail = error?.message || "Ocurrió un error inesperado.";
      app.setAutomationProgress({
        label: "Autoprogramación detenida",
        detail: `${grupo.nombre}: ${detail}`,
        state: "error",
        autoHideMs: 8000,
      });
      alert(`No se pudo completar la autoprogramación de ${grupo.nombre}.\n${detail}`);
    } finally {
      app.setAutomationBusy(false);
    }
  },

  async runAutoScheduleAll(app) {
    if (!Array.isArray(app.data.grupos) || app.data.grupos.length === 0) {
      alert("No hay grupos para programar.");
      return;
    }

    const scheduler = new Scheduler(app.horario, this.buildDataStore(app));
    const useVariants = this.shouldUseVariants(app);
    const cleanupTotals = app.data.grupos.reduce(
      (totals, grupo) => {
        const cleanup = scheduler.cleanupOverassignedBlocks(grupo.id, { useVariants });
        totals.removedSessions += cleanup.removedSessions;
        totals.lockedExtras += cleanup.lockedExtras;
        return totals;
      },
      { removedSessions: 0, lockedExtras: 0 },
    );
    const incrementalMode = (app.horario.sesiones || []).length > 0;
    const globalLabel = incrementalMode
      ? "Mejorando horarios"
      : "Autoprogramando todo";
    const orderedGroups = this.sortGroupsForGlobalSchedule(
      app,
      scheduler,
      app.data.grupos,
    );

    const summary = {
      gruposProcesados: new Set(),
      sesionesAgregadas: 0,
      duplicadosRemovidos: 0,
      gruposConPendientes: [],
      gruposParaRevisar: new Set(),
      intercambiosGlobales: 0,
    };
    app.setAutomationBusy(true);
    let totalSteps = orderedGroups.length;
    const globalOptimizeOptions = {
      childrenPerGeneration: 22,
      generations: 22,
      maxMilliseconds: 750,
      stopAfterStaleGenerations: 5,
    };

    const runPass = async (groups, passIndex, passCount, startOffset, total) => {
      for (let i = 0; i < groups.length; i += 1) {
        const grupo = groups[i];
        const step = startOffset + i + 1;
        app.setAutomationProgress({
          label: `${globalLabel} (pasada ${passIndex}/${passCount})`,
          detail: `Preparando ${grupo.nombre}`,
          current: step,
          total: Math.max(1, total),
        });
        await app.pauseForUi();
        GroupService.ensureProfesorAssignments(app, grupo);
        const requests = GroupService.buildScheduleRequest(app, grupo, {
          useVariants,
        });
        if (requests.length > 0) {
          app.setAutomationProgress({
            label: `${globalLabel} (pasada ${passIndex}/${passCount})`,
            detail: `${grupo.nombre}: colocando ${requests.length} bloque(s)`,
            current: step,
            total: Math.max(1, total),
          });
          await app.pauseForUi();
          const report = scheduler.scheduleGroup(grupo.id, requests, {
            optimizeOptions: globalOptimizeOptions,
            useVariants,
          });
          summary.sesionesAgregadas += report.assigned.length;
      summary.duplicadosRemovidos += report.duplicatesRemoved || 0;
        }

        if (requests.length === 0) {
          const fullPlan = GroupService.buildFullSchedulePlan(app, grupo, {
            useVariants,
          });
          app.setAutomationProgress({
            label: `${globalLabel} (pasada ${passIndex}/${passCount})`,
            detail: `${grupo.nombre}: mejorando distribucion`,
            current: step,
            total: Math.max(1, total),
          });
          await app.pauseForUi();
          scheduler.improveGroupSchedule(grupo.id, fullPlan, globalOptimizeOptions);
        }

        app.setAutomationProgress({
          label: `${globalLabel} (pasada ${passIndex}/${passCount})`,
          detail: `${grupo.nombre}: revisando pendientes`,
          current: step,
          total: Math.max(1, total),
        });
        await app.pauseForUi();
        let remaining = GroupService.buildScheduleRequest(app, grupo, {
          useVariants,
        });

        if (remaining.length > 0) {
          app.setAutomationProgress({
            label: `${globalLabel} (pasada ${passIndex}/${passCount})`,
            detail: `${grupo.nombre}: intentando intercambio global`,
            current: step,
            total: Math.max(1, total),
          });
          await app.pauseForUi();
          const repair = scheduler.repairGroupScheduleGlobally(
            grupo.id,
            remaining,
            {
              maxCandidates: 36,
              maxDisplacedBlocks: 4,
            },
          );
          summary.sesionesAgregadas += repair.assigned.length;
          summary.intercambiosGlobales += repair.movedBlocks;
          repair.displacedGroupIds.forEach((groupId) => {
            summary.gruposParaRevisar.add(groupId);
          });
          remaining = GroupService.buildScheduleRequest(app, grupo, {
            useVariants,
          });
        }

        if (remaining.length === 0) {
          // no-op
        } else {
          summary.gruposConPendientes.push({
            id: grupo.id,
            nombre: grupo.nombre,
            pendientes: remaining.length,
          });
        }
        summary.gruposProcesados.add(grupo.id);
      }
    };

    try {
      await runPass(orderedGroups, 1, 2, 0, totalSteps);

      const secondPassIds = new Set(
        summary.gruposConPendientes.map((item) => item.id),
      );
      summary.gruposParaRevisar.forEach((groupId) => secondPassIds.add(groupId));

      if (secondPassIds.size > 0) {
        const secondPassGroups = app.data.grupos.filter((grupo) =>
          secondPassIds.has(grupo.id),
        );
        const secondPassOrderedGroups = this.sortGroupsForGlobalSchedule(
          app,
          scheduler,
          secondPassGroups,
        );
        totalSteps += secondPassGroups.length;
        summary.gruposConPendientes = [];
        summary.gruposParaRevisar.clear();
        await runPass(
          secondPassOrderedGroups,
          2,
          2,
          orderedGroups.length,
          totalSteps,
        );
      }

      if (app.currentView?.type === "GRUPO" && app.currentView?.entity) {
        GroupView.renderEditor(app);
      }
      app.refreshGrid();

      const finalPendingItems = app.data.grupos
        .map((grupo) => ({
          grupo,
          pendientes: GroupService.buildScheduleRequest(app, grupo, { useVariants })
            .length,
        }))
        .filter((item) => item.pendientes > 0)
        .sort((a, b) => {
          if (a.pendientes !== b.pendientes) return b.pendientes - a.pendientes;
          return a.grupo.nombre.localeCompare(b.grupo.nombre, "es");
        });
      const finalPendings = finalPendingItems.map((item) => item.grupo);

      let msg = `Grupos procesados: ${summary.gruposProcesados.size}\n`;
      msg += `Sesiones agregadas: ${summary.sesionesAgregadas}\n`;
      msg += `Intercambios globales: ${summary.intercambiosGlobales}\n`;
      msg += `Duplicados especiales removidos: ${summary.duplicadosRemovidos}\n`;
      if (cleanupTotals.removedSessions > 0) {
        msg += `Excedentes corregidos: ${cleanupTotals.removedSessions} segmento(s)\n`;
      }
      if (cleanupTotals.lockedExtras > 0) {
        msg += `Excedentes bloqueados conservados: ${cleanupTotals.lockedExtras} segmento(s)\n`;
      }
      msg += `Grupos completos: ${
        app.data.grupos.length - finalPendings.length
      }/${app.data.grupos.length}\n`;

      if (finalPendings.length > 0) {
        msg += "Grupos con pendientes:\n";
        finalPendingItems.forEach(({ grupo, pendientes }) => {
          msg += `- ${grupo.nombre}: ${pendientes} bloque(s)\n`;
        });
      }
      msg += `Modo de estructura: ${useVariants ? "variantes activas" : "base"}\n`;
      msg += `Operacion: ${incrementalMode ? "mejora incremental (sesiones conservadas)" : "llenado inicial"}\n`;

      app.setAutomationProgress({
        label: "Autoprogramacion global completada",
        detail: `Grupos completos: ${
          app.data.grupos.length - finalPendings.length
        }/${app.data.grupos.length}${useVariants ? " | variantes activas" : " | estructura base"}`,
        current: totalSteps,
        total: totalSteps,
        state: "success",
        autoHideMs: 6000,
      });
      alert(msg);
    } catch (error) {
      console.error(error);
      app.setAutomationProgress({
        label: "Autoprogramacion detenida",
        detail: error?.message || "Ocurrio un error durante el llenado automatico.",
        state: "error",
      });
      alert("La autoprogramacion se detuvo. Revisa la consola para ver el detalle tecnico.");
    } finally {
      app.setAutomationBusy(false);
    }
  },

  buildDataStore(app) {
    return {
      data: app.data,
      getGrupo: (id) => app.data.grupos.find((g) => g.id === id),
      getAsignatura: (id) => app.data.asignaturas.find((a) => a.id === id),
      getAcademia: (id) => app.data.academias.find((a) => a.id === id),
      getProfesor: (id) => app.data.profesores.find((p) => p.id === id),
      getProfesoresByAcademia: (academiaId) =>
        app.data.profesores.filter((p) => p.academiaId === academiaId),
      getAulas: () => app.data.aulas,
      reglasFijas: app.data.reglasFijas || [],
      hours: app.hours,
    };
  },
};
