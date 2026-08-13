const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  window: {},
  setTimeout,
  clearTimeout,
});

const sourceFiles = [
  "core/models.js",
  "core/rules.js",
  "core/group-service.js",
  "core/persistence.js",
  "core/session-service.js",
  "core/classroom-service.js",
  "core/scheduler.js",
];
const source = sourceFiles
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");

vm.runInContext(
  `${source}\n;globalThis.testApi = {
    Persistence,
    SessionService,
    Rules,
    ClassroomService,
    GroupService,
    Grupo,
    Horario,
    Scheduler
  };`,
  context,
);

const {
  Persistence,
  SessionService,
  Rules,
  ClassroomService,
  GroupService,
  Grupo,
  Horario,
  Scheduler,
} = context.testApi;

const realFile = [
  path.join(root, "prueba_semestre_A_nuevo.json 3.json"),
  path.join(root, "data", "semestre_A.json"),
].find((file) => fs.existsSync(file));
const raw = fs.readFileSync(realFile, "utf8").replace(/^\uFEFF/, "");
const original = JSON.parse(raw);
const state = Persistence.hydrateState(original);
const app = {
  data: state.data,
  horario: state.horario,
  hours: Array.from({ length: 25 }, (_, index) => {
    const total = 8 * 60 + index * 30;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
      total % 60,
    ).padStart(2, "0")}`;
  }),
};

assert.equal(
  app.data.grupos.length,
  original.grupos.length,
  "must preserve all imported groups",
);
assert.equal(
  app.horario.sesiones.length,
  original.sesiones.length,
  "must preserve all imported sessions",
);
const hydratedBlockKeys = new Set(
  app.horario.bloqueos.map(
    (block) => `${block.scope}|${block.targetId ?? ""}|${block.dia}|${block.hora}`,
  ),
);
assert.ok(
  original.bloqueos.every((block) =>
    hydratedBlockKeys.has(
      `${block.scope}|${block.targetId ?? ""}|${block.dia}|${block.hora}`,
    ),
  ),
  "must preserve every real block while rebuilding fixed rules",
);
assert.ok(
  app.data.grupos.every((group) => group.tipo === "regular"),
  "v4 groups must migrate as regular groups",
);

const physicsClassRooms = SessionService.getAllowedAulas(
  app,
  "fisica_i",
  "clase",
);
const physicsLabRooms = SessionService.getAllowedAulas(
  app,
  "fisica_i",
  "laboratorio",
);
assert.ok(
  physicsClassRooms.every((room) => room.tipo !== "laboratorio"),
  "regular Physics classes must use non-lab rooms",
);
assert.ok(
  physicsLabRooms.length > 0 && physicsLabRooms.every((room) => room.tipo === "laboratorio"),
  "Physics lab sessions must use lab rooms",
);

const optativeGroup = new Grupo({
  id: "g521",
  nombre: "521",
  turno: "matutino",
  grado: 5,
  tipo: "optativa",
  planAsignaturas: ["matematicas_opt"],
  franjasOptativasPorAsignatura: { matematicas_opt: ["opt_5_f1"] },
});
const eveningOptativeGroup = new Grupo({
  id: "g531",
  nombre: "531",
  turno: "vespertino",
  grado: 5,
  tipo: "optativa",
});
assert.deepEqual(
  [...GroupService.getAvailableOptativeSlots(app, eveningOptativeGroup)].map(
    (slot) => slot.id,
  ),
  ["opt_5_f2", "opt_5_f3"],
  "an evening optative group must be able to use the 12:30 and 14:00 slots",
);
assert.equal(
  Rules.validateOptativeWindow(
    app.data,
    optativeGroup,
    "matematicas_opt",
    0,
    [0, 1, 2],
    app.hours,
  ).valid,
  true,
  "an optative must fit inside its assigned slot",
);
assert.equal(
  Rules.validateOptativeWindow(
    app.data,
    optativeGroup,
    "matematicas_opt",
    1,
    [0, 1, 2],
    app.hours,
  ).valid,
  false,
  "an optative must be rejected outside its assigned days",
);

const mathOptative = app.data.asignaturas.find(
  (subject) => subject.id === "matematicas_opt",
);
const mathTeacher = app.data.profesores.find(
  (teacher) => teacher.academiaId === "matematicas" && teacher.turno === "matutino",
);
const emptySchedule = new Horario();
const optativeScheduler = new Scheduler(emptySchedule, {
  data: app.data,
  getGrupo: (id) => (id === optativeGroup.id ? optativeGroup : null),
  getAsignatura: (id) => app.data.asignaturas.find((subject) => subject.id === id),
  getAcademia: (id) => app.data.academias.find((academy) => academy.id === id),
  getProfesor: (id) => app.data.profesores.find((teacher) => teacher.id === id),
  getProfesoresByAcademia: (id) =>
    app.data.profesores.filter((teacher) => teacher.academiaId === id),
  getAulas: () => app.data.aulas,
  reglasFijas: app.data.reglasFijas || [],
  hours: app.hours,
});
const optativeCandidates = optativeScheduler.collectCandidates({
  grupo: optativeGroup,
  asignatura: mathOptative,
  profesores: [mathTeacher],
  dur: 3,
});
assert.ok(optativeCandidates.length > 0, "the assigned optative slot must be schedulable");
assert.ok(
  optativeCandidates.every(
    (candidate) =>
      [0, 2].includes(candidate.day) &&
      candidate.hours.join(",") === "0,1,2",
  ),
  "automatic scheduling must not propose times outside the assigned optative slot",
);

const existingRooms = app.horario.sesiones.map((session) => session.aulaId || null);

(async () => {
  const missingRoomsBefore = existingRooms.filter((roomId) => !roomId).length;
  await ClassroomService.autoAssign(app);
  app.horario.sesiones.forEach((session, index) => {
    if (existingRooms[index]) {
      assert.equal(
        session.aulaId,
        existingRooms[index],
        "automatic room assignment must preserve existing rooms",
      );
    }
  });
  const missingRoomsAfter = app.horario.sesiones.filter(
    (session) => !session.aulaId,
  ).length;
  assert.ok(
    missingRoomsAfter <= missingRoomsBefore,
    "automatic room assignment must only fill missing rooms",
  );
  console.log(
    `Regression checks passed (rooms without assignment: ${missingRoomsBefore} -> ${missingRoomsAfter}).`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
