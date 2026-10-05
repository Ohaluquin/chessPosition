const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const timers = new Set();
const context = vm.createContext({
  console, window: {}, alert: () => {},
  document: { querySelectorAll: () => [], getElementById: () => null },
  setTimeout: (fn) => { timers.add(fn); return fn; },
  clearTimeout: (fn) => timers.delete(fn),
});
const files = ["core/models.js", "core/rules.js", "core/group-service.js", "core/persistence.js",
  "core/session-service.js", "core/workspace-history.js", "core/schedule-audit.js", "ui/group-view.js", "ui/dialogs.js"];
vm.runInContext(files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n") +
  "\n;globalThis.api = { Persistence, GroupService, GroupView, WorkspaceHistory, ScheduleAudit, Sesion, Bloqueo };", context);
const { Persistence, GroupService, GroupView, WorkspaceHistory, ScheduleAudit, Sesion, Bloqueo } = context.api;
const base = {
  meta: { periodo: "impar", version: 6 }, config: {}, reglasFijas: [], franjasOptativas: [],
  academias: [{ id: "ac", nombre: "Ciencias" }],
  asignaturas: [{ id: "s", nombre: "Materia", academiaId: "ac", sesionesPorSemana: 1, duracionSegmentos: 2 }],
  grupos: [{ id: "g1", nombre: "101", turno: "matutino", grado: 1, planAsignaturas: ["s"], profesoresPorAsignatura: { s: "p1" } }],
  profesores: [{ id: "p1", nombre: "Profesor", academiaId: "ac", turno: "matutino", gruposAsignados: ["g1"] }],
  aulas: [{ id: "a1", nombre: "Aula 1", tipo: "normal" }],
  sesiones: [0, 1].map((hora) => ({ grupoId: "g1", asignaturaId: "s", profesorId: "p1", aulaId: "a1", dia: 0, hora,
    tipoSesion: "clase", blockId: "b1", locked: true })), bloqueos: [],
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalize = (value) => JSON.parse(JSON.stringify(value));
const memoryStorage = () => {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), entries };
};
function makeApp(json = base, storage = memoryStorage()) {
  const state = Persistence.hydrateState(clone(json), { exact: true });
  const app = {
    ...state, currentView: { type: "GRUPO", entity: state.data.grupos[0] || null }, automationBusy: false,
    fileContext: { kind: "import", fileName: "trabajo.json", label: "trabajo.json" },
    buildSlots(start, end, step) {
      const toMin = (label) => { const [h, m] = label.split(":").map(Number); return h * 60 + m; };
      const slots = [];
      for (let time = toMin(start); time <= toMin(end); time += step) slots.push(`${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`);
      return slots;
    },
    setupUI() {}, updateTitle() {}, refreshGrid() {},
    switchView(type) { this.currentView = { type, entity: null }; },
    selectGrupo(entity) { this.currentView = { type: "GRUPO", entity }; },
    selectProfesor(entity) { this.currentView = { type: "PROFESOR", entity }; },
    selectAula(entity) { this.currentView = { type: "AULA", entity }; },
    selectAcademia(entity) { this.currentView = { type: "ACADEMIA", entity }; },
    editWorkspace(label, action, options) { return this.workspaceHistory.run(label, action, options); },
  };
  app.hours = app.buildSlots("08:00", "20:00", 30);
  app.workspaceHistory = new WorkspaceHistory(app, { storage: () => storage });
  return app;
}

async function main() {
  const json = clone(base);
  json.grupos.push({ ...clone(json.grupos[0]), id: "g2", nombre: "102" });
  json.profesores[0].gruposAsignados.push("g2");
  json.sesiones.push({ ...clone(json.sesiones[0]), grupoId: "g2", dia: 1, blockId: "other" });
  json.bloqueos = [
    { scope: "GRUPO", targetId: "g1", dia: 2, hora: 0 },
    { scope: "GRUPO", targetId: "g2", dia: 2, hora: 0 },
    { scope: "PROFESOR", targetId: "g1", dia: 3, hora: 0 },
    { scope: "AULA", targetId: "a1", dia: 3, hora: 0 },
  ];
  json.config.aulasPorGrupo = { "101": "a1", g1: "a1" };
  const app = makeApp(json);
  const history = app.workspaceHistory;
  const original = history.capture().documentJSON;
  let confirmation = "";
  context.window.confirm = (message) => { confirmation = message; return false; };
  GroupView.deleteGroup(app);
  assert.match(confirmation, /101/);
  assert.match(confirmation, /2 con LOCK/);
  assert.equal(history.capture().documentJSON, original, "cancelled deletion must leave all references intact");
  assert.equal(history.undoStack.length, 0);
  app.automationBusy = true;
  confirmation = "";
  GroupView.deleteGroup(app);
  assert.equal(confirmation, "", "deletion must not run during scheduling");
  app.automationBusy = false;
  context.window.confirm = () => true;
  GroupView.deleteGroup(app);
  assert.deepEqual(normalize(app.data.grupos.map((group) => group.id)), ["g2"]);
  assert.equal(app.horario.sesiones.length, 1, "remove locked and unlocked sessions only for the selected group");
  assert.equal(app.horario.sesiones[0].grupoId, "g2");
  assert.equal(app.horario.bloqueos.length, 3, "keep teacher/room blocks even when their target ID equals the deleted group ID");
  assert.deepEqual(normalize(app.data.profesores[0].gruposAsignados), ["g2"]);
  assert.deepEqual(normalize(app.data.config.aulasPorGrupo), json.config.aulasPorGrupo);
  assert.equal(app.currentView.entity, null);
  assert.equal(history.hasUnexportedChanges(), true);
  const deleted = history.capture().documentJSON;
  assert.equal(history.undo(), true);
  assert.equal(history.capture().documentJSON, original, "undo restores exact sessions, locks, blocks, assignments and configuration");
  assert.equal(app.currentView.entity.id, "g1");
  assert.equal(app.horario.sesiones[0].locked, true);
  assert.equal(history.hasUnexportedChanges(), false);
  assert.equal(history.redo(), true);
  assert.equal(history.capture().documentJSON, deleted);
  assert.equal(GroupService.deleteGroup(app, "unknown"), false);
  assert.equal(history.capture().documentJSON, deleted);
  history.undo();
  history.run("Rename", () => { app.data.grupos[0].nombre = "101 nuevo"; });
  assert.equal(history.redoStack.length, 0, "a new edit invalidates redo");
  const beforeNoOp = history.undoStack.length;
  history.run("No change", () => {});
  assert.equal(history.undoStack.length, beforeNoOp);
  for (let i = 0; i < 30; i += 1) history.run("Change", () => { app.data.grupos[0].nombre = `group ${i}`; });
  assert.equal(history.undoStack.length, WorkspaceHistory.MAX_ENTRIES);

  const last = makeApp();
  last.workspaceHistory.run("Delete last", () => GroupService.deleteGroup(last, "g1"));
  assert.equal(last.data.grupos.length, 0);
  assert.equal(last.horario.sesiones.length, 0);
  last.workspaceHistory.undo();
  assert.equal(last.data.grupos.length, 1);

  const asyncApp = makeApp();
  const beforeAsync = asyncApp.workspaceHistory.capture().documentJSON;
  await asyncApp.workspaceHistory.run("Whole automatic pass", async () => {
    asyncApp.horario.sesiones[0].locked = false;
    await Promise.resolve();
    asyncApp.workspaceHistory.run("Concurrent edit", () => { throw new Error("Must not run"); });
    asyncApp.horario.sesiones[1].aulaId = null;
  });
  assert.equal(asyncApp.workspaceHistory.undoStack.length, 1);
  asyncApp.workspaceHistory.undo();
  assert.equal(asyncApp.workspaceHistory.capture().documentJSON, beforeAsync);
  asyncApp.workspaceHistory.run("Unexported change", () => { asyncApp.data.grupos[0].nombre = "Unsaved"; });
  assert.throws(() => asyncApp.workspaceHistory.run("Failed import", () => { throw new Error("Invalid JSON"); }, { markSaved: true }), /Invalid JSON/);
  assert.equal(asyncApp.workspaceHistory.hasUnexportedChanges(), true, "a failed load must not mark existing unsaved edits as saved");
  await assert.rejects(asyncApp.workspaceHistory.run("Failed async import", async () => { throw new Error("Invalid JSON"); }, { markSaved: true }), /Invalid JSON/);
  assert.equal(asyncApp.workspaceHistory.hasUnexportedChanges(), true);
  asyncApp.workspaceHistory.undo();
  assert.throws(() => asyncApp.workspaceHistory.run("Partial failure", () => {
    asyncApp.data.grupos[0].nombre = "Partial";
    throw new Error("Failure");
  }), /Failure/);
  assert.equal(asyncApp.workspaceHistory.running, false);
  asyncApp.workspaceHistory.undo();
  assert.equal(asyncApp.workspaceHistory.capture().documentJSON, beforeAsync);

  const storage = memoryStorage();
  const saved = makeApp(base, storage);
  saved.workspaceHistory.run("Change lock", () => { saved.horario.sesiones[0].locked = false; });
  assert.equal(saved.workspaceHistory.flushBackup(), true);
  const backup = storage.getItem(WorkspaceHistory.STORAGE_KEY);
  const reopened = makeApp({ ...clone(base), grupos: [], sesiones: [] }, storage);
  assert.ok(reopened.workspaceHistory.pendingRecovery);
  assert.equal(reopened.workspaceHistory.flushBackup(), false, "an empty tab must not overwrite pending recovery");
  assert.equal(storage.getItem(WorkspaceHistory.STORAGE_KEY), backup);
  reopened.workspaceHistory.markExported();
  assert.equal(storage.getItem(WorkspaceHistory.STORAGE_KEY), backup, "exporting an empty tab must not discard postponed recovery");
  assert.equal(reopened.workspaceHistory.recover(), true);
  assert.equal(reopened.horario.sesiones[0].locked, false);
  assert.equal(reopened.horario.sesiones[1].locked, true);
  assert.equal(reopened.currentView.entity.id, "g1");
  assert.equal(reopened.workspaceHistory.hasUnexportedChanges(), true);
  assert.equal(reopened.workspaceHistory.undoStack.length, 0);
  reopened.workspaceHistory.markExported();
  assert.equal(reopened.workspaceHistory.hasUnexportedChanges(), false);
  const cleanRecovery = makeApp(base, storage);
  cleanRecovery.workspaceHistory.recover();
  assert.equal(cleanRecovery.workspaceHistory.hasUnexportedChanges(), false);

  const failedStorage = { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } };
  const quotaApp = makeApp(base, failedStorage);
  quotaApp.workspaceHistory.run("Change despite quota", () => { quotaApp.data.grupos[0].nombre = "Changed"; });
  assert.equal(quotaApp.workspaceHistory.flushBackup(), false);
  assert.equal(quotaApp.workspaceHistory.backupState, "error");
  quotaApp.workspaceHistory.undo();
  assert.equal(quotaApp.data.grupos[0].nombre, "101");
  const denied = makeApp(base);
  denied.workspaceHistory.getStorage = () => { throw new Error("Access denied"); };
  assert.equal(denied.workspaceHistory.flushBackup(), false);
  const corruptStorage = memoryStorage();
  corruptStorage.setItem(WorkspaceHistory.STORAGE_KEY, "not JSON");
  const corruptApp = makeApp(base, corruptStorage);
  assert.equal(corruptApp.workspaceHistory.pendingRecovery, null);
  assert.equal(corruptApp.workspaceHistory.backupState, "error");
  const beforeInvalidRestore = corruptApp.workspaceHistory.capture().documentJSON;
  assert.throws(() => corruptApp.workspaceHistory.restore({ documentJSON: "not JSON" }));
  assert.equal(corruptApp.workspaceHistory.capture().documentJSON, beforeInvalidRestore);

  const derived = makeApp();
  derived.data.reglasFijas = [{ scope: "GRUPO", turno: "matutino", grado: 1, dia: "lunes", inicio: "10:00", fin: "10:30" }];
  const effective = Persistence.buildDerivedSchedule(derived.data);
  assert.ok(effective.bloqueos.length);
  derived.horario.bloqueos = [];
  derived.workspaceHistory.run("Rename after unblock", () => { derived.data.grupos[0].nombre = "Renamed"; });
  derived.workspaceHistory.undo();
  assert.equal(derived.horario.bloqueos.length, 0, "undo must not regenerate a fixed block intentionally removed by the user");

  const exportApp = makeApp();
  exportApp.workspaceHistory.run("Edit", () => { exportApp.data.grupos[0].nombre = "Export test"; });
  let downloads = 0;
  Persistence.downloadJson = () => { downloads += 1; };
  context.window.prompt = () => null;
  Persistence.exportData(exportApp);
  assert.equal(downloads, 0);
  assert.equal(exportApp.workspaceHistory.hasUnexportedChanges(), true, "cancelling export must not mark edits as exported");
  context.window.prompt = () => "backup.json";
  Persistence.exportData(exportApp);
  assert.equal(downloads, 1);
  assert.equal(exportApp.workspaceHistory.hasUnexportedChanges(), false);

  const auditApp = makeApp();
  const beforeAudit = auditApp.workspaceHistory.capture().documentJSON;
  const validAudit = ScheduleAudit.inspect(auditApp);
  assert.equal(validAudit.errors, 0, "sessions must not conflict with themselves");
  assert.equal(validAudit.warnings, 0);
  assert.equal(auditApp.workspaceHistory.capture().documentJSON, beforeAudit, "review must not mutate any workspace data");
  auditApp.data.asignaturas[0].weeklyBlockVariants = [{ key: "with_study", label: "Con estudio", blocks: [
    { kind: "clase", duration: 2 }, { kind: "estudio", duration: 2 },
  ] }];
  auditApp.data.grupos[0].estructuraPorAsignatura.s = "with_study";
  assert.ok(ScheduleAudit.inspect(auditApp).issues.some((issue) => issue.code === "pending_subject"));
  auditApp.horario.sesiones.push(new Sesion("g1", "s", "p1", "a1", 1, 0, "clase", false, "extra"));
  auditApp.horario.sesiones.push(new Sesion("g1", "s", "p1", "a1", 1, 1, "clase", false, "extra"));
  const shapeAudit = ScheduleAudit.inspect(auditApp);
  assert.ok(shapeAudit.issues.some((issue) => issue.code === "pending_subject"));
  assert.ok(shapeAudit.issues.some((issue) => issue.code === "extra_subject"), "matching total hours must not hide the wrong class/study structure");
  auditApp.horario.sesiones[0].aulaId = null;
  auditApp.horario.sesiones.push(new Sesion("g1", "s", "p1", "a1", 0, 1));
  auditApp.horario.bloqueos.push(new Bloqueo("GRUPO", "g1", 0, 1));
  auditApp.horario.sesiones.push(new Sesion("deleted", "missing", null, "missing-room", 0, 999));
  const broken = ScheduleAudit.inspect(auditApp);
  for (const code of ["extra_subject", "conflict_grupoId", "conflict_profesorId", "conflict_aulaId", "missing_room", "blocked_session", "orphan_session", "invalid_slot"]) {
    assert.ok(broken.issues.some((issue) => issue.code === code), `audit must detect ${code}`);
  }

  const cross = makeApp();
  cross.data.profesores[0].turno = "vespertino";
  cross.horario.sesiones.forEach((session, index) => { session.hora = 8 + index; });
  assert.equal(ScheduleAudit.inspect(cross).errors, 0, "valid teacher shift crossings must not be errors");
  cross.horario.sesiones[0].hora = 0;
  assert.ok(ScheduleAudit.inspect(cross).issues.some((issue) => issue.code === "unavailable_teacher"));
  const duplicate = makeApp();
  duplicate.data.grupos.push(duplicate.data.grupos[0]);
  const beforeDuplicateDelete = duplicate.workspaceHistory.capture().documentJSON;
  assert.equal(GroupService.deleteGroup(duplicate, "g1"), false, "ambiguous duplicate IDs must not delete several groups");
  assert.equal(duplicate.workspaceHistory.capture().documentJSON, beforeDuplicateDelete);
  assert.ok(ScheduleAudit.inspect(duplicate).issues.some((issue) => issue.code === "duplicate_grupos"));
  const oldVariant = makeApp();
  oldVariant.data.grupos[0].estructuraPorAsignatura.s = "removed_variant";
  const beforeResolve = oldVariant.workspaceHistory.capture().documentJSON;
  assert.equal(GroupService.getSelectedStructureVariantKey(oldVariant, oldVariant.data.grupos[0], oldVariant.data.asignaturas[0]), "default");
  assert.equal(oldVariant.workspaceHistory.capture().documentJSON, beforeResolve, "resolving a removed variant must not change history snapshots");
  console.log("Workspace checks passed (deletion, history, local recovery and read-only review).");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
