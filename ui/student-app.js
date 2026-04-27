const StudentApp = {
  workspaceStorageKey: "student-schedule-workspace-v1",

  state: {
    dataset: null,
    subjectFilter: "",
    selectedSubjectIds: new Set(),
    offeringRules: {},
    subjectPriorities: {},
    preferences: window.StudentPreferences?.current || null,
    results: [],
  },

  init() {
    this.cacheDom();
    this.bindEvents();
    this.render();
  },

  cacheDom() {
    this.fileInput = document.getElementById("student-file-input");
    this.datasetInfo = document.getElementById("student-dataset-info");
    this.subjectFilterInput = document.getElementById("student-subject-filter");
    this.subjectList = document.getElementById("student-subject-list");
    this.selectionPanel = document.getElementById("student-selection-panel");
    this.resultsPanel = document.getElementById("student-results");
    this.resultLimit = document.getElementById("student-result-limit");
    this.buildSummary = document.getElementById("student-build-summary");
    this.preferenceSummary = document.getElementById("student-preference-summary");
  },

  bindEvents() {
    document.getElementById("student-btn-import").onclick = () => this.fileInput.click();
    document.getElementById("student-btn-load-demo").onclick = () =>
      this.loadFromJson(window.TEMPLATE_BUNDLES?.B || null, "semestre_B");
    document.getElementById("student-btn-build").onclick = () => this.buildSchedules();
    this.resultLimit.onchange = () => this.saveWorkspace();
    document.querySelectorAll("[data-student-preference]").forEach((input) => {
      input.onchange = () => this.updatePreferencesFromControls();
      input.oninput = () => this.updatePreferencesFromControls({ soft: true });
    });

    this.fileInput.onchange = (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          this.loadFromJson(parsed, file.name);
        } catch (error) {
          console.error(error);
          alert("No se pudo leer el JSON del estudiante.");
        }
      };
      reader.readAsText(file, "utf-8");
      event.target.value = "";
    };

    this.subjectFilterInput.oninput = () => {
      this.state.subjectFilter = this.subjectFilterInput.value || "";
      this.renderSubjectList();
    };

    this.syncPreferenceControls();
  },

  loadFromJson(jsonData, label = "dataset") {
    if (!jsonData) {
      alert("No se encontraron datos para cargar.");
      return;
    }

    const dataset = this.hydrateDataset(jsonData);
    this.state.dataset = dataset;
    this.state.selectedSubjectIds = new Set();
    this.state.offeringRules = {};
    this.state.subjectPriorities = {};
    this.state.results = [];
    this.restoreWorkspace();
    this.subjectFilterInput.value = "";
    this.state.subjectFilter = "";
    this.datasetInfo.textContent =
      `${label}: ${dataset.subjects.length} materias con oferta y ${dataset.offerings.length} grupos-materia.`;
    this.buildSummary.textContent =
      dataset.offerings.length === 0
        ? "Este JSON no trae sesiones armadas todavia. Usa un archivo exportado despues de generar horarios."
        : "";
    this.populateHourPreferenceOptions();
    this.syncPreferenceControls();
    this.render();
  },

  hydrateDataset(jsonData) {
    const subjects = (jsonData.asignaturas || []).map(
      (item) =>
        new Asignatura({
          id: item.id,
          nombre: item.nombre,
          academiaId: item.academiaId,
          sesionesPorSemana: item.sesionesPorSemana ?? item.horasPorSemana ?? 0,
          duracionSegmentos: item.duracionSegmentos ?? 1,
          estudio: item.estudio ?? { mode: item.tipoHoraEstudio ?? "none" },
          requiereLaboratorio: item.requiereLaboratorio ?? false,
          weeklyBlockVariants: item.weeklyBlockVariants ?? item.blockVariants ?? [],
          selectedWeeklyBlockVariant: item.selectedWeeklyBlockVariant ?? null,
        }),
    );
    const groups = (jsonData.grupos || []).map(
      (item) =>
        new Grupo({
          id: item.id,
          nombre: item.nombre,
          turno: item.turno,
          grado: item.grado ?? null,
          planAsignaturas: item.planAsignaturas ?? [],
          profesoresPorAsignatura: item.profesoresPorAsignatura ?? {},
          estructuraPorAsignatura: item.estructuraPorAsignatura ?? {},
        }),
    );
    const teachers = (jsonData.profesores || []).map(
      (item) =>
        new Profesor({
          id: item.id,
          nombre: item.nombre,
          academiaId: item.academiaId,
          turno: item.turno,
          activo: item.activo ?? true,
        }),
    );
    const rooms = (jsonData.aulas || []).map((item) => new Aula(item.id, item.nombre, item.tipo));
    const sessions = (jsonData.sesiones || []).map(
      (item) =>
        new Sesion(
          item.grupoId,
          item.asignaturaId,
          item.profesorId,
          item.aulaId,
          item.dia,
          item.hora,
          item.tipoSesion ?? "clase",
          item.locked === true,
        ),
    );
    const blocks = this.buildOfferings({ subjects, groups, teachers, rooms, sessions });
    const offeredSubjectIds = new Set(blocks.map((item) => item.subjectId));

    return {
      label: jsonData.meta?.nombre || "Dataset",
      meta: jsonData.meta || {},
      hours: this.buildHours(jsonData.config),
      segmentMinutes: this.getSegmentMinutes(jsonData.config),
      subjects: subjects
        .filter((subject) => offeredSubjectIds.has(subject.id))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      groups,
      teachers,
      rooms,
      sessions,
      offerings: blocks.sort((a, b) => {
        if (a.subjectName !== b.subjectName) {
          return a.subjectName.localeCompare(b.subjectName, "es");
        }
        return a.groupName.localeCompare(b.groupName, "es");
      }),
    };
  },

  buildHours(config) {
    const start = config?.horario?.inicio || "08:00";
    const end = config?.horario?.fin || "20:00";
    const step = this.getSegmentMinutes(config);
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
    for (let t = toMin(start); t <= toMin(end); t += step) {
      hours.push(toHHMM(t));
    }
    return hours;
  },

  getSegmentMinutes(config) {
    return Math.max(1, Number(config?.segmentoMin) || 30);
  },

  buildOfferings({ subjects, groups, teachers, rooms, sessions }) {
    const grouped = new Map();
    sessions.forEach((session) => {
      const key = `${session.grupoId}|${session.asignaturaId}`;
      const current = grouped.get(key) || [];
      current.push(session);
      grouped.set(key, current);
    });

    return [...grouped.entries()].map(([key, groupSessions]) => {
      const [groupId, subjectId] = key.split("|");
      const subject = subjects.find((item) => item.id === subjectId);
      const group = groups.find((item) => item.id === groupId);
      const teacherIds = [...new Set(groupSessions.map((item) => item.profesorId).filter(Boolean))];
      const roomIds = [...new Set(groupSessions.map((item) => item.aulaId).filter(Boolean))];
      const blocks = this.buildBlocksFromSessions(groupSessions);

      return {
        id: `${subjectId}::${groupId}`,
        subjectId,
        groupId,
        subjectName: subject?.nombre || subjectId,
        groupName: group?.nombre || groupId,
        turno: group?.turno || "",
        grado: group?.grado ?? null,
        teacherNames: teacherIds
          .map((teacherId) => teachers.find((item) => item.id === teacherId)?.nombre || teacherId)
          .join(", "),
        roomNames: roomIds
          .map((roomId) => rooms.find((item) => item.id === roomId)?.nombre || roomId)
          .join(", "),
        sessions: [...groupSessions].sort((a, b) => {
          if (a.dia !== b.dia) return a.dia - b.dia;
          return a.hora - b.hora;
        }),
        blocks,
      };
    });
  },

  buildBlocksFromSessions(sessions) {
    const sorted = [...sessions].sort((a, b) => {
      if (a.dia !== b.dia) return a.dia - b.dia;
      return a.hora - b.hora;
    });
    const blocks = [];

    sorted.forEach((session) => {
      const last = blocks[blocks.length - 1];
      if (
        last &&
        last.dia === session.dia &&
        last.tipoSesion === (session.tipoSesion || "clase") &&
        last.endHour + 1 === session.hora
      ) {
        last.endHour = session.hora;
        last.duration += 1;
        return;
      }

      blocks.push({
        dia: session.dia,
        startHour: session.hora,
        endHour: session.hora,
        duration: 1,
        tipoSesion: session.tipoSesion || "clase",
      });
    });

    return blocks;
  },

  render() {
    this.renderSubjectList();
    this.renderSelectionPanel();
    this.renderResults();
    this.renderPreferenceSummary();
  },

  renderSubjectList() {
    if (!this.state.dataset) {
      this.subjectList.innerHTML = "<small>Carga un JSON para ver materias.</small>";
      return;
    }

    const filter = this.normalizeText(this.state.subjectFilter);
    const subjectIdsWithOfferings = new Set(this.state.dataset.offerings.map((item) => item.subjectId));
    const subjects = this.state.dataset.subjects.filter((subject) => {
      if (!subjectIdsWithOfferings.has(subject.id)) return false;
      if (!filter) return true;
      return this.normalizeText(subject.nombre).includes(filter);
    });

    this.subjectList.innerHTML = subjects
      .map((subject) => {
        const checked = this.state.selectedSubjectIds.has(subject.id) ? " checked" : "";
        const offeringCount = this.getOfferingsForSubject(subject.id).length;
        return `
          <label class="student-subject-option">
            <input type="checkbox" data-student-subject="${subject.id}"${checked}>
            <span>${subject.nombre}</span>
            <small>${offeringCount} grupo(s)</small>
          </label>
        `;
      })
      .join("");

    this.subjectList.querySelectorAll("[data-student-subject]").forEach((input) => {
      input.onchange = () => {
        const subjectId = input.dataset.studentSubject;
        if (input.checked) {
          this.state.selectedSubjectIds.add(subjectId);
        } else {
          this.state.selectedSubjectIds.delete(subjectId);
          delete this.state.subjectPriorities[subjectId];
        }
        this.state.results = [];
        this.saveWorkspace();
        this.renderSelectionPanel();
        this.renderResults();
      };
    });
  },

  renderSelectionPanel() {
    if (!this.state.dataset) {
      this.selectionPanel.innerHTML = "<small>Carga un JSON para configurar materias.</small>";
      return;
    }

    const selectedIds = [...this.state.selectedSubjectIds];
    if (selectedIds.length === 0) {
      this.selectionPanel.innerHTML = "<small>Selecciona una o varias materias.</small>";
      return;
    }

    const cards = selectedIds
      .map((subjectId) => {
        const subject = this.state.dataset.subjects.find((item) => item.id === subjectId);
        const offerings = this.getOfferingsForSubject(subjectId);
        const rows = offerings
          .map((offering) => {
            const rule = this.getOfferingRule(offering.id);
            return `
              <tr>
                <td>${offering.groupName}</td>
                <td>${this.escapeHtml(offering.turno || "-")}</td>
                <td>${offering.teacherNames || "-"}</td>
                <td>${this.describeOffering(offering)}</td>
                <td>
                  <select data-offering-rule="${offering.id}">
                    <option value="available"${rule === "available" ? " selected" : ""}>Disponible</option>
                    <option value="fixed"${rule === "fixed" ? " selected" : ""}>Fijo</option>
                    <option value="saturated"${rule === "saturated" ? " selected" : ""}>Saturado</option>
                    <option value="excluded"${rule === "excluded" ? " selected" : ""}>Excluir</option>
                  </select>
                </td>
              </tr>
            `;
          })
          .join("");

        return `
          <article class="student-subject-card">
            <div class="student-subject-card-head">
              <strong>${subject?.nombre || subjectId}</strong>
              <button type="button" class="menu-item" data-remove-subject="${subjectId}">Quitar</button>
            </div>
            <div class="student-subject-controls">
              <label>
                Prioridad
                <select data-subject-priority="${subjectId}">
                  <option value="normal"${this.getSubjectPriority(subjectId) === "normal" ? " selected" : ""}>Normal</option>
                  <option value="high"${this.getSubjectPriority(subjectId) === "high" ? " selected" : ""}>Alta</option>
                  <option value="critical"${this.getSubjectPriority(subjectId) === "critical" ? " selected" : ""}>Indispensable</option>
                </select>
              </label>
            </div>
            <div class="student-table-wrap">
              <table class="student-offering-table">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Turno</th>
                    <th>Profesor</th>
                    <th>Horario</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </article>
        `;
      })
      .join("");

    this.selectionPanel.innerHTML = cards;

    this.selectionPanel.querySelectorAll("[data-remove-subject]").forEach((button) => {
      button.onclick = () => {
        this.state.selectedSubjectIds.delete(button.dataset.removeSubject);
        delete this.state.subjectPriorities[button.dataset.removeSubject];
        this.state.results = [];
        this.saveWorkspace();
        this.render();
      };
    });

    this.selectionPanel.querySelectorAll("[data-offering-rule]").forEach((select) => {
      select.onchange = () => {
        this.state.offeringRules[select.dataset.offeringRule] = select.value || "available";
        this.state.results = [];
        this.saveWorkspace();
        this.renderResults();
      };
    });

    this.selectionPanel.querySelectorAll("[data-subject-priority]").forEach((select) => {
      select.onchange = () => {
        this.state.subjectPriorities[select.dataset.subjectPriority] = select.value || "normal";
        this.state.results = [];
        this.saveWorkspace();
        this.renderResults();
      };
    });
  },

  renderResults() {
    if (!this.state.dataset) {
      this.resultsPanel.innerHTML = "<small>Carga un JSON para calcular horarios.</small>";
      return;
    }

    if (this.state.results.length === 0) {
      this.resultsPanel.innerHTML =
        "<small>Usa \"Armar horario\" para generar combinaciones.</small>";
      return;
    }

    this.resultsPanel.innerHTML = this.state.results
      .map((result, index) => {
        const rows = result.selectedOfferings
          .map(
            (offering) => `
              <li>
                <strong>${offering.subjectName}</strong> - Grupo ${offering.groupName}
                <span>${this.describeOffering(offering)}</span>
              </li>
            `,
          )
          .join("");

        return `
          <article class="student-result-card">
            <div class="student-result-head">
              <h3>Opcion ${index + 1}</h3>
              <span>Puntaje: ${result.score.toFixed(1)}</span>
            </div>
            <div class="student-result-meta">
              <span>Materias cubiertas: ${result.selectedOfferings.length}/${this.state.selectedSubjectIds.size}</span>
              <span>Materias faltantes: ${result.metrics.missingSubjects}</span>
              ${
                result.metrics.priorityMissingPenalty > 0
                  ? `<span>Faltantes prioritarias: ${result.metrics.priorityMissingPenalty.toFixed(1)}</span>`
                  : ""
              }
              <span>Dias: ${result.metrics.daysUsed}</span>
              ${
                result.metrics.unusedDays > 0
                  ? `<span>Dias sin usar: ${result.metrics.unusedDays}</span>`
                  : ""
              }
              ${
                result.metrics.dailyLoadRange > 0
                  ? `<span>Desequilibrio: ${result.metrics.dailyLoadRangeHours.toFixed(1)} h</span>`
                  : ""
              }
              ${
                result.metrics.singleSegmentDays > 0
                  ? `<span>Dias con una clase: ${result.metrics.singleSegmentDays}</span>`
                  : ""
              }
              <span>Carga diaria: ${result.metrics.dailyLoadDeviationHours.toFixed(1)} h de desviacion</span>
              ${
                result.metrics.avoidedDayHours > 0
                  ? `<span>Dias evitados: ${result.metrics.avoidedDayHours.toFixed(1)} h</span>`
                  : ""
              }
              ${
                result.metrics.preferredTurnoMismatches > 0
                  ? `<span>Turno no preferido: ${result.metrics.preferredTurnoMismatches}</span>`
                  : ""
              }
              <span>Huecos: ${result.metrics.gapSegments}</span>
              ${
                result.metrics.largestGapSegments > 0
                  ? `<span>Hueco mayor: ${result.metrics.largestGapHours.toFixed(1)} h</span>`
                  : ""
              }
              <span>Ventanas: ${result.metrics.windowSpan}</span>
            </div>
            <div class="student-result-grid">${this.renderResultGrid(result)}</div>
            ${this.renderScoreBreakdown(result)}
            <ul class="student-result-list">${rows}</ul>
            ${
              result.missingSubjectIds.length > 0
                ? `<div class="student-missing">Faltan: ${result.missingSubjectIds
                    .map((subjectId) => this.state.dataset.subjects.find((item) => item.id === subjectId)?.nombre || subjectId)
                    .join(", ")}</div>`
                : ""
            }
          </article>
        `;
      })
      .join("");
  },

  buildSchedules() {
    if (!this.state.dataset) {
      alert("Carga un JSON primero.");
      return;
    }

    const selectedIds = [...this.state.selectedSubjectIds];
    if (selectedIds.length === 0) {
      alert("Selecciona al menos una materia.");
      return;
    }

    const subjectOptions = selectedIds.map((subjectId) => {
      const offerings = this.getOfferingsForSubject(subjectId);
      const fixed = offerings.filter((offering) => this.getOfferingRule(offering.id) === "fixed");
      const available = offerings.filter(
        (offering) => !this.isOfferingDiscarded(offering.id),
      );
      const eligible = (fixed.length > 0 ? fixed : available).filter((offering) =>
        this.isOfferingInsideHardPreferences(offering),
      );

      return {
        subjectId,
        offerings: eligible,
        fixedCount: fixed.length,
        priorityWeight: this.getSubjectPriorityWeight(subjectId),
      };
    });

    const impossible = subjectOptions.find((item) => item.offerings.length === 0);
    if (impossible) {
      const subject = this.state.dataset.subjects.find((item) => item.id === impossible.subjectId);
      alert(
        `No hay grupos elegibles para ${subject?.nombre || impossible.subjectId}. ` +
          "Revisa grupos saturados, exclusiones, grupos fijos o la ventana horaria de preferencias.",
      );
      return;
    }

    subjectOptions.sort((a, b) => {
      if (b.priorityWeight !== a.priorityWeight) return b.priorityWeight - a.priorityWeight;
      return a.offerings.length - b.offerings.length;
    });

    const resultLimit = Math.max(1, Number(this.resultLimit.value) || 5);
    const results = [];

    const visit = (index, chosen, occupied, missingSubjectIds) => {
      if (index >= subjectOptions.length) {
        results.push(this.createScheduleResult(chosen, missingSubjectIds));
        return;
      }

      const option = subjectOptions[index];
      let placed = false;
      option.offerings.forEach((offering) => {
        if (this.hasConflict(offering, occupied)) return;
        placed = true;

        const nextOccupied = new Set(occupied);
        offering.sessions.forEach((session) => {
          nextOccupied.add(`${session.dia}|${session.hora}`);
        });
        visit(index + 1, [...chosen, offering], nextOccupied, [...missingSubjectIds]);
      });

      if (!placed && option.fixedCount === 0) {
        visit(index + 1, [...chosen], new Set(occupied), [...missingSubjectIds, option.subjectId]);
      }
    };

    visit(0, [], new Set(), []);

    if (results.length === 0) {
      this.state.results = [];
      this.resultsPanel.innerHTML =
        "<small>No existe una combinacion compatible con las restricciones fijas actuales.</small>";
      this.buildSummary.textContent =
        "No se encontro un horario completo. Prueba soltando grupos fijos o quitando exclusiones.";
      return;
    }

    results.sort((a, b) => b.score - a.score);
    this.state.results = results.slice(0, resultLimit);
    const best = results[0];
    this.buildSummary.textContent =
      `Se encontraron ${results.length} combinacion(es). Mejor cobertura: ` +
      `${best.selectedOfferings.length}/${selectedIds.length}. Mostrando ${this.state.results.length}.`;
    this.renderResults();
  },

  createScheduleResult(selectedOfferings, missingSubjectIds = []) {
    const sessions = selectedOfferings.flatMap((offering) => offering.sessions);
    const dayHours = new Map();
    const segmentMinutes = this.state.dataset?.segmentMinutes || 30;
    const preferences = window.StudentPreferences || {};
    const activePreferences = this.state.preferences || preferences.current || {};
    const weights = preferences.getScoringWeights?.(activePreferences) || {
      coveredSubject: 1000,
      missingSubject: 700,
      unusedDay: 55,
      lowLoadDay: 34,
      dailyLoadDeviationSegment: 4,
      dailyLoadImbalance: 5,
      dailyLoadRange: 6,
      gapSegment: 9,
      gapSeverity: 4,
      windowSpan: 0.6,
      avoidedDaySegment: 18,
      preferredTurnoMismatch: 28,
    };
    const targetDailySegments =
      preferences.getTargetDailySegments?.(segmentMinutes, activePreferences) ||
      Math.max(1, Math.round((8 * 60) / segmentMinutes));
    const avoidedDays = new Set((activePreferences.avoidDays || []).map(Number));
    const preferredTurno = activePreferences.preferredTurno || "any";

    sessions.forEach((session) => {
      const hours = dayHours.get(session.dia) || [];
      hours.push(session.hora);
      dayHours.set(session.dia, hours);
    });

    let gapSegments = 0;
    let gapSeverity = 0;
    let largestGapSegments = 0;
    let windowSpan = 0;
    let dailyLoadDeviationSegments = 0;
    let avoidedDaySegments = 0;
    let lowLoadDayPenaltyUnits = 0;
    let singleSegmentDays = 0;
    const dailyLoads = [];
    dayHours.forEach((hours, day) => {
      const sorted = [...hours].sort((a, b) => a - b);
      dailyLoads.push(sorted.length);
      dailyLoadDeviationSegments += Math.abs(sorted.length - targetDailySegments);
      if (sorted.length === 1) {
        lowLoadDayPenaltyUnits += 2;
        singleSegmentDays += 1;
      } else if (sorted.length === 2) {
        lowLoadDayPenaltyUnits += 1;
      }
      if (avoidedDays.has(Number(day))) {
        avoidedDaySegments += sorted.length;
      }
      windowSpan += sorted[sorted.length - 1] - sorted[0] + 1;
      for (let i = 1; i < sorted.length; i += 1) {
        const diff = sorted[i] - sorted[i - 1] - 1;
        if (diff > 0) {
          gapSegments += diff;
          gapSeverity += diff * diff;
          largestGapSegments = Math.max(largestGapSegments, diff);
        }
      }
    });
    const preferredTurnoMismatches =
      preferredTurno === "any"
        ? 0
        : selectedOfferings.filter((offering) => offering.turno && offering.turno !== preferredTurno).length;
    const averageDailyLoad =
      dailyLoads.length > 0
        ? dailyLoads.reduce((total, load) => total + load, 0) / dailyLoads.length
        : 0;
    const dailyLoadImbalance = dailyLoads.reduce(
      (total, load) => total + Math.abs(load - averageDailyLoad),
      0,
    );
    const dailyLoadRange =
      dailyLoads.length > 0 ? Math.max(...dailyLoads) - Math.min(...dailyLoads) : 0;

    const metrics = {
      daysUsed: dayHours.size,
      unusedDays: Math.max(0, 5 - dayHours.size),
      gapSegments,
      gapSeverity,
      largestGapSegments,
      largestGapHours: (largestGapSegments * segmentMinutes) / 60,
      windowSpan,
      totalSegments: sessions.length,
      targetDailySegments,
      dailyLoadDeviationSegments,
      dailyLoadDeviationHours: (dailyLoadDeviationSegments * segmentMinutes) / 60,
      averageDailyLoadHours: (averageDailyLoad * segmentMinutes) / 60,
      dailyLoadImbalance,
      dailyLoadImbalanceHours: (dailyLoadImbalance * segmentMinutes) / 60,
      dailyLoadRange,
      dailyLoadRangeHours: (dailyLoadRange * segmentMinutes) / 60,
      lowLoadDayPenaltyUnits,
      singleSegmentDays,
      avoidedDaySegments,
      avoidedDayHours: (avoidedDaySegments * segmentMinutes) / 60,
      preferredTurnoMismatches,
      missingSubjects: missingSubjectIds.length,
      priorityCoverage: this.getPriorityCoverageScore(selectedOfferings),
      priorityMissingPenalty: this.getPriorityMissingPenalty(missingSubjectIds),
    };

    const breakdown = {
      coverage: metrics.priorityCoverage * weights.coveredSubject,
      missingSubjects: -metrics.priorityMissingPenalty * weights.missingSubject,
      unusedDays: -metrics.unusedDays * weights.unusedDay,
      lowLoadDays: -metrics.lowLoadDayPenaltyUnits * weights.lowLoadDay,
      dailyLoad: -metrics.dailyLoadDeviationSegments * weights.dailyLoadDeviationSegment,
      dailyBalance: -metrics.dailyLoadImbalance * weights.dailyLoadImbalance,
      dailyRange: -metrics.dailyLoadRange * weights.dailyLoadRange,
      avoidedDays: -metrics.avoidedDaySegments * weights.avoidedDaySegment,
      preferredTurno: -metrics.preferredTurnoMismatches * weights.preferredTurnoMismatch,
      gaps: -metrics.gapSegments * weights.gapSegment,
      longGaps: -metrics.gapSeverity * weights.gapSeverity,
      windowSpan: -metrics.windowSpan * weights.windowSpan,
    };

    const score = Object.values(breakdown).reduce((total, value) => total + value, 0);

    return {
      selectedOfferings,
      sessions,
      missingSubjectIds,
      metrics,
      breakdown,
      score,
    };
  },

  renderScoreBreakdown(result) {
    const labels = {
      coverage: "Materias cubiertas y prioridad",
      missingSubjects: "Materias faltantes ponderadas",
      unusedDays: "Dias sin usar",
      lowLoadDays: "Dias con muy poca carga",
      dailyLoad: "Distancia contra carga diaria",
      dailyBalance: "Equilibrio entre dias",
      dailyRange: "Diferencia dia pesado/ligero",
      avoidedDays: "Clases en dias evitados",
      preferredTurno: "Turno no preferido",
      gaps: "Huecos totales",
      longGaps: "Tamano de huecos largos",
      windowSpan: "Ventanas del dia",
    };
    const rows = Object.entries(result.breakdown || {})
      .filter(([, value]) => Math.abs(value) > 0.01)
      .map(([key, value]) => {
        const signClass = value >= 0 ? "is-positive" : "is-negative";
        const prefix = value >= 0 ? "+" : "";
        return `
          <tr>
            <td>${labels[key] || key}</td>
            <td class="${signClass}">${prefix}${value.toFixed(1)}</td>
          </tr>
        `;
      })
      .join("");

    if (!rows) return "";

    return `
      <details class="student-score-breakdown">
        <summary>Desglose del puntaje</summary>
        <table>
          <tbody>${rows}</tbody>
        </table>
      </details>
    `;
  },

  renderResultGrid(result) {
    const hours = this.state.dataset.hours || [];
    const visibleHourIndices = [...new Set(result.sessions.map((session) => session.hora))].sort(
      (a, b) => a - b,
    );
    const days = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];
    const sessionMap = new Map();

    result.selectedOfferings.forEach((offering) => {
      offering.sessions.forEach((session) => {
        sessionMap.set(`${session.dia}|${session.hora}`, offering);
      });
    });

    const rows = visibleHourIndices
      .map((hourIndex) => {
        const cells = days
          .map((_, day) => {
            const offering = sessionMap.get(`${day}|${hourIndex}`);
            if (!offering) return "<td></td>";
            return `<td><strong>${offering.subjectName}</strong><small>${offering.groupName}</small></td>`;
          })
          .join("");
        return `<tr><th>${hours[hourIndex] || hourIndex}</th>${cells}</tr>`;
      })
      .join("");

    return `
      <table class="student-grid-table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Lunes</th>
            <th>Martes</th>
            <th>Miercoles</th>
            <th>Jueves</th>
            <th>Viernes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },

  getOfferingsForSubject(subjectId) {
    return (this.state.dataset?.offerings || []).filter((offering) => offering.subjectId === subjectId);
  },

  getOfferingRule(offeringId) {
    return this.state.offeringRules[offeringId] || "available";
  },

  saveWorkspace() {
    if (!this.state.dataset) return;
    const snapshot = {
      datasetSignature: this.getDatasetSignature(),
      selectedSubjectIds: [...this.state.selectedSubjectIds],
      offeringRules: this.state.offeringRules,
      subjectPriorities: this.state.subjectPriorities,
      resultLimit: this.resultLimit?.value || "5",
    };

    try {
      localStorage.setItem(this.workspaceStorageKey, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("No se pudo guardar la configuracion del estudiante.", error);
    }
  },

  restoreWorkspace() {
    if (!this.state.dataset) return;

    let snapshot = null;
    try {
      snapshot = JSON.parse(localStorage.getItem(this.workspaceStorageKey) || "null");
    } catch (error) {
      snapshot = null;
    }
    if (!snapshot || snapshot.datasetSignature !== this.getDatasetSignature()) return;

    const validSubjectIds = new Set(this.state.dataset.subjects.map((subject) => subject.id));
    const validOfferingIds = new Set(this.state.dataset.offerings.map((offering) => offering.id));

    this.state.selectedSubjectIds = new Set(
      (snapshot.selectedSubjectIds || []).filter((subjectId) => validSubjectIds.has(subjectId)),
    );

    this.state.offeringRules = Object.fromEntries(
      Object.entries(snapshot.offeringRules || {}).filter(([offeringId, rule]) =>
        validOfferingIds.has(offeringId) &&
        ["available", "fixed", "saturated", "excluded"].includes(rule),
      ),
    );

    this.state.subjectPriorities = Object.fromEntries(
      Object.entries(snapshot.subjectPriorities || {}).filter(([subjectId, priority]) =>
        validSubjectIds.has(subjectId) &&
        ["normal", "high", "critical"].includes(priority),
      ),
    );

    if (this.resultLimit && ["3", "5", "10"].includes(String(snapshot.resultLimit))) {
      this.resultLimit.value = String(snapshot.resultLimit);
    }
  },

  getDatasetSignature() {
    const subjects = (this.state.dataset?.subjects || []).map((subject) => subject.id).sort();
    const offerings = (this.state.dataset?.offerings || []).map((offering) => offering.id).sort();
    return `${subjects.join(",")}::${offerings.join(",")}`;
  },

  isOfferingDiscarded(offeringId) {
    const rule = this.getOfferingRule(offeringId);
    return rule === "excluded" || rule === "saturated";
  },

  getSubjectPriority(subjectId) {
    return this.state.subjectPriorities[subjectId] || "normal";
  },

  getSubjectPriorityWeight(subjectId) {
    return {
      normal: 1,
      high: 1.4,
      critical: 2,
    }[this.getSubjectPriority(subjectId)] || 1;
  },

  getPriorityCoverageScore(selectedOfferings) {
    return selectedOfferings.reduce(
      (total, offering) => total + this.getSubjectPriorityWeight(offering.subjectId),
      0,
    );
  },

  getPriorityMissingPenalty(missingSubjectIds) {
    return missingSubjectIds.reduce(
      (total, subjectId) => total + this.getSubjectPriorityWeight(subjectId),
      0,
    );
  },

  describeOffering(offering) {
    return offering.blocks
      .map((block) => {
        const dayLabel = ["Lu", "Ma", "Mi", "Ju", "Vi"][block.dia] || block.dia;
        const start = this.state.dataset.hours[block.startHour] || block.startHour;
        const end =
          this.state.dataset.hours[block.endHour + 1] ||
          this.state.dataset.hours[block.endHour] ||
          "";
        return `${dayLabel} ${start}-${end}`.replace(/-$/, "");
      })
      .join(" | ");
  },

  hasConflict(offering, occupied) {
    return offering.sessions.some((session) => occupied.has(`${session.dia}|${session.hora}`));
  },

  isOfferingInsideHardPreferences(offering) {
    const prefs = this.state.preferences || {};
    const minStart = prefs.minStart === "" ? null : Number(prefs.minStart);
    const maxEnd = prefs.maxEnd === "" ? null : Number(prefs.maxEnd);
    return offering.sessions.every((session) => {
      if (minStart !== null && session.hora < minStart) return false;
      if (maxEnd !== null && session.hora >= maxEnd) return false;
      return true;
    });
  },

  populateHourPreferenceOptions() {
    const hours = this.state.dataset?.hours || [];
    this.fillHourSelect(document.getElementById("student-min-start"), hours, "Sin limite");
    this.fillHourSelect(document.getElementById("student-max-end"), hours, "Sin limite");
  },

  fillHourSelect(select, hours, emptyLabel) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = [
      `<option value="">${emptyLabel}</option>`,
      ...hours.map((label, index) => `<option value="${index}">${label}</option>`),
    ].join("");
    select.value = [...select.options].some((option) => option.value === current) ? current : "";
  },

  syncPreferenceControls() {
    const preferences = window.StudentPreferences;
    if (!preferences) return;
    this.state.preferences = preferences.normalize(this.state.preferences || preferences.current);
    preferences.applyToDom(document, this.state.preferences);
    this.renderPreferenceSummary();
  },

  updatePreferencesFromControls({ soft = false } = {}) {
    const preferences = window.StudentPreferences;
    if (!preferences) return;
    this.state.preferences = preferences.save(preferences.readFromDom(document));
    if (!soft) this.state.results = [];
    this.renderPreferenceSummary();
    if (!soft) this.renderResults();
  },

  renderPreferenceSummary() {
    if (!this.preferenceSummary) return;
    const prefs = this.state.preferences || {};
    const dayLabels = ["Lu", "Ma", "Mi", "Ju", "Vi"];
    const avoided = (prefs.avoidDays || []).map((day) => dayLabels[day]).filter(Boolean);
    const hours = this.state.dataset?.hours || [];
    const minStart = prefs.minStart === "" ? null : hours[Number(prefs.minStart)];
    const maxEnd = prefs.maxEnd === "" ? null : hours[Number(prefs.maxEnd)];
    const windowLabel =
      minStart || maxEnd
        ? `${minStart || "inicio"} a ${maxEnd || "fin"}`
        : "sin ventana fija";
    const turno =
      prefs.preferredTurno && prefs.preferredTurno !== "any"
        ? prefs.preferredTurno
        : "cualquier turno";
    this.preferenceSummary.textContent =
      `${prefs.targetDailyHours || 8} h/dia, ${windowLabel}, ${turno}` +
      (avoided.length > 0 ? `. Evitar: ${avoided.join(", ")}.` : ".");
  },

  normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  },

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },
};

window.addEventListener("DOMContentLoaded", () => {
  StudentApp.init();
});
