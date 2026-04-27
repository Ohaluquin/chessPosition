const Persistence = {
  exportData(app) {
    const exportObj = {
      ...app.data,
      sesiones: app.horario.sesiones,
      bloqueos: app.horario.bloqueos,
    };
    const source = app.fileContext || null;

    let suggestedName = source?.fileName || "horario_backup.json";
    if (source?.kind === "template") {
      const replaceTemplate = window.confirm(
        `Estas trabajando sobre la plantilla ${source.label || source.fileName}.\n\nAceptar: descargar con el nombre de la plantilla.\nCancelar: guardar como un JSON nuevo.`,
      );

      if (!replaceTemplate) {
        const customName = window.prompt(
          "Nombre para el nuevo archivo JSON:",
          suggestedName.replace(/\.json$/i, "") + "_nuevo.json",
        );
        if (!customName) return;
        suggestedName = this.normalizeJsonFileName(customName);
      }
    } else {
      const customName = window.prompt(
        "Nombre para exportar el JSON:",
        suggestedName,
      );
      if (!customName) return;
      suggestedName = this.normalizeJsonFileName(customName);
    }

    this.downloadJson(exportObj, suggestedName);
  },

  importData(app, event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    this.readJsonFile(file)
      .then((jsonData) => {
        this.applyState(app, this.hydrateState(jsonData), {
          kind: "import",
          fileName: file.name,
          label: file.name,
        });
        alert("Datos importados correctamente.");
      })
      .catch((err) => {
        console.error(err);
        alert("Error al importar archivo JSON");
      })
      .finally(() => {
        if (event?.target) event.target.value = "";
      });
  },

  loadTemplate(app, jsonData, templateInfo = {}) {
    this.applyState(app, this.hydrateState(jsonData), {
      kind: "template",
      fileName: templateInfo.fileName || "plantilla.json",
      label: templateInfo.label || templateInfo.fileName || "Plantilla",
      templateKey: templateInfo.templateKey || null,
    });
    console.log("Plantilla cargada correctamente", app.data);
  },

  readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, "utf-8");
    });
  },

  hydrateState(jsonData) {
    const data = {
      meta: jsonData.meta ?? {},
      config: jsonData.config ?? {},
      reglasFijas: jsonData.reglasFijas ?? [],
      franjasOptativas: jsonData.franjasOptativas ?? [],
      academias: (jsonData.academias || []).map(
        (d) =>
          new Academia(d.id, d.nombre, {
            limiteSalon: d.limiteSalon ?? d.capacidad ?? null,
            profesores: d.profesores ?? [],
          }),
      ),
      asignaturas: (jsonData.asignaturas || []).map(
        (d) =>
          new Asignatura({
            id: d.id,
            nombre: d.nombre,
            academiaId: d.academiaId,
            sesionesPorSemana: d.sesionesPorSemana ?? d.horasPorSemana ?? 0,
            duracionSegmentos: d.duracionSegmentos ?? 1,
            estudio: d.estudio ?? { mode: d.tipoHoraEstudio ?? "none" },
            requiereLaboratorio: d.requiereLaboratorio ?? false,
            weeklyBlockVariants: d.weeklyBlockVariants ?? d.blockVariants ?? [],
            selectedWeeklyBlockVariant: d.selectedWeeklyBlockVariant ?? null,
          }),
      ),
      grupos: (jsonData.grupos || []).map(
        (d) =>
          new Grupo({
            id: d.id,
            nombre: d.nombre,
            turno: d.turno,
            grado: d.grado ?? null,
            planAsignaturas: d.planAsignaturas ?? [],
            profesoresPorAsignatura: d.profesoresPorAsignatura ?? {},
            estructuraPorAsignatura: d.estructuraPorAsignatura ?? {},
          }),
      ),
      profesores: (jsonData.profesores || []).map((d) => {
        const profesor = new Profesor({
          id: d.id,
          nombre: d.nombre,
          academiaId: d.academiaId ?? d.academias?.[0] ?? null,
          turno: d.turno ?? "matutino",
          activo: d.activo ?? true,
        });
        profesor.disponibilidad = d.disponibilidad ?? {};
        profesor.gruposAsignados = Array.isArray(d.gruposAsignados)
          ? [...d.gruposAsignados]
          : [];
        return profesor;
      }),
      aulas: (jsonData.aulas || []).map(
        (d) => new Aula(d.id, d.nombre, d.tipo),
      ),
    };

    this.ensureAllAcademias(data);

    const horario = new Horario();

    if (Array.isArray(jsonData.sesiones)) {
      jsonData.sesiones.forEach((s) => {
        horario.addSesion(
          new Sesion(
            s.grupoId,
            s.asignaturaId,
            s.profesorId,
            s.aulaId,
            s.dia,
            s.hora,
            s.tipoSesion ?? "clase",
            s.locked === true,
          ),
        );
      });
    }

    if (Array.isArray(jsonData.bloqueos)) {
      jsonData.bloqueos.forEach((b) => {
        horario.addBloqueo(
          new Bloqueo(
            b.scope,
            b.targetId ?? null,
            b.dia,
            b.hora,
            b.motivo ?? "Bloqueado",
          ),
        );
      });
    }

    this.applyFixedRules(data, horario);
    this.applyOptativeSlots(data, horario);

    return { data, horario };
  },

  applyState(app, state, fileContext = null) {
    app.data = state.data;
    app.horario = state.horario;
    app.fileContext = fileContext;
    app.currentView = { type: "GRUPO", entity: null };
    app.setupUI();
    app.updateTitle();
    app.refreshGrid();
  },

  normalizeJsonFileName(fileName) {
    const trimmed = String(fileName || "").trim();
    if (!trimmed) return "horario_backup.json";
    return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
  },

  downloadJson(payload, fileName) {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(payload));
    const downloadAnchorNode = document.createElement("a");
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  },

  ensureAllAcademias(data) {
    const allId = "__ALL__";
    if (!data?.academias) return;

    const alreadyExists = data.academias.some((a) => a.id === allId);
    if (!alreadyExists) {
      data.academias.unshift(new Academia(allId, "TODAS"));
    }
  },

  applyFixedRules(data, horario) {
    const rules = Array.isArray(data?.reglasFijas) ? data.reglasFijas : [];
    if (rules.length === 0) return;

    const dayMap = new Map([
      ["lunes", 0],
      ["martes", 1],
      ["miercoles", 2],
      ["miércoles", 2],
      ["jueves", 3],
      ["viernes", 4],
    ]);
    const dayToIndex = (value) => {
      if (typeof value === "number") return value;
      const normalized = String(value || "").trim().toLowerCase();
      return dayMap.has(normalized) ? dayMap.get(normalized) : -1;
    };

    const buildHours = (config) => {
      const start = config?.horario?.inicio || "07:00";
      const end = config?.horario?.fin || "20:00";
      const stepMinutes = config?.segmentoMin || 30;

      const toMin = (hhmm) => {
        const [h, m] = String(hhmm).split(":").map(Number);
        return h * 60 + m;
      };

      const toHHMM = (mins) => {
        const h = String(Math.floor(mins / 60)).padStart(2, "0");
        const m = String(mins % 60).padStart(2, "0");
        return `${h}:${m}`;
      };

      const slots = [];
      for (let t = toMin(start); t <= toMin(end); t += stepMinutes) {
        slots.push(toHHMM(t));
      }
      return slots;
    };

    const hours = buildHours(data.config);
    const buildHourRange = (inicio, fin) => {
      const startIndex = hours.indexOf(inicio);
      const endIndex = hours.indexOf(fin);
      if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return [];
      const range = [];
      for (let index = startIndex; index < endIndex; index += 1) {
        range.push(index);
      }
      return range;
    };

    const resolveTargets = (scope, filters = {}) => {
      if (scope === "PROFESOR") {
        return (data.profesores || [])
          .filter((profesor) => {
            if (filters.turno && profesor.turno !== filters.turno) return false;
            if (filters.academiaId && profesor.academiaId !== filters.academiaId) {
              return false;
            }
            return true;
          })
          .map((profesor) => profesor.id);
      }

      if (scope === "GRUPO") {
        return (data.grupos || [])
          .filter((grupo) => {
            if (filters.turno && grupo.turno !== filters.turno) return false;
            if (filters.grado && grupo.grado !== filters.grado) return false;
            return true;
          })
          .map((grupo) => grupo.id);
      }

      if (scope === "ACADEMIA") {
        if (filters.academiaId) return [filters.academiaId];
        return (data.academias || [])
          .map((academia) => academia.id)
          .filter((id) => id && id !== "__ALL__");
      }

      return [];
    };

    rules.forEach((rule) => {
      const scope = rule.scope;
      const day = dayToIndex(rule.dia);
      const hoursToBlock = buildHourRange(rule.inicio, rule.fin);
      if (day < 0 || hoursToBlock.length === 0) return;

      const targetIds = resolveTargets(scope, rule.filters || {});
      targetIds.forEach((targetId) => {
        hoursToBlock.forEach((hour) => {
          horario.addBloqueo(
            new Bloqueo(
              scope,
              targetId,
              day,
              hour,
              rule.motivo || "Bloqueado",
            ),
          );
        });
      });
    });
  },

  applyOptativeSlots(data, horario) {
    const slots = Array.isArray(data?.franjasOptativas) ? data.franjasOptativas : [];
    if (slots.length === 0) return;

    const periodoActual = String(data?.meta?.periodo || "").trim().toLowerCase();
    const dayMap = new Map([
      ["lunes", 0],
      ["martes", 1],
      ["miercoles", 2],
      ["miércoles", 2],
      ["jueves", 3],
      ["viernes", 4],
    ]);

    const buildHours = (config) => {
      const start = config?.horario?.inicio || "07:00";
      const end = config?.horario?.fin || "20:00";
      const stepMinutes = config?.segmentoMin || 30;

      const toMin = (hhmm) => {
        const [h, m] = String(hhmm).split(":").map(Number);
        return h * 60 + m;
      };

      const toHHMM = (mins) => {
        const h = String(Math.floor(mins / 60)).padStart(2, "0");
        const m = String(mins % 60).padStart(2, "0");
        return `${h}:${m}`;
      };

      const hours = [];
      for (let t = toMin(start); t <= toMin(end); t += stepMinutes) {
        hours.push(toHHMM(t));
      }
      return { hours, toMin, toHHMM, stepMinutes };
    };

    const { hours, toMin, toHHMM, stepMinutes } = buildHours(data.config);
    const snapTime = (hhmm, mode = "floor") => {
      const mins = toMin(hhmm);
      const snapped =
        mode === "ceil"
          ? Math.ceil(mins / stepMinutes) * stepMinutes
          : Math.floor(mins / stepMinutes) * stepMinutes;
      return toHHMM(snapped);
    };

    const buildHourRange = (inicio, fin) => {
      const normalizedStart = hours.includes(inicio) ? inicio : snapTime(inicio, "floor");
      const normalizedEnd = hours.includes(fin) ? fin : snapTime(fin, "ceil");
      const startIndex = hours.indexOf(normalizedStart);
      const endIndex = hours.indexOf(normalizedEnd);
      if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return [];
      const range = [];
      for (let index = startIndex; index < endIndex; index += 1) {
        range.push(index);
      }
      return range;
    };

    const resolveGroups = (slot) => {
      const gradoObjetivo =
        slot.gradoObjetivo ??
        (String(slot.periodo || "").trim().toLowerCase() === "par" ? 6 : 5);

      return (data.grupos || []).filter((grupo) => {
        if (grupo.grado !== gradoObjetivo) return false;
        if (slot.turno && grupo.turno !== slot.turno) return false;
        return true;
      });
    };

    slots.forEach((slot) => {
      const periodoSlot = String(slot.periodo || "").trim().toLowerCase();
      if (periodoSlot && periodoActual && periodoSlot !== periodoActual) return;
      if (slot.activa === false) return;
      if (!Array.isArray(slot.dias) || slot.dias.length === 0) return;

      const inicio = slot.inicio;
      const fin =
        slot.fin ||
        toHHMM(toMin(slot.inicio) + Number(slot.duracionMin || 90));
      const hoursToBlock = buildHourRange(inicio, fin);
      if (hoursToBlock.length === 0) return;

      const groups = resolveGroups(slot);
      slot.dias.forEach((diaRaw) => {
        const normalizedDay = String(diaRaw || "").trim().toLowerCase();
        const day = dayMap.has(normalizedDay) ? dayMap.get(normalizedDay) : -1;
        if (day < 0) return;

        groups.forEach((grupo) => {
          hoursToBlock.forEach((hour) => {
            horario.addBloqueo(
              new Bloqueo(
                "GRUPO",
                grupo.id,
                day,
                hour,
                slot.motivo || `Optativa - ${slot.nombre || "Franja"}`,
              ),
            );
          });
        });
      });
    });
  },
};
