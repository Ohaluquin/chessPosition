/** Applied workspace changes only; form drafts and the bundled templates stay separate. */
class WorkspaceHistory {
  static STORAGE_KEY = "generador-horarios:workspace:v1";
  static MAX_ENTRIES = 20;

  constructor(app, { storage = () => window.localStorage, onChange = () => {} } = {}) {
    this.app = app;
    this.getStorage = storage;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
    this.running = false;
    this.restoring = false;
    this.timer = null;
    this.savedDocument = this.capture().documentJSON;
    this.backupState = "idle";
    this.backupTime = null;
    this.pendingRecovery = this.readBackup();
  }

  serialize(value) {
    return JSON.stringify(value, (_key, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
    });
  }

  capture() {
    const view = this.app.currentView || {};
    return {
      documentJSON: this.serialize(Persistence.buildExportData(this.app)),
      fileContext: this.app.fileContext ? JSON.parse(JSON.stringify(this.app.fileContext)) : null,
      selection: { type: view.type || "GRUPO", id: view.entity?.id || null },
      subjectId: this.app.groupEditorSelectedAsignaturaId || null,
    };
  }

  hasUnexportedChanges() {
    return this.capture().documentJSON !== this.savedDocument;
  }

  run(label, action, { markSaved = false } = {}) {
    if (this.restoring) return action();
    if (this.running || this.app.automationBusy) return;
    const before = this.capture();
    this.running = true;
    this.onChange();
    const finish = (succeeded) => {
      this.running = false;
      const after = this.capture();
      if (before.documentJSON !== after.documentJSON) {
        this.undoStack.push({ label, snapshot: before });
        this.undoStack = this.undoStack.slice(-WorkspaceHistory.MAX_ENTRIES);
        this.redoStack = [];
        if (this.app.fileContext) this.app.fileContext.modified = true;
      }
      const shouldMarkSaved = markSaved && succeeded;
      if (shouldMarkSaved) {
        this.savedDocument = after.documentJSON;
        if (this.app.fileContext) this.app.fileContext.modified = false;
      }
      // A deliberate edit/replacement supersedes the recovery offered at startup.
      if (before.documentJSON !== after.documentJSON || shouldMarkSaved) {
        this.pendingRecovery = null;
        this.queueBackup();
      }
      this.onChange();
    };
    let result;
    try {
      result = action();
    } catch (error) {
      // Even a partially completed operation remains undoable.
      finish(false);
      throw error;
    }
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).then(
        (value) => { finish(true); return value; },
        (error) => { finish(false); throw error; },
      );
    }
    finish(true);
    return result;
  }

  undo() { return this.moveHistory(this.undoStack, this.redoStack); }
  redo() { return this.moveHistory(this.redoStack, this.undoStack); }

  moveHistory(from, to) {
    if (this.running || this.app.automationBusy || !from.length) return false;
    const entry = from[from.length - 1];
    const current = this.capture();
    this.restore(entry.snapshot);
    from.pop();
    to.push({ label: entry.label, snapshot: current });
    this.pendingRecovery = null;
    this.queueBackup();
    this.onChange();
    return true;
  }

  restore(snapshot) {
    // Hydrate first, so an unreadable snapshot cannot erase the current workspace.
    const state = Persistence.hydrateState(JSON.parse(snapshot.documentJSON), { exact: true });
    this.restoring = true;
    try {
      Persistence.applyState(this.app, state, snapshot.fileContext ? JSON.parse(JSON.stringify(snapshot.fileContext)) : null);
      const selection = snapshot.selection || {};
      const collection = {
        GRUPO: "grupos", PROFESOR: "profesores", AULA: "aulas", ACADEMIA: "academias",
      }[selection.type] || "grupos";
      const type = ["GRUPO", "PROFESOR", "AULA", "ACADEMIA"].includes(selection.type)
        ? selection.type : "GRUPO";
      const entity = this.app.data[collection].find((item) => item.id === selection.id);
      this.app.switchView(type);
      this.app.groupEditorSelectedAsignaturaId = snapshot.subjectId || null;
      if (entity) {
        const method = { GRUPO: "selectGrupo", PROFESOR: "selectProfesor", AULA: "selectAula", ACADEMIA: "selectAcademia" }[type];
        this.app[method](entity);
      }
    } finally {
      this.restoring = false;
    }
  }

  queueBackup() {
    if (this.timer) clearTimeout(this.timer);
    this.backupState = "pending";
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushBackup();
    }, 400);
  }

  flushBackup() {
    if (this.pendingRecovery) return false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      const savedAt = new Date().toISOString();
      this.getStorage().setItem(WorkspaceHistory.STORAGE_KEY, JSON.stringify({
        version: 1, savedAt, snapshot: this.capture(), dirty: this.hasUnexportedChanges(),
      }));
      this.backupState = "saved";
      this.backupTime = savedAt;
      this.onChange();
      return true;
    } catch (error) {
      this.backupState = "error";
      this.onChange();
      return false;
    }
  }

  readBackup() {
    try {
      const raw = this.getStorage().getItem(WorkspaceHistory.STORAGE_KEY);
      if (!raw) return null;
      const backup = JSON.parse(raw);
      if (backup.version !== 1 || typeof backup.snapshot?.documentJSON !== "string") {
        throw new Error("Unsupported recovery format");
      }
      const document = JSON.parse(backup.snapshot.documentJSON);
      if (!["grupos", "profesores", "asignaturas", "academias", "aulas", "sesiones", "bloqueos"]
        .every((key) => Array.isArray(document[key]))) throw new Error("Invalid recovery data");
      return backup;
    } catch (error) {
      this.backupState = "error";
      return null;
    }
  }

  recover() {
    if (!this.pendingRecovery || this.running || this.app.automationBusy) return false;
    const backup = this.pendingRecovery;
    this.restore(backup.snapshot);
    this.savedDocument = backup.dirty ? null : this.capture().documentJSON;
    this.pendingRecovery = null;
    this.undoStack = [];
    this.redoStack = [];
    this.backupState = "saved";
    this.backupTime = backup.savedAt;
    this.onChange();
    return true;
  }

  markExported() {
    this.savedDocument = this.capture().documentJSON;
    if (this.app.fileContext) this.app.fileContext.modified = false;
    // Exporting the initial empty page must not overwrite a backup the user
    // postponed restoring. Only an applied edit/load supersedes that backup.
    if (!this.pendingRecovery) this.flushBackup();
    else this.onChange();
  }
}
