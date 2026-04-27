const TeacherView = {
  select(app, profesor) {
    app.currentView = { type: "PROFESOR", entity: profesor };
    app.updateTitle();
    app.refreshGrid();

    const editor = document.getElementById("prof-editor");
    if (editor) editor.style.display = "block";

    const inpName = document.getElementById("prof-name");
    const selTurno = document.getElementById("prof-turno");
    const chkActivo = document.getElementById("prof-activo");

    if (inpName) inpName.value = profesor.nombre ?? "";
    if (selTurno) selTurno.value = profesor.turno ?? "matutino";
    if (chkActivo) chkActivo.checked = profesor.activo ?? true;

    this.ensureGroupsUI(app);
    const groupsUI = document.getElementById("prof-groups-ui");
    if (groupsUI) groupsUI.style.display = "block";
    this.renderGroupsUI(app);
  },

  renderGrid(app, profesor) {
    document.querySelectorAll(".timetable-grid tbody tr").forEach((row) => {
      row.style.display = "";
    });

    if (profesor.turno === "matutino") {
      Views.setVisibleHours("08:00", "16:00");
    } else {
      Views.setVisibleHours("12:00", "20:00");
    }

    const acadId = profesor.academiaId;

    app.horario.bloqueos
      ?.filter((b) => b.scope === "ACADEMIA" && b.targetId === acadId)
      .forEach((b) => {
        Views.updateCell(
          b.dia,
          b.hora,
          `<small>Acad: ${b.motivo || "Bloqueado"}</small>`,
          "#eeeeee",
          false,
        );
      });

    app.horario.bloqueos
      ?.filter((b) => b.scope === "PROFESOR" && b.targetId === profesor.id)
      .forEach((b) => {
        Views.updateCell(
          b.dia,
          b.hora,
          `<small>Prof: ${b.motivo || "Bloqueado"}</small>`,
          "#dddddd",
          false,
        );
      });

    const sesiones =
      app.horario.getSesionesByProfesor?.(profesor.id) ||
      app.horario.sesiones.filter((s) => s.profesorId === profesor.id);

    const blocks = Views.buildContiguousBlocks(
      sesiones,
      (sesion) =>
        [
          sesion.profesorId,
          sesion.grupoId,
          sesion.asignaturaId,
          sesion.tipoSesion || "clase",
        ].join("|"),
    ).map((block) => {
      const s = block.entries[0];
      const grupo = app.data.grupos.find((g) => g.id === s.grupoId);
      const asig = app.data.asignaturas.find((a) => a.id === s.asignaturaId);
      const endLabel =
        app.hours[block.endHour + 1] || app.hours[block.endHour] || "";

      const content = `
      <div class="session-info">
        <strong>${asig?.nombre ?? "???"}</strong>
        <small class="session-line">${app.hours[block.startHour]} - ${endLabel}</small>
        <small class="session-line">${grupo?.nombre ?? "???"}</small>
      </div>
    `;

      const blockedByAcademia = block.entries.some((entry) =>
        app.horario.isBlocked?.("ACADEMIA", acadId, entry.dia, entry.hora),
      );

      return {
        dia: block.dia,
        startHour: block.startHour,
        endHour: block.endHour,
        content,
        color: blockedByAcademia ? "#ffcdd2" : "#fff9c4",
        isConflict: !!blockedByAcademia,
      };
    });

    Views.renderMergedBlocks(blocks);
  },

  handleCellClick(app, profesor, day, hour, ev) {
    const isRight = ev && ev.type === "contextmenu";

    const hasSession = app.horario.sesiones.some(
      (s) => s.profesorId === profesor.id && s.dia === day && s.hora === hour,
    );
    if (hasSession) {
      alert(
        "No puedes bloquear/desbloquear una hora donde el profesor ya tiene sesión.",
      );
      return;
    }

    if (isRight) {
      const removed = app.horario.removeBloqueoByKey?.(
        "PROFESOR",
        profesor.id,
        day,
        hour,
      );
      if (removed) app.refreshGrid();
      return;
    }

    const exists = app.horario.hasBloqueo?.("PROFESOR", profesor.id, day, hour);
    if (exists) return;

    app.horario.addBloqueo?.(
      new Bloqueo("PROFESOR", profesor.id, day, hour, "Bloqueado"),
    );
    app.refreshGrid();
  },

  renderFilters(app) {
    const sel = document.getElementById("prof-academia-filter");
    if (!sel) return;

    const items = [
      { id: "__ALL__", nombre: "Todas" },
      ...app.data.academias
        .filter((a) => a.id !== "__ALL__")
        .map((a) => ({ id: a.id, nombre: a.nombre })),
    ];

    Views.populateSelect(sel, items, "nombre", "id");
    sel.value = app.profAcademiaFilter || "__ALL__";
  },

  renderList(app) {
    const acadId = app.profAcademiaFilter;

    let profesores = app.data.profesores.slice();
    if (acadId && acadId !== "__ALL__") {
      profesores = profesores.filter((p) => p.academiaId === acadId);
    }

    profesores.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    Views.renderList("profesores-list", profesores, "nombre", (p) =>
      app.selectProfesor(p),
    );
  },

  saveEdits(app) {
    const v = app.currentView;
    if (!v || v.type !== "PROFESOR" || !v.entity) return;

    const p = v.entity;

    const inpName = document.getElementById("prof-name");
    const selTurno = document.getElementById("prof-turno");
    const chkActivo = document.getElementById("prof-activo");

    if (inpName) p.nombre = inpName.value.trim() || p.nombre;
    if (selTurno) p.turno = selTurno.value;
    if (chkActivo) p.activo = chkActivo.checked;

    this.renderList(app);
    this.renderGroupsUI(app);
    app.refreshGrid();
  },

  ensureGroupsUI(app) {
    const host =
      document.getElementById("main-content") ||
      document.getElementById("content") ||
      document.body;

    if (document.getElementById("prof-groups-ui")) return;

    const div = document.createElement("div");
    div.id = "prof-groups-ui";
    div.style.margin = "12px 0";
    div.innerHTML = `
    <div style="margin-bottom:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      <button id="btn-prof-rebalance" class="btn">Rebalancear Academia</button>
      <small style="color:#666;">Redistribuye las materias de esta academia entre sus profesores.</small>
    </div>
    <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
      <div style="min-width:260px;">
        <h3 style="margin:0 0 8px;">Grupos asignados</h3>
        <select id="prof-grupos-asignados" size="8" style="width:260px;"></select>
        <div style="margin-top:8px;">
          <button id="btn-prof-quitar-grupo" class="btn">Quitar</button>
        </div>
      </div>

      <div style="min-width:260px;">
        <h3 style="margin:0 0 8px;">Grupos disponibles</h3>
        <select id="prof-grupos-disponibles" size="8" style="width:260px;"></select>
        <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
          <button id="btn-prof-asignar-grupo" class="btn btn-primary">Asignar</button>
          <label style="display:flex; gap:6px; align-items:center; user-select:none;">
            <input type="checkbox" id="chk-prof-preview" checked />
            Previsualizar
          </label>
        </div>
      </div>
    </div>
    <div id="prof-groups-hint" style="margin-top:8px; color:#666; font-size:13px;"></div>
  `;

    const grid = document.getElementById("main-grid");
    if (grid && grid.parentElement) {
      grid.parentElement.insertBefore(div, grid);
    } else {
      host.appendChild(div);
    }

    const btnAdd = document.getElementById("btn-prof-asignar-grupo");
    const btnRem = document.getElementById("btn-prof-quitar-grupo");
    const btnRebalance = document.getElementById("btn-prof-rebalance");
    const selDisp = document.getElementById("prof-grupos-disponibles");
    const selAsig = document.getElementById("prof-grupos-asignados");

    if (btnAdd) btnAdd.onclick = () => this.assignSelectedGroup(app);
    if (btnRem) btnRem.onclick = () => this.unassignSelectedGroup(app);
    if (btnRebalance) btnRebalance.onclick = () => this.rebalanceAcademia(app);

    if (selDisp) {
      selDisp.onchange = () => {
        const chk = document.getElementById("chk-prof-preview");
        if (chk && chk.checked) this.previewGrupo(app, selDisp.value);
        else app.refreshGrid();
      };
    }

    if (selAsig) {
      selAsig.onchange = () => {
        const chk = document.getElementById("chk-prof-preview");
        if (chk && chk.checked) this.previewGrupo(app, selAsig.value);
        else app.refreshGrid();
      };
    }
  },

  renderGroupsUI(app) {
    const v = app.currentView;
    if (!v || v.type !== "PROFESOR" || !v.entity) return;

    const prof = v.entity;

    const selAsig = document.getElementById("prof-grupos-asignados");
    const selDisp = document.getElementById("prof-grupos-disponibles");
    const hint = document.getElementById("prof-groups-hint");
    if (!selAsig || !selDisp) return;
    const loadSummary = GroupService.getProfesorLoadSummary(app, prof.id);
    const academiaSummary = GroupService.getAcademiaLoadSummary(app, prof.academiaId);

    const gruposAsignados = GroupService.getProfesorGroupIds(app, prof.id)
      .map((id) => app.data.grupos.find((g) => g.id === id))
      .filter(Boolean)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    selAsig.innerHTML = "";
    gruposAsignados.forEach((g) => {
      const assignedSubjects = GroupService.getProfesorAssignedAcademiaSubjects(
        app,
        g,
        prof,
      );
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = `${g.nombre} (${assignedSubjects.length} materia${
        assignedSubjects.length === 1 ? "" : "s"
      })`;
      selAsig.appendChild(opt);
    });

    const disponibles = this.getAvailableGroups(app, prof);

    selDisp.innerHTML = "";
    disponibles.forEach((g) => {
      const availableSubjects = GroupService.getProfesorAvailableAcademiaSubjects(
        app,
        g,
        prof,
      );
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = `${g.nombre} (${availableSubjects.length} sin profesor)`;
      selDisp.appendChild(opt);
    });

    if (hint) {
      hint.textContent =
        `Profesor: ${prof.nombre} - Academia: ${this.getAcademiaNombre(app, prof.academiaId)}. ` +
        `Asignados: ${gruposAsignados.length}, Disponibles: ${disponibles.length}, ` +
        `Materias: ${loadSummary.asignaciones}, Segmentos: ${loadSummary.segmentosProgramados}, ` +
        `Brecha academia: ${academiaSummary.brechaSegmentos}.`;
    }
  },

  getAcademiaNombre(app, academiaId) {
    return (
      app.data.academias.find((a) => a.id === academiaId)?.nombre ||
      academiaId ||
      "-"
    );
  },

  getAvailableGroups(app, prof) {
    return app.data.grupos
      .filter(
        (g) => GroupService.getProfesorAvailableAcademiaSubjects(app, g, prof).length > 0,
      )
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  },

  assignSelectedGroup(app) {
    const v = app.currentView;
    if (!v || v.type !== "PROFESOR" || !v.entity) return;

    const prof = v.entity;
    const selDisp = document.getElementById("prof-grupos-disponibles");
    if (!selDisp || !selDisp.value) return;
    const grupo = app.data.grupos.find((item) => item.id === selDisp.value);
    if (!grupo) return;

    const availableSubjects = GroupService.getProfesorAvailableAcademiaSubjects(
      app,
      grupo,
      prof,
    );
    if (availableSubjects.length === 0) {
      alert("Ese grupo ya no tiene materias disponibles para este profesor.");
      this.renderGroupsUI(app);
      return;
    }

    availableSubjects.forEach((asignatura) => {
      GroupService.assignProfesor(app, grupo, asignatura.id, prof.id);
      app.horario.sesiones.forEach((sesion) => {
        if (sesion.grupoId === grupo.id && sesion.asignaturaId === asignatura.id) {
          sesion.profesorId = prof.id;
        }
      });
    });

    GroupService.rebuildProfesorGroupLinks(app);

    this.renderGroupsUI(app);
    app.refreshGrid();
  },

  unassignSelectedGroup(app) {
    const v = app.currentView;
    if (!v || v.type !== "PROFESOR" || !v.entity) return;

    const prof = v.entity;
    const selAsig = document.getElementById("prof-grupos-asignados");
    if (!selAsig || !selAsig.value) return;
    const grupo = app.data.grupos.find((item) => item.id === selAsig.value);
    if (!grupo) return;

    const assignedSubjectIds = GroupService.getProfesorAssignedAcademiaSubjects(
      app,
      grupo,
      prof,
    );
    assignedSubjectIds.forEach((asignaturaId) => {
      GroupService.ensureProfesorMap(grupo)[asignaturaId] = null;
      app.horario.sesiones.forEach((sesion) => {
        if (
          sesion.grupoId === grupo.id &&
          sesion.asignaturaId === asignaturaId &&
          sesion.profesorId === prof.id
        ) {
          sesion.profesorId = null;
        }
      });
    });

    GroupService.rebuildProfesorGroupLinks(app);

    this.renderGroupsUI(app);
    app.refreshGrid();
  },

  previewGrupo(app, grupoId) {
    app.refreshGrid();

    const grupo = app.data.grupos.find((g) => g.id === grupoId);
    if (!grupo) return;

    const sesiones =
      app.horario.getSesionesByGrupo?.(grupo.id) ||
      app.horario.sesiones.filter((s) => s.grupoId === grupo.id);

    sesiones.forEach((s) => {
      const cell = document.querySelector(
        `.grid-cell[data-day="${s.dia}"][data-hour="${s.hora}"]`,
      );
      if (!cell) return;
      if (cell.innerHTML && cell.innerHTML.trim() !== "") return;

      const asig = app.data.asignaturas.find((a) => a.id === s.asignaturaId);
      const content = `<div class="session-info"><small>Vista: ${grupo.nombre}: ${asig?.nombre ?? ""}</small></div>`;
      Views.updateCell(s.dia, s.hora, content, "#f3e5f5", false);
    });
  },

  rebalanceAcademia(app) {
    const view = app.currentView;
    if (!view || view.type !== "PROFESOR" || !view.entity) return;

    const academiaId = view.entity.academiaId;
    if (!academiaId || academiaId === "__ALL__") return;

    const result = GroupService.rebalanceAcademiaAssignments(app, academiaId);
    this.renderList(app);
    this.renderGroupsUI(app);
    app.refreshGrid();
    alert(`Rebalanceo completado. Cambios: ${result.changed}`);
  },
};
