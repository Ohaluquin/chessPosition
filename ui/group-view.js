const GroupView = {
  formatDiagnosticsList(items = []) {
    return items
      .map((item) => `<li>${item}</li>`)
      .join("");
  },

  formatVariantBlocks(blocks = []) {
    return blocks
      .map((block) => {
        const label =
          block.kind === "laboratorio"
            ? "Lab"
            : block.kind === "estudio"
              ? "Est"
              : "Clase";
        return `${label} ${block.duration * 30} min`;
      })
      .join(", ");
  },

  formatSessionBadges(sesion) {
    const badges = [];
    if ((sesion?.tipoSesion || "clase") === "laboratorio") {
      badges.push('<span class="session-kind-badge lab">LAB</span>');
    }
    if (sesion?.locked === true) {
      badges.push('<span class="session-lock">LOCK</span>');
    }
    if (badges.length === 0) return "";
    return `<div class="session-badges">${badges.join("")}</div>`;
  },

  getSubjectColor(app, grupo, asignaturaId) {
    const palette = [
      { bg: "#fef3c7", border: "#d97706" },
      { bg: "#dcfce7", border: "#16a34a" },
      { bg: "#ede9fe", border: "#7c3aed" },
      { bg: "#fee2e2", border: "#dc2626" },
      { bg: "#cffafe", border: "#0891b2" },
      { bg: "#ffedd5", border: "#ea580c" },
      { bg: "#ecfccb", border: "#65a30d" },
    ];

    const orderedSubjects = GroupService.getPlanAsignaturas(app, grupo)
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const index = orderedSubjects.findIndex((item) => item.id === asignaturaId);
    if (index < 0) return palette[0];
    return palette[index % palette.length];
  },

  getSelectedSubjectSummary(app, grupo) {
    const summaries = GroupService.buildAsignaturaSummaries(app, grupo);
    return (
      summaries.find(
        (item) => item.asignatura.id === app.groupEditorSelectedAsignaturaId,
      ) || summaries[0] || null
    );
  },

  paintProfesorShadow(app, grupo) {
    const selected = this.getSelectedSubjectSummary(app, grupo);
    const profesor = selected?.profesorAsignado || null;
    if (!profesor?.id) return;

    const shadowSessions = (app.horario.sesiones || []).filter(
      (sesion) => sesion.profesorId === profesor.id && sesion.grupoId !== grupo.id,
    );
    shadowSessions.forEach((sesion) => {
      const cell = document.querySelector(
        `.grid-cell[data-day="${sesion.dia}"][data-hour="${sesion.hora}"]`,
      );
      if (!cell) return;
      cell.style.backgroundColor = "#dbeafe";
    });
  },

  select(app, grupo) {
    app.currentView = { type: "GRUPO", entity: grupo };
    app.updateTitle();
    this.showEditor();
    this.renderEditor(app);
    app.refreshGrid();
  },

  showEditor() {
    const editor = document.getElementById("group-editor");
    if (editor) editor.style.display = "block";
  },

  hideEditor() {
    const editor = document.getElementById("group-editor");
    if (editor) editor.style.display = "none";
  },

  renderEditor(app) {
    const view = app.currentView;
    if (!view || view.type !== "GRUPO" || !view.entity) return;

    const grupo = view.entity;
    GroupService.ensureProfesorAssignments(app, grupo);
    const inputName = document.getElementById("group-name");
    const selectTurno = document.getElementById("group-turno");
    const selectSubjects = document.getElementById("group-subjects-list");
    const detail = document.getElementById("group-subject-detail");
    const stats = document.getElementById("group-stats");

    if (inputName) inputName.value = grupo.nombre ?? "";
    if (selectTurno) selectTurno.value = grupo.turno ?? "matutino";

    const summaries = GroupService.buildAsignaturaSummaries(app, grupo).sort((a, b) =>
      a.asignatura.nombre.localeCompare(b.asignatura.nombre, "es"),
    );
    const scheduler = new Scheduler(app.horario, ScheduleEditor.buildDataStore(app));
    const fullPlan = GroupService.buildFullSchedulePlan(app, grupo);
    const evaluation = scheduler.evaluateGroupSchedule(grupo.id, fullPlan);

    if (stats) {
      const totalMaterias = summaries.length;
      const completas = summaries.filter((item) => item.pendientes === 0).length;
      const totalProgramados = summaries.reduce(
        (acc, item) => acc + item.programados,
        0,
      );
      const totalPendientes = summaries.reduce(
        (acc, item) => acc + item.pendientes,
        0,
      );
      const loadSummary = GroupService.getGroupLoadSummary(app, grupo.id);

      stats.innerHTML = `
        <span class="stat-chip">Materias: ${totalMaterias}</span>
        <span class="stat-chip">Completas: ${completas}</span>
        <span class="stat-chip">Segmentos programados: ${totalProgramados}</span>
        <span class="stat-chip">Pendientes: ${totalPendientes}</span>
        <span class="stat-chip">Dias ocupados: ${loadSummary.occupiedDays}</span>
        <span class="stat-chip">Brecha diaria: ${loadSummary.balanceGap}</span>
        <span class="stat-chip">LOCK: ${loadSummary.lockedSegments}</span>
        <span class="stat-chip">Evaluacion: ${evaluation}</span>
      `;
    }

    if (!selectSubjects) return;

    selectSubjects.innerHTML = "";
    summaries.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.asignatura.id;
      option.textContent =
        `${item.asignatura.nombre} (${item.programados}/${item.requeridos})`;
      selectSubjects.appendChild(option);
    });

    const validSelection = summaries.some(
      (item) => item.asignatura.id === app.groupEditorSelectedAsignaturaId,
    );
    app.groupEditorSelectedAsignaturaId =
      validSelection
        ? app.groupEditorSelectedAsignaturaId
        : summaries[0]?.asignatura.id || null;

    selectSubjects.value = app.groupEditorSelectedAsignaturaId || "";
    selectSubjects.onchange = () => {
      app.groupEditorSelectedAsignaturaId = selectSubjects.value || null;
      this.renderSelectedSubjectDetail(app);
      app.refreshGrid();
    };

    if (detail && summaries.length === 0) {
      detail.innerHTML = "<small>Este grupo todavia no tiene asignaturas en su plan.</small>";
      return;
    }

    this.renderSelectedSubjectDetail(app);
  },

  renderSelectedSubjectDetail(app) {
    const view = app.currentView;
    if (!view || view.type !== "GRUPO" || !view.entity) return;

    const detail = document.getElementById("group-subject-detail");
    if (!detail) return;

    const summaries = GroupService.buildAsignaturaSummaries(app, view.entity);
    const selected =
      summaries.find(
        (item) => item.asignatura.id === app.groupEditorSelectedAsignaturaId,
      ) || summaries[0];

    if (!selected) {
      detail.innerHTML = "<small>Selecciona una asignatura para ver su detalle.</small>";
      return;
    }

    const academia =
      app.data.academias.find(
        (item) => item.id === selected.asignatura.academiaId,
      )?.nombre || "Sin academia";
    const scheduler = new Scheduler(app.horario, ScheduleEditor.buildDataStore(app));
    const variants = selected.asignatura.getBlockVariants?.() || [];
    const variantOptions = variants
      .map((variant) => {
        const selectedAttr = variant.key === selected.variantKey ? " selected" : "";
        const description = this.formatVariantBlocks(variant.blocks);
        return `<option value="${variant.key}"${selectedAttr}>${variant.label} - ${description}</option>`;
      })
      .join("");
    const diagnosisRequests = GroupService.buildScheduleRequest(app, view.entity).filter(
      (request) => request.asignaturaId === selected.asignatura.id,
    );
    const diagnosisItems = diagnosisRequests
      .map((request) => {
        const diagnosis = scheduler.diagnoseRequestFailure(
          view.entity,
          selected.asignatura,
          request,
        );
        if (!diagnosis?.summary) return null;
        const label = scheduler.getRequestLabel(selected.asignatura, request);
        return `${label}: ${diagnosis.summary}`;
      })
      .filter(Boolean);

    detail.innerHTML = `
      <div class="group-subject-detail-card">
        <div class="group-subject-detail-header">
          <strong>${selected.asignatura.nombre}</strong>
          <small>Academia: ${academia}</small>
        </div>
        <div class="group-subject-detail-metrics">
          <span>Programados: ${selected.programados}</span>
          <span>Requeridos: ${selected.requeridos}</span>
          <span>Pendientes: ${selected.pendientes}</span>
          <span>Estructura: ${selected.variantLabel || "Base"}</span>
          <span>Bloques: ${selected.bloquesProgramados}/${selected.bloquesRequeridos}</span>
          ${
            selected.estudioRequerido
              ? `<span>Estudio: ${selected.estudioPendiente ? "Pendiente" : "Cubierto"}</span>`
              : ""
          }
          ${
            selected.laboratorioRequerido
              ? `<span>Laboratorio: ${selected.laboratorioPendiente ? "Pendiente" : "Cubierto"}</span>`
              : ""
          }
          <span>Profesor asignado: ${selected.profesorAsignado?.nombre || "Sin asignar"}</span>
        </div>
        <div class="group-subject-detail-variant">
          <label for="group-subject-variant">Variante semanal</label>
          <select id="group-subject-variant">${variantOptions}</select>
        </div>
        ${
          diagnosisItems.length > 0
            ? `
              <div class="subject-diagnosis">
                <strong>Por que no cabe</strong>
                <ul>${this.formatDiagnosticsList(diagnosisItems)}</ul>
              </div>
            `
            : ""
        }
      </div>
    `;

    const variantSelect = document.getElementById("group-subject-variant");
    if (variantSelect) {
      variantSelect.onchange = () => {
        const nextVariantKey = variantSelect.value || "default";
        const structureMap = GroupService.ensureStructureMap(view.entity);
        const previousVariantKey = structureMap[selected.asignatura.id] || selected.variantKey || "default";
        structureMap[selected.asignatura.id] = nextVariantKey;

        if (previousVariantKey !== nextVariantKey) {
          GroupService.clearScheduledSubjectSessions(
            app,
            view.entity.id,
            selected.asignatura.id,
          );
        }

        this.renderEditor(app);
        app.refreshGrid();
      };
    }
  },

  saveEdits(app) {
    const view = app.currentView;
    if (!view || view.type !== "GRUPO" || !view.entity) return;

    const grupo = view.entity;
    const inputName = document.getElementById("group-name");
    const selectTurno = document.getElementById("group-turno");

    if (inputName) grupo.nombre = inputName.value.trim() || grupo.nombre;
    if (selectTurno) grupo.turno = selectTurno.value || grupo.turno;

    app.renderGruposList();
    this.renderEditor(app);
    app.updateTitle();
    app.refreshGrid();
  },

  renderGrid(app, grupo) {
    Views.resetVisibleHours?.();
    if (grupo.turno === "matutino") {
      Views.setVisibleHours("08:00", "14:00");
    } else {
      Views.setVisibleHours("14:00", "20:00");
    }

    const sesiones = SessionService.getGroupSessions(app, grupo.id);
    this.paintProfesorShadow(app, grupo);
    const blocks = Views.buildContiguousBlocks(
      sesiones,
      (sesion) =>
        [
          sesion.grupoId,
          sesion.asignaturaId,
          sesion.profesorId,
          sesion.aulaId || "",
          sesion.tipoSesion || "clase",
        ].join("|"),
    ).map((block) => {
      const sesion = block.entries[0];
      const asignatura = app.data.asignaturas.find(
        (a) => a.id === sesion.asignaturaId,
      );
      const profesor = app.data.profesores.find(
        (p) => p.id === sesion.profesorId,
      );
      const aula = app.data.aulas.find((a) => a.id === sesion.aulaId);

      const isSelectedSubject =
        !!app.groupEditorSelectedAsignaturaId &&
        sesion.asignaturaId === app.groupEditorSelectedAsignaturaId;
      const subjectColor = this.getSubjectColor(app, grupo, sesion.asignaturaId);
      const accent = isSelectedSubject
        ? `box-shadow: inset 0 0 0 3px ${subjectColor.border};`
        : `box-shadow: inset 0 0 0 1px ${subjectColor.border};`;
      const endLabel =
        app.hours[block.endHour + 1] || app.hours[block.endHour] || "";

      const content = `
        <div class="session-info" style="${accent}">
          <strong>${asignatura ? asignatura.nombre : "???"}</strong>
          <small class="session-line">${app.hours[block.startHour]} - ${endLabel}</small>
          <small class="session-line">${profesor ? profesor.nombre : "???"}</small>
          ${aula ? `<small class="session-line session-meta-optional">${aula.nombre}</small>` : ""}
          ${this.formatSessionBadges(sesion)}
        </div>
      `;

      const profConflict = block.entries.some((current) =>
        app.horario.sesiones.some(
          (s) =>
            s !== current &&
            s.profesorId === current.profesorId &&
            s.dia === current.dia &&
            s.hora === current.hora,
        ),
      );
      const aulaConflict = block.entries.some((current) =>
        app.horario.sesiones.some(
          (s) =>
            s !== current &&
            !!s.aulaId &&
            s.aulaId === current.aulaId &&
            s.dia === current.dia &&
            s.hora === current.hora,
        ),
      );
      const groupBlocked = block.entries.some((current) =>
        app.horario.isBlocked?.("GRUPO", grupo.id, current.dia, current.hora),
      );

      const isConflict = profConflict || aulaConflict || !!groupBlocked;
      return {
        dia: block.dia,
        startHour: block.startHour,
        endHour: block.endHour,
        content,
        color: isConflict ? "#ffcdd2" : subjectColor.bg,
        isConflict,
      };
    });

    Views.renderMergedBlocks(blocks);

    app.horario.bloqueos
      ?.filter((b) => b.scope === "GRUPO" && b.targetId === grupo.id)
      .forEach((b) => {
        const content = `<div class="session-info"><small>${b.motivo || "Bloqueado"}</small></div>`;
        Views.updateCell(b.dia, b.hora, content, "#eeeeee", false);
      });
  },

  handleCellClick(app, grupo, day, hour) {
    const existingSession = SessionService.findGroupSession(
      app,
      grupo.id,
      day,
      hour,
    );
    ScheduleEditor.openSessionDialog(app, day, hour, existingSession);
  },
};
