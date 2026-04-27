/**
 * Main Application Logic
 */
class App {
  constructor() {
    this.data = {
      academias: [],
      asignaturas: [],
      grupos: [],
      profesores: [],
      aulas: [],
    };
    this.horario = new Horario();
    this.currentView = { type: "GRUPO", entity: null };
    this.days = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];
    this.hours = this.buildSlots("08:00", "20:00", 30);
    this.profAcademiaFilter = "__ALL__";
    this.groupEditorSelectedAsignaturaId = null;
    this.fileContext = null;
    this.autoScheduleUseVariants = false;
    this.automationProgressHideTimer = null;
    this.templateCatalog = {
      A: {
        templateKey: "A",
        label: "Semestre A (impar)",
        fileName: "semestre_A.json",
        path: "data/semestre_A.json",
      },
      B: {
        templateKey: "B",
        label: "Semestre B (par)",
        fileName: "semestre_B.json",
        path: "data/semestre_B.json",
      },
    };
    this.init();
  }

  async init() {
    this.setupUI();
    this.setupEventListeners();
  }

  setupUI() {
    const academiasContainer = document.getElementById("academias-list");

    this.renderGruposList();
    this.renderAulasList();
    this._setActiveViewButton(this.currentView?.type || "GRUPO");
    if (academiasContainer) {
      Views.renderList("academias-list", this.data.academias, "nombre", (aca) =>
        this.selectAcademia(aca),
      );
    }

    Views.renderGrid("main-grid", this.days, this.hours, (day, hour, ev) =>
      this.handleCellClick(day, hour, ev),
    );

    Dialogs.setupCloseHandlers();
    this.updateTitle();
  }

  setupEventListeners() {
    this.setupMenuSections();

    const btnLoadTpl = document.getElementById("btn-load-template");
    if (btnLoadTpl) {
      btnLoadTpl.onclick = () => this.promptLoadTemplate();
    } else {
      console.warn("Carga de plantilla deshabilitada: falta #btn-load-template");
    }

    const btnAuto = document.getElementById("btn-auto-schedule");
    if (btnAuto) btnAuto.onclick = () => this.runAutoSchedule();
    const btnAutoAll = document.getElementById("btn-auto-schedule-all");
    if (btnAutoAll) btnAutoAll.onclick = () => this.runAutoScheduleAll();
    const btnAutoProfes = document.getElementById("btn-auto-profesores");
    if (btnAutoProfes) btnAutoProfes.onclick = () => this.runAutoAssignProfesores();
    const btnAutoRooms = document.getElementById("btn-auto-rooms");
    if (btnAutoRooms) btnAutoRooms.onclick = () => this.runAutoAssignRooms();
    const chkAutoUseVariants = document.getElementById("chk-auto-use-variants");
    if (chkAutoUseVariants) {
      chkAutoUseVariants.checked = !!this.autoScheduleUseVariants;
      chkAutoUseVariants.onchange = () => {
        this.autoScheduleUseVariants = !!chkAutoUseVariants.checked;
      };
    }

    const btnExport = document.getElementById("btn-export");
    if (btnExport) btnExport.onclick = () => this.exportData();
    const btnPrintGrupos = document.getElementById("btn-print-grupos");
    if (btnPrintGrupos) btnPrintGrupos.onclick = () => this.exportGruposHTML();
    const btnPrintProfes = document.getElementById("btn-print-profes");
    if (btnPrintProfes) btnPrintProfes.onclick = () => this.exportProfesoresHTML();
    const btnExportEscolares = document.getElementById("btn-export-escolares");
    if (btnExportEscolares) {
      btnExportEscolares.onclick = () => this.exportEscolaresTXT();
    }

    const btnImport = document.getElementById("btn-import");
    const importInput = document.getElementById("file-input");
    if (btnImport && importInput) {
      btnImport.onclick = () => importInput.click();
      importInput.onchange = (e) => this.importData(e);
    } else {
      console.warn(
        "No existe #btn-import o #file-input (Importar JSON deshabilitado)",
      );
    }

    const btnSaveSession = document.getElementById("form-save-session");
    if (btnSaveSession) btnSaveSession.onclick = () => this.saveSession();

    const btnDeleteSession = document.getElementById("form-delete-session");
    if (btnDeleteSession) btnDeleteSession.onclick = () => this.deleteSession();

    const btnConfirmLoadTemplate = document.getElementById(
      "btn-confirm-load-template",
    );
    if (btnConfirmLoadTemplate) {
      btnConfirmLoadTemplate.onclick = () => this.confirmLoadTemplateSelection();
    }

    const btnCancelLoadTemplate = document.getElementById(
      "btn-cancel-load-template",
    );
    if (btnCancelLoadTemplate) {
      btnCancelLoadTemplate.onclick = () => Dialogs.close("dialog-load-template");
    }

    const modal = document.getElementById("dialog-session");
    const closeX = document.querySelector("#dialog-session .close-modal");
    if (closeX && modal) closeX.onclick = () => (modal.style.display = "none");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
      });
    }

    const btnVG = document.getElementById("btn-view-grupos");
    if (btnVG) btnVG.onclick = () => this.switchView("GRUPO");

    const btnVP = document.getElementById("btn-view-profesores");
    if (btnVP) btnVP.onclick = () => this.switchView("PROFESOR");

    const btnVAu = document.getElementById("btn-view-aulas");
    if (btnVAu) btnVAu.onclick = () => this.switchView("AULA");

    const btnVA = document.getElementById("btn-view-academias");
    if (btnVA) btnVA.onclick = () => this.switchView("ACADEMIA");

    const selAcadProf = document.getElementById("prof-academia-filter");
    if (selAcadProf) {
      selAcadProf.onchange = () => {
        this.profAcademiaFilter = selAcadProf.value || "__ALL__";
        this.renderProfesoresList();
      };
    }

    const btnProfSave = document.getElementById("btn-prof-save");
    if (btnProfSave) btnProfSave.onclick = () => this.saveProfesorEdits();

    const btnGroupSave = document.getElementById("btn-group-save");
    if (btnGroupSave) btnGroupSave.onclick = () => this.saveGrupoEdits();

    document.addEventListener("keydown", (e) => {
      if (!e.ctrlKey) return;

      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "1") this.switchView("GRUPO");
      if (e.key === "2") this.switchView("PROFESOR");
      if (e.key === "3") this.switchView("AULA");
      if (e.key === "4") this.switchView("ACADEMIA");
    });

    window.addEventListener("resize", () => {
      this.refreshGrid();
    });
  }

  setupMenuSections() {
    const sections = Array.from(document.querySelectorAll(".menu-section"));
    const toggles = Array.from(document.querySelectorAll("[data-toggle-section]"));
    if (!sections.length || !toggles.length) return;

    const openSection = (targetName) => {
      sections.forEach((section) => {
        const isOpen = section.dataset.section === targetName;
        section.classList.toggle("is-open", isOpen);

        const toggle = section.querySelector("[data-toggle-section]");
        if (toggle) {
          toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        }
      });
    };

    toggles.forEach((toggle) => {
      toggle.onclick = () => {
        const targetName = toggle.dataset.toggleSection;
        const section = toggle.closest(".menu-section");
        const alreadyOpen = section?.classList.contains("is-open");
        if (alreadyOpen) return;
        openSection(targetName);
      };
    });
  }

  promptLoadTemplate() {
    const currentKey =
      this.fileContext?.templateKey ||
      (this.data?.meta?.periodo === "impar" ? "A" : "B");
    const select = document.getElementById("select-template-period");
    if (!select) {
      alert("No se encontro el selector de plantillas.");
      return;
    }

    select.value = currentKey === "B" ? "B" : "A";
    Dialogs.open("dialog-load-template");
    select.focus();
  }

  confirmLoadTemplateSelection() {
    const select = document.getElementById("select-template-period");
    const key = select?.value === "B" ? "B" : "A";
    Dialogs.close("dialog-load-template");
    this.loadBundledTemplate(key);
  }

  loadBundledTemplate(templateKey) {
    const templateInfo = this.templateCatalog?.[templateKey];
    if (!templateInfo) {
      alert("No se encontro la plantilla solicitada.");
      return;
    }

    const bundledTemplates = window.TEMPLATE_BUNDLES || null;
    const bundledTemplate = bundledTemplates?.[templateKey];
    if (!bundledTemplate) {
      alert(`No se encontro ${templateInfo.fileName} dentro de la app.`);
      return;
    }

    const jsonData =
      typeof structuredClone === "function" ?
        structuredClone(bundledTemplate)
      : JSON.parse(JSON.stringify(bundledTemplate));
    this.loadTemplateFromJson(jsonData, templateInfo);
  }

  _setActiveViewButton(type) {
    const map = {
      GRUPO: "btn-view-grupos",
      PROFESOR: "btn-view-profesores",
      AULA: "btn-view-aulas",
      ACADEMIA: "btn-view-academias",
    };

    Object.values(map).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });

    const id = map[type];
    const btn = document.getElementById(id);
    if (btn) btn.classList.add("active");
  }

  selectGrupo(grupo) {
    GroupView.select(this, grupo);
  }

  selectAcademia(academia) {
    this.currentView = { type: "ACADEMIA", entity: academia };
    this.updateTitle();
    this.refreshGrid();
  }

  selectProfesor(profesor) {
    TeacherView.select(this, profesor);
  }

  selectAula(aula) {
    AulaView.select(this, aula);
  }

  switchView(type) {
    this.currentView = { type, entity: null };

    const mainTitle = document.getElementById("current-view-title");
    if (mainTitle) {
      const map = {
        GRUPO: "Seleccione un Grupo",
        PROFESOR: "Seleccione un Profesor",
        AULA: "Seleccione un Aula",
        ACADEMIA: "Seleccione una Academia",
      };
      mainTitle.textContent = map[type] || "Seleccione";
    }

    const sidebarTitle = document.getElementById("sidebar-title");
    if (sidebarTitle) {
      const map = {
        GRUPO: "Grupos",
        PROFESOR: "Profesores",
        AULA: "Aulas",
        ACADEMIA: "Academias",
      };
      sidebarTitle.textContent = map[type] || "";
    }

    const show = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? "block" : "none";
    };

    show("grupos-list", type === "GRUPO");
    show("profesores-panel", type === "PROFESOR");
    show("aulas-list", type === "AULA");
    show("academias-list", type === "ACADEMIA");

    GroupView.hideEditor?.();
    const profEditor = document.getElementById("prof-editor");
    if (profEditor) profEditor.style.display = "none";
    const profGroupsUI = document.getElementById("prof-groups-ui");
    if (profGroupsUI) profGroupsUI.style.display = type === "PROFESOR" ? "block" : "none";

    this._setActiveViewButton(type);

    if (type === "PROFESOR") {
      this.renderProfesorFilters();
      this.renderProfesoresList();
    }

    if (type === "GRUPO") {
      this.renderGruposList();
    }

    if (type === "AULA") {
      this.renderAulasList();
    }

    this.refreshGrid();
  }

  updateTitle() {
    const el = document.getElementById("current-view-title");
    if (!el) return;

    const v = this.currentView;
    if (!v || !v.entity) {
      const map = {
        GRUPO: "Seleccione un Grupo",
        PROFESOR: "Seleccione un Profesor",
        AULA: "Seleccione un Aula",
        ACADEMIA: "Seleccione una Academia",
      };
      el.textContent = map[v?.type] || "Seleccione";
      return;
    }

    if (v.type === "GRUPO") {
      el.textContent = `Horario: ${v.entity.nombre} (${v.entity.turno})`;
      return;
    }
    if (v.type === "ACADEMIA") {
      el.textContent = `Bloqueos: ${v.entity.nombre}`;
      return;
    }
    if (v.type === "PROFESOR") {
      el.textContent = `Profesor: ${v.entity.nombre}`;
      return;
    }
    if (v.type === "AULA") {
      el.textContent = `Aula: ${v.entity.nombre}`;
    }
  }

  refreshGrid() {
    Views.clearGrid();
    Views.resetVisibleHours?.();

    const v = this.currentView;
    if (!v || !v.entity) return;

    if (v.type === "GRUPO") {
      GroupView.renderGrid(this, v.entity);
      return;
    }

    if (v.type === "ACADEMIA") {
      AcademyView.renderGrid(this, v.entity);
      return;
    }

    if (v.type === "PROFESOR") {
      TeacherView.renderGrid(this, v.entity);
      return;
    }

    if (v.type === "AULA") {
      AulaView.renderGrid(this, v.entity);
    }
  }

  handleCellClick(day, hour, ev) {
    const v = this.currentView;
    if (!v || !v.entity) {
      alert("Selecciona un elemento de la lista primero.");
      return;
    }

    if (v.type === "ACADEMIA") {
      AcademyView.handleCellClick(this, v.entity, day, hour);
      return;
    }

    if (v.type === "GRUPO") {
      GroupView.handleCellClick(this, v.entity, day, hour);
      return;
    }

    if (v.type === "PROFESOR") {
      TeacherView.handleCellClick(this, v.entity, day, hour, ev);
    }
  }

  openSessionDialog(day, hour, session = null) {
    return ScheduleEditor.openSessionDialog(this, day, hour, session);
  }

  saveSession() {
    return ScheduleEditor.saveSession(this);
  }

  deleteSession() {
    return ScheduleEditor.deleteSession(this);
  }

  runAutoSchedule() {
    return ScheduleEditor.runAutoSchedule(this);
  }

  runAutoScheduleAll() {
    return ScheduleEditor.runAutoScheduleAll(this);
  }

  async runAutoAssignProfesores() {
    this.setAutomationBusy(true);
    this.setAutomationProgress({
      label: "Autoasignando profesores",
      detail: "Revisando grupos y materias...",
      current: 0,
      total: 1,
    });
    await this.pauseForUi();

    const summary = GroupService.autoAssignProfesores(this);
    if (this.currentView?.type === "GRUPO" && this.currentView?.entity) {
      GroupView.renderEditor(this);
    }
    if (this.currentView?.type === "PROFESOR") {
      this.renderProfesoresList();
    }
    this.refreshGrid();

    this.setAutomationProgress({
      label: "Autoasignacion de profesores completada",
      detail: `Nuevos: ${summary.asignadosNuevos} | Total: ${summary.totalAsignaciones}`,
      current: 1,
      total: 1,
      state: "success",
      autoHideMs: 5000,
    });
    this.setAutomationBusy(false);

    let msg = `Grupos revisados: ${summary.grupos}\n`;
    msg += `Asignaciones nuevas: ${summary.asignadosNuevos}\n`;
    msg += `Ya asignadas: ${summary.yaAsignados}\n`;
    msg += `Total con profesor: ${summary.totalAsignaciones}`;
    alert(msg);
  }

  async runAutoAssignRooms() {
    this.setAutomationBusy(true);
    this.setAutomationProgress({
      label: "Autoasignando aulas",
      detail: "Preparando bloques...",
      current: 0,
      total: 6,
    });

    const summary = await ClassroomService.autoAssign(this, async (progress) => {
      this.setAutomationProgress(progress);
      await this.pauseForUi();
    });
    if (this.currentView?.type === "GRUPO" && this.currentView?.entity) {
      GroupView.renderEditor(this);
    }
    if (this.currentView?.type === "AULA") {
      this.renderAulasList();
    }
    this.refreshGrid();

    let msg = `Bloques revisados: ${summary.totalBloques}\n`;
    msg += `Bloques con aula: ${summary.asignados}\n`;
    msg += `Sin aula: ${summary.sinAula}\n`;
    msg += `Especiales: ${summary.especiales}\n`;
    msg += `Laboratorios: ${summary.laboratorios}\n`;
    msg += `Estructura: ${summary.estructura}\n`;
    msg += `Optativas: ${summary.optativas}\n`;
    msg += `Recursamiento: ${summary.recursamiento}\n`;
    msg += `Fallback: ${summary.fallback}`;
    this.setAutomationProgress({
      label: "Autoasignacion completada",
      detail: `Asignados: ${summary.asignados} de ${summary.totalBloques} bloques`,
      current: 6,
      total: 6,
      state: "success",
      autoHideMs: 6000,
    });
    this.setAutomationBusy(false);
    alert(msg);
  }

  exportData() {
    Persistence.exportData(this);
  }

  exportGruposHTML() {
    ReportService.exportGruposHTML(this);
  }

  exportProfesoresHTML() {
    ReportService.exportProfesoresHTML(this);
  }

  exportEscolaresTXT() {
    ReportService.exportEscolaresTXT(this);
  }

  pauseForUi() {
    return new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  setAutomationBusy(isBusy) {
    [
      "btn-auto-profesores",
      "btn-auto-schedule",
      "btn-auto-schedule-all",
      "btn-auto-rooms",
    ].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = !!isBusy;
    });
  }

  setAutomationProgress({
    label = "Procesando...",
    detail = "",
    current = null,
    total = null,
    state = "running",
    autoHideMs = 0,
  } = {}) {
    const panel = document.getElementById("automation-progress");
    const labelEl = document.getElementById("automation-progress-label");
    const countEl = document.getElementById("automation-progress-count");
    const fillEl = document.getElementById("automation-progress-fill");
    const detailEl = document.getElementById("automation-progress-detail");
    if (!panel || !labelEl || !countEl || !fillEl || !detailEl) return;

    if (this.automationProgressHideTimer) {
      window.clearTimeout(this.automationProgressHideTimer);
      this.automationProgressHideTimer = null;
    }

    panel.hidden = false;
    panel.dataset.state = state || "running";
    labelEl.textContent = label;
    detailEl.textContent = detail || "";

    if (
      typeof current === "number" &&
      typeof total === "number" &&
      Number.isFinite(current) &&
      Number.isFinite(total) &&
      total > 0
    ) {
      const safeCurrent = Math.max(0, Math.min(current, total));
      const percent = Math.round((safeCurrent / total) * 100);
      countEl.textContent = `${safeCurrent}/${total}`;
      fillEl.style.width = `${percent}%`;
    } else {
      countEl.textContent = "";
      fillEl.style.width = "18%";
    }

    if (autoHideMs > 0) {
      this.automationProgressHideTimer = window.setTimeout(() => {
        panel.hidden = true;
        panel.dataset.state = "idle";
        this.automationProgressHideTimer = null;
      }, autoHideMs);
    }
  }

  importData(event) {
    Persistence.importData(this, event);
  }

  loadTemplateFromJson(jsonData, templateInfo = null) {
    return Persistence.loadTemplate(this, jsonData, templateInfo || {});
  }

  _ensureAllAcademias() {
    const allId = "__ALL__";
    if (!this.data?.academias) return;

    const already = this.data.academias.some((a) => a.id === allId);
    if (!already) {
      this.data.academias.unshift(new Academia(allId, "TODAS"));
    }
  }

  buildSlots(start, end, stepMinutes) {
    const toMin = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
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
  }

  renderProfesorFilters() {
    return TeacherView.renderFilters(this);
  }

  renderGruposList() {
    const activeId =
      this.currentView?.type === "GRUPO" ? this.currentView?.entity?.id : null;
    return Views.renderList(
      "grupos-list",
      this.data.grupos,
      "nombre",
      (grupo) => this.selectGrupo(grupo),
      activeId,
    );
  }

  renderProfesoresList() {
    return TeacherView.renderList(this);
  }

  renderAulasList() {
    return AulaView.renderList(this);
  }

  saveProfesorEdits() {
    return TeacherView.saveEdits(this);
  }

  saveGrupoEdits() {
    return GroupView.saveEdits(this);
  }

  _ensureProfesorGroupsUI() {
    return TeacherView.ensureGroupsUI(this);
  }

  renderProfesorGroupsUI() {
    return TeacherView.renderGroupsUI(this);
  }

  _getAcademiaNombre(academiaId) {
    return TeacherView.getAcademiaNombre(this, academiaId);
  }

  _getGruposDisponiblesParaProfesor(prof) {
    return TeacherView.getAvailableGroups(this, prof);
  }

  assignSelectedGroupToProfesor() {
    return TeacherView.assignSelectedGroup(this);
  }

  unassignSelectedGroupFromProfesor() {
    return TeacherView.unassignSelectedGroup(this);
  }

  previewGrupoForProfesor(grupoId) {
    return TeacherView.previewGrupo(this, grupoId);
  }
}

window.app = new App();
