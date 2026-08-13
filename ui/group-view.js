const GroupView = {
  createGroupId(app, name) {
    const normalized = String(name || "grupo")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "grupo";
    const base = `g${normalized}`;
    let candidate = base;
    let suffix = 2;
    while ((app.data.grupos || []).some((grupo) => grupo.id === candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  },

  startNew(app) {
    if (!(app.data.asignaturas || []).length) {
      alert("Carga una plantilla o importa un JSON antes de crear grupos.");
      return;
    }
    app.groupEditorIsDraft = true;
    app.groupEditorDraftSourceId = null;
    app.groupEditorPendingPlanIds = new Set();
    app.groupEditorSelectedAsignaturaId = null;
    const grupo = new Grupo({
      id: "__new_group__",
      nombre: "",
      turno: "matutino",
      grado: app.data?.meta?.periodo === "par" ? 6 : 5,
      tipo: "optativa",
    });
    app.currentView = { type: "GRUPO", entity: grupo };
    app.updateTitle();
    this.showEditor();
    this.renderEditor(app);
    app.refreshGrid();
    document.getElementById("group-name")?.focus();
  },

  startDuplicate(app) {
    const source = app.currentView?.type === "GRUPO" ? app.currentView.entity : null;
    if (!source || app.groupEditorIsDraft) {
      alert("Selecciona un grupo existente para duplicarlo.");
      return;
    }

    app.groupEditorIsDraft = true;
    app.groupEditorDraftSourceId = source.id;
    app.groupEditorPendingPlanIds = new Set(GroupService.getPlanAsignaturaIds(source));
    app.groupEditorSelectedAsignaturaId = null;
    const grupo = new Grupo({
      id: "__new_group__",
      nombre: `${source.nombre} copia`,
      turno: source.turno,
      grado: source.grado,
      tipo: source.tipo,
      planAsignaturas: [...app.groupEditorPendingPlanIds],
      estructuraPorAsignatura: { ...source.estructuraPorAsignatura },
      franjasOptativasPorAsignatura: { ...source.franjasOptativasPorAsignatura },
    });
    app.currentView = { type: "GRUPO", entity: grupo };
    app.updateTitle();
    this.showEditor();
    this.renderEditor(app);
    app.refreshGrid();
    document.getElementById("group-name")?.focus();
  },

  cancelDraft(app) {
    if (!app.groupEditorIsDraft) return;
    app.groupEditorIsDraft = false;
    app.groupEditorDraftSourceId = null;
    app.groupEditorPendingPlanIds = null;
    app.groupEditorSelectedAsignaturaId = null;
    app.currentView = { type: "GRUPO", entity: null };
    this.hideEditor();
    app.updateTitle();
    app.refreshGrid();
  },

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
    app.groupEditorIsDraft = false;
    app.groupEditorDraftSourceId = null;
    app.groupEditorPendingPlanIds = new Set(GroupService.getPlanAsignaturaIds(grupo));
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
    if (!app.groupEditorIsDraft) GroupService.ensureProfesorAssignments(app, grupo);
    const inputName = document.getElementById("group-name");
    const selectTurno = document.getElementById("group-turno");
    const selectGrade = document.getElementById("group-grade");
    const selectType = document.getElementById("group-type");
    const selectSubjects = document.getElementById("group-subjects-list");
    const detail = document.getElementById("group-subject-detail");
    const stats = document.getElementById("group-stats");

    if (inputName) inputName.value = grupo.nombre ?? "";
    if (selectTurno) selectTurno.value = grupo.turno ?? "matutino";
    if (selectGrade) selectGrade.value = String(grupo.grado ?? 1);
    if (selectType) selectType.value = grupo.tipo ?? "regular";
    const cancelButton = document.getElementById("btn-group-cancel");
    if (cancelButton) cancelButton.style.display = app.groupEditorIsDraft ? "inline-block" : "none";
    const saveButton = document.getElementById("btn-group-save");
    if (saveButton) saveButton.textContent = app.groupEditorIsDraft ? "Crear Grupo" : "Guardar Grupo";

    if (!(app.groupEditorPendingPlanIds instanceof Set)) {
      app.groupEditorPendingPlanIds = new Set(GroupService.getPlanAsignaturaIds(grupo));
    }
    grupo.planAsignaturas = [...app.groupEditorPendingPlanIds];
    this.renderPlanEditor(app, grupo);

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
    } else {
      this.renderSelectedSubjectDetail(app);
    }

    const refreshDraftProperties = () => {
      grupo.nombre = inputName?.value.trim() || grupo.nombre;
      grupo.turno = selectTurno?.value || grupo.turno;
      grupo.grado = Number(selectGrade?.value) || grupo.grado;
      grupo.tipo = selectType?.value === "optativa" ? "optativa" : "regular";
      this.renderEditor(app);
      app.refreshGrid();
    };
    if (selectTurno) selectTurno.onchange = refreshDraftProperties;
    if (selectGrade) selectGrade.onchange = refreshDraftProperties;
    if (selectType) selectType.onchange = () => {
      if (
        !app.groupEditorIsDraft &&
        selectType.value !== grupo.tipo &&
        (app.horario.sesiones || []).some((session) => session.grupoId === grupo.id)
      ) {
        alert("No se puede cambiar el tipo de un grupo que ya tiene sesiones programadas.");
        selectType.value = grupo.tipo;
        return;
      }
      const previousPlanIds = [...app.groupEditorPendingPlanIds];
      app.groupEditorPendingPlanIds = new Set(
        [...app.groupEditorPendingPlanIds].filter((id) => {
          const subject = app.data.asignaturas.find((item) => item.id === id);
          return GroupService.isOptativeSubject(subject) === (selectType.value === "optativa");
        }),
      );
      previousPlanIds
        .filter((id) => !app.groupEditorPendingPlanIds.has(id))
        .forEach((id) => {
          delete GroupService.ensureProfesorMap(grupo)[id];
          delete GroupService.ensureStructureMap(grupo)[id];
          delete GroupService.ensureOptativeSlotMap(grupo)[id];
        });
      refreshDraftProperties();
    };
  },

  renderPlanEditor(app, grupo) {
    const container = document.getElementById("group-plan-options");
    const help = document.getElementById("group-plan-help");
    if (!container) return;

    const wantsOptatives = grupo.tipo === "optativa";
    const subjects = (app.data.asignaturas || [])
      .filter((subject) => GroupService.isOptativeSubject(subject) === wantsOptatives)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (help) {
      help.textContent = wantsOptatives
        ? "Selecciona una o dos optativas y configura profesor y franja en el detalle."
        : "Selecciona las materias que pertenecen al grupo.";
    }

    container.innerHTML = subjects
      .map((subject) => {
        const academy = app.data.academias.find((item) => item.id === subject.academiaId);
        const checked = app.groupEditorPendingPlanIds.has(subject.id) ? " checked" : "";
        return `
          <label class="group-plan-option">
            <input type="checkbox" value="${subject.id}"${checked}>
            <span>${subject.nombre}<small>${academy?.nombre || "Sin academia"}</small></span>
          </label>`;
      })
      .join("");

    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.onchange = () => {
        if (checkbox.checked) {
          if (wantsOptatives && app.groupEditorPendingPlanIds.size >= 2) {
            checkbox.checked = false;
            alert("Cada grupo optativo puede tener como maximo dos materias.");
            return;
          }
          app.groupEditorPendingPlanIds.add(checkbox.value);
          app.groupEditorSelectedAsignaturaId = checkbox.value;
        } else {
          const scheduledCount = (app.horario.sesiones || []).filter(
            (session) =>
              session.grupoId === grupo.id &&
              session.asignaturaId === checkbox.value,
          ).length;
          if (
            scheduledCount > 0 &&
            !window.confirm(
              `Esta materia tiene ${scheduledCount} segmento(s) programado(s). ` +
                "Quitarlos del grupo tambien eliminara esas sesiones. ¿Continuar?",
            )
          ) {
            checkbox.checked = true;
            return;
          }
          if (scheduledCount > 0) {
            GroupService.clearScheduledSubjectSessions(app, grupo.id, checkbox.value);
          }
          app.groupEditorPendingPlanIds.delete(checkbox.value);
          delete GroupService.ensureProfesorMap(grupo)[checkbox.value];
          delete GroupService.ensureStructureMap(grupo)[checkbox.value];
          delete GroupService.ensureOptativeSlotMap(grupo)[checkbox.value];
        }
        grupo.planAsignaturas = [...app.groupEditorPendingPlanIds];
        this.renderEditor(app);
      };
    });
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
    const compatibleTeachers = GroupService.getCompatibleProfesores(
      app,
      view.entity,
      selected.asignatura.id,
    );
    const assignedTeacherId = GroupService.getAssignedProfesorId(
      view.entity,
      selected.asignatura.id,
    );
    const teacherOptions = [
      '<option value="">Sin asignar</option>',
      ...compatibleTeachers.map(
        (teacher) =>
          `<option value="${teacher.id}"${
            teacher.id === assignedTeacherId ? " selected" : ""
          }>${teacher.nombre}</option>`,
      ),
    ].join("");
    const availableSlots = GroupService.getAvailableOptativeSlots(app, view.entity);
    const assignedSlotId = GroupService.getOptativeSlotIds(
      view.entity,
      selected.asignatura.id,
    )[0] || "";
    const slotOptions = [
      '<option value="">Selecciona una franja</option>',
      ...availableSlots.map(
        (slot) =>
          `<option value="${slot.id}"${
            slot.id === assignedSlotId ? " selected" : ""
          }>${GroupService.formatOptativeSlot(slot)}</option>`,
      ),
    ].join("");
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
          <label for="group-subject-teacher">Profesor</label>
          <select id="group-subject-teacher">${teacherOptions}</select>
        </div>
        ${
          view.entity.tipo === "optativa"
            ? `<div class="group-subject-detail-variant">
                <label for="group-subject-slot">Franja permitida</label>
                <select id="group-subject-slot">${slotOptions}</select>
              </div>`
            : ""
        }
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

    const teacherSelect = document.getElementById("group-subject-teacher");
    if (teacherSelect) {
      teacherSelect.onchange = () => {
        GroupService.ensureProfesorMap(view.entity)[selected.asignatura.id] =
          teacherSelect.value || null;
        if (!app.groupEditorIsDraft) {
          app.horario.sesiones.forEach((session) => {
            if (
              session.grupoId === view.entity.id &&
              session.asignaturaId === selected.asignatura.id
            ) {
              session.profesorId = teacherSelect.value || null;
            }
          });
          GroupService.rebuildProfesorGroupLinks(app);
        }
        this.renderEditor(app);
        app.refreshGrid();
      };
    }

    const slotSelect = document.getElementById("group-subject-slot");
    if (slotSelect) {
      slotSelect.onchange = () => {
        const nextSlotId = slotSelect.value || "";
        const previousSlotId = GroupService.getOptativeSlotIds(
          view.entity,
          selected.asignatura.id,
        )[0] || "";
        const scheduledCount = (app.horario.sesiones || []).filter(
          (session) =>
            session.grupoId === view.entity.id &&
            session.asignaturaId === selected.asignatura.id,
        ).length;
        if (
          nextSlotId !== previousSlotId &&
          scheduledCount > 0 &&
          !window.confirm(
            `Cambiar la franja eliminara ${scheduledCount} segmento(s) programado(s). ` +
              "¿Continuar?",
          )
        ) {
          slotSelect.value = previousSlotId;
          return;
        }
        if (nextSlotId !== previousSlotId && scheduledCount > 0) {
          GroupService.clearScheduledSubjectSessions(
            app,
            view.entity.id,
            selected.asignatura.id,
          );
        }
        GroupService.setOptativeSlotIds(
          view.entity,
          selected.asignatura.id,
          nextSlotId ? [nextSlotId] : [],
        );
        this.renderEditor(app);
        app.refreshGrid();
      };
    }

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
    const selectGrade = document.getElementById("group-grade");
    const selectType = document.getElementById("group-type");

    const nextName = inputName?.value.trim() || "";
    if (!nextName) {
      alert("Escribe el nombre del grupo.");
      inputName?.focus();
      return;
    }

    const duplicateName = app.data.grupos.some(
      (item) =>
        item !== grupo &&
        String(item.nombre).trim().toLowerCase() === nextName.toLowerCase(),
    );
    if (duplicateName) {
      alert("Ya existe un grupo con ese nombre.");
      inputName?.focus();
      return;
    }

    const planIds = [...(app.groupEditorPendingPlanIds || [])];
    if (planIds.length === 0) {
      alert("Selecciona al menos una materia para el grupo.");
      return;
    }

    const nextType = selectType?.value === "optativa" ? "optativa" : "regular";
    if (nextType === "optativa") {
      const missingSlot = planIds.find(
        (subjectId) => GroupService.getOptativeSlotIds(grupo, subjectId).length === 0,
      );
      if (missingSlot) {
        const subject = app.data.asignaturas.find((item) => item.id === missingSlot);
        alert(`Selecciona una franja para ${subject?.nombre || missingSlot}.`);
        app.groupEditorSelectedAsignaturaId = missingSlot;
        this.renderEditor(app);
        return;
      }
      const selectedSlots = planIds.map(
        (subjectId) => GroupService.getOptativeSlotIds(grupo, subjectId)[0],
      );
      if (new Set(selectedSlots).size !== selectedSlots.length) {
        alert("Las materias del mismo grupo deben usar franjas diferentes.");
        return;
      }
    }

    grupo.nombre = nextName;
    if (selectTurno) grupo.turno = selectTurno.value || grupo.turno;
    grupo.grado = Number(selectGrade?.value) || grupo.grado;
    grupo.tipo = nextType;
    grupo.planAsignaturas = planIds;

    if (app.groupEditorIsDraft) {
      grupo.id = this.createGroupId(app, nextName);
      app.data.grupos.push(grupo);
      app.groupEditorIsDraft = false;
      app.groupEditorDraftSourceId = null;
      const cancelButton = document.getElementById("btn-group-cancel");
      if (cancelButton) cancelButton.style.display = "none";
    }

    GroupService.ensureProfesorAssignments(app, grupo);
    GroupService.rebuildProfesorGroupLinks(app);

    app.renderGruposList();
    this.renderEditor(app);
    app.updateTitle();
    app.refreshGrid();
  },

  renderGrid(app, grupo) {
    Views.resetVisibleHours?.();
    if (grupo.tipo === "optativa") {
      Views.setVisibleHours("08:00", "16:00");
    } else if (grupo.turno === "matutino") {
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
    if (app.groupEditorIsDraft) {
      alert("Guarda el grupo antes de programar sus sesiones.");
      return;
    }
    const existingSession = SessionService.findGroupSession(
      app,
      grupo.id,
      day,
      hour,
    );
    ScheduleEditor.openSessionDialog(app, day, hour, existingSession);
  },
};
