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
    Profesor,
    Sesion,
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
  Profesor,
  Sesion,
  Horario,
  Scheduler,
} = context.testApi;

const blockHorario = new Horario();
blockHorario.addSesion(new Sesion("g-block", "fisica_i", "t019", null, 0, 2, "clase", false, "block-1"));
blockHorario.addSesion(new Sesion("g-block", "fisica_i", "t019", null, 0, 3, "clase", true, "block-1"));
blockHorario.addSesion(new Sesion("g-block", "fisica_i", "t019", null, 0, 4, "clase", false, "block-2"));
assert.equal(
  SessionService.getBlockSessions({ horario: blockHorario }, "g-block", 0, 3).length,
  2,
  "editing a block must not absorb adjacent sessions from another block",
);

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
const editableSession = app.horario.sesiones[0];
const editResult = SessionService.saveGroupSession(app, {
  grupoId: editableSession.grupoId,
  asignaturaId: editableSession.asignaturaId,
  tipoSesion: editableSession.tipoSesion,
  profesorId: editableSession.profesorId,
  aulaId: editableSession.aulaId,
  locked: !editableSession.locked,
  day: editableSession.dia,
  hour: editableSession.hora,
  existingSession: editableSession,
});
assert.equal(editResult.valid, true, "toggling LOCK on an existing session must not self-conflict");
const templateData = JSON.parse(
  fs.readFileSync(path.join(root, "data", "semestre_A.json"), "utf8").replace(/^\uFEFF/, ""),
);
const templateState = Persistence.hydrateState(templateData);
const templateApp = {
  data: templateState.data,
  horario: templateState.horario,
  hours: app.hours,
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

const physics = templateApp.data.asignaturas.find((subject) => subject.id === "fisica_i");
const scienceVariants = physics.getBlockVariants();
assert.ok(
  scienceVariants.length >= 4,
  "lab sciences must expose the four approved weekly structures plus flexible distributions",
);
assert.equal(
  JSON.stringify(scienceVariants.slice(0, 4).map((variant) => variant.blocks.map((block) => `${block.kind}:${block.duration}`))),
  JSON.stringify([
    ["laboratorio:3", "clase:3", "clase:3"],
    ["laboratorio:3", "clase:3", "clase:3", "estudio:2"],
    ["clase:3", "clase:3", "clase:3"],
    ["laboratorio:3", "clase:4", "clase:4"],
  ]),
  "science variants must include the three original options and the 120-minute option",
);
assert.ok(
  scienceVariants.some((variant) =>
    variant.blocks.map((block) => `${block.kind}:${block.duration}`).join("|") ===
    "clase:2|clase:2|clase:2|clase:2",
  ),
  "lab sciences must also expose four 60-minute classes without laboratory",
);
assert.ok(
  scienceVariants.some((variant) =>
    variant.blocks.map((block) => `${block.kind}:${block.duration}`).join("|") ===
    "laboratorio:3|clase:2|clase:2|clase:2|clase:2",
  ),
  "lab sciences must expose four 60-minute classes with laboratory",
);
const variantGroup = new Grupo({
  id: "g-variant-summary",
  nombre: "Variante resumen",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["fisica_i"],
  estructuraPorAsignatura: { fisica_i: "default" },
});
const noStudySummary = GroupService.buildAsignaturaSummaries(templateApp, variantGroup)[0];
assert.equal(noStudySummary.variantKey, "default");
assert.equal(noStudySummary.requeridos, 9, "the no-study variant must require 9 segments");
assert.equal(noStudySummary.bloquesRequeridos, 3);
assert.equal(noStudySummary.estudioRequerido, false);
variantGroup.estructuraPorAsignatura.fisica_i = "ciencias_lab_clase_estudio";
const studySummary = GroupService.buildAsignaturaSummaries(templateApp, variantGroup)[0];
assert.equal(studySummary.variantKey, "ciencias_lab_clase_estudio");
assert.equal(studySummary.requeridos, 11, "the study variant must require 2 additional segments");
assert.equal(studySummary.bloquesRequeridos, 4);
assert.equal(studySummary.estudioRequerido, true);
const mathematics = templateApp.data.asignaturas.find((subject) => subject.id === "matematicas_i");
const mathematicsVariantKeys = mathematics.getBlockVariants().map((variant) => variant.key);
assert.ok(
  mathematicsVariantKeys.includes("class_only_2_2_2_2"),
  "subjects must expose the four 60-minute class option",
);
assert.ok(
  mathematicsVariantKeys.includes("sin_estudio"),
  "subjects with a study default must expose a no-study option",
);
const literature = templateApp.data.asignaturas.find((subject) => subject.id === "literatura_i");
assert.ok(
  literature.getBlockVariants().some((variant) =>
    variant.blocks.every((block) => block.kind === "clase") &&
    variant.blocks.map((block) => block.duration).join("_") === "3_3",
  ),
  "subjects with 120-minute defaults must expose the 90-minute recursamiento option",
);
mathematics.variantPreferences = mathematics.normalizeVariantPreferences({
  byModality: { recursamiento: "class_only_2_2_2_2" },
});
const preferredGroup = new Grupo({
  id: "g-preferred-variant",
  nombre: "Preferencia",
  turno: "matutino",
  grado: 2,
  planAsignaturas: ["matematicas_i"],
});
assert.equal(
  GroupService.getGroupModality(templateApp, preferredGroup),
  "recursamiento",
  "odd-period grade 2 must default to recursamiento",
);
assert.equal(
  GroupService.getSelectedStructureVariantKey(templateApp, preferredGroup, mathematics),
  "class_only_2_2_2_2",
  "automatic selection must honor the modality preference",
);
const defaultGroup = new Grupo({
  id: "g-default-variant",
  nombre: "Base",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["matematicas_i"],
});
mathematics.variantPreferences = mathematics.normalizeVariantPreferences({});
assert.equal(
  GroupService.getSelectedStructureVariantKey(templateApp, defaultGroup, mathematics),
  "default",
  "a new group without a preference must start with the base variant",
);
const partialVariantProfessor = templateApp.data.profesores.find(
  (profesor) => profesor.academiaId === mathematics.academiaId,
);
const partialVariantGroup = new Grupo({
  id: "g-partial-variant",
  nombre: "Variante parcial",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["matematicas_i"],
  profesoresPorAsignatura: {
    matematicas_i: partialVariantProfessor?.id || null,
  },
});
templateApp.horario.addSesion(
  new Sesion(
    partialVariantGroup.id,
    "matematicas_i",
    partialVariantProfessor?.id || null,
    null,
    0,
    0,
    "clase",
    false,
  ),
);
assert.doesNotThrow(
  () => GroupService.getRequirementStatus(templateApp, partialVariantGroup, mathematics),
  "variant scoring must handle a partially scheduled subject without recursing forever",
);
templateApp.horario.sesiones = templateApp.horario.sesiones.filter(
  (session) => session.grupoId !== partialVariantGroup.id,
);
const physicsValidationGroup = new Grupo({
  id: "g-physics-validation",
  nombre: "Fisica validacion",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["fisica_i"],
  profesoresPorAsignatura: { fisica_i: "t019" },
  estructuraPorAsignatura: { fisica_i: "ciencias_lab_clase_estudio" },
});
templateApp.data.grupos.push(physicsValidationGroup);
const physicsLabRoom = templateApp.data.aulas.find((room) => room.tipo === "laboratorio");
const physicsRegularRoom = templateApp.data.aulas.find((room) => room.tipo !== "laboratorio");
[
  [0, 0, "clase", physicsRegularRoom?.id, "physics-class-1"],
  [0, 1, "clase", physicsRegularRoom?.id, "physics-class-1"],
  [0, 2, "clase", physicsRegularRoom?.id, "physics-class-1"],
  [1, 0, "laboratorio", physicsLabRoom?.id, "physics-lab-1"],
  [1, 1, "laboratorio", physicsLabRoom?.id, "physics-lab-1"],
  [1, 2, "laboratorio", physicsLabRoom?.id, "physics-lab-1"],
  [2, 0, "estudio", physicsRegularRoom?.id, "physics-study-1"],
  [2, 1, "estudio", physicsRegularRoom?.id, "physics-study-1"],
].forEach(([day, hour, kind, roomId, blockId]) => {
  templateApp.horario.addSesion(
    new Sesion(
      physicsValidationGroup.id,
      "fisica_i",
      "t019",
      roomId,
      day,
      hour,
      kind,
      false,
      blockId,
    ),
  );
});
const physicsStatusBeforeLastClass = GroupService.getRequirementStatus(
  templateApp,
  physicsValidationGroup,
  templateApp.data.asignaturas.find((subject) => subject.id === "fisica_i"),
  { useVariants: true },
);
assert.equal(
  physicsStatusBeforeLastClass.requiredBlocks.reduce((sum, block) => sum + block.duration, 0),
  11,
);
assert.equal(
  physicsStatusBeforeLastClass.scheduledBlocks.reduce((sum, block) => sum + block.duration, 0),
  8,
);
const lastPhysicsClass = SessionService.validateGroupSession(templateApp, {
  grupoId: physicsValidationGroup.id,
  asignaturaId: "fisica_i",
  profesorId: "t019",
  aulaId: physicsRegularRoom?.id,
  tipoSesion: "clase",
  day: 3,
  hour: 0,
});
assert.equal(
  lastPhysicsClass.valid,
  true,
  "the final 90-minute Physics class must fit the selected 11-segment variant",
);
const savedLastPhysicsClass = SessionService.saveGroupSession(templateApp, {
  grupoId: physicsValidationGroup.id,
  asignaturaId: "fisica_i",
  profesorId: "t019",
  aulaId: physicsRegularRoom?.id,
  tipoSesion: "clase",
  day: 3,
  hour: 0,
});
assert.equal(
  savedLastPhysicsClass.valid,
  true,
  "saving the final 90-minute Physics class must succeed",
);
assert.equal(
  templateApp.horario.sesiones.filter(
    (session) => session.grupoId === physicsValidationGroup.id && session.asignaturaId === "fisica_i",
  ).length,
  11,
);

// Automatic scheduling must not accept a complete 3-segment block when only
// the two study segments remain for the selected 11-segment Physics variant.
const overfilledPhysicsGroup = new Grupo({
  id: "g-physics-overfilled",
  nombre: "Fisica excedida",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["fisica_i"],
  estructuraPorAsignatura: { fisica_i: "ciencias_lab_clase_estudio" },
});
const isolatedPhysicsProfessor = new Profesor({
  id: "t-physics-isolated",
  nombre: "Profesor de prueba",
  academiaId: "fisica",
  turno: "matutino",
});
const overfilledBlocks = [
  [0, 0, "laboratorio", physicsLabRoom?.id, "overfilled-lab"],
  [1, 0, "clase", physicsRegularRoom?.id, "overfilled-class-1"],
  [2, 0, "clase", physicsRegularRoom?.id, "overfilled-class-2"],
  [3, 0, "clase", physicsRegularRoom?.id, "overfilled-extra"],
];
overfilledBlocks.forEach(([day, start, kind, roomId, blockId]) => {
  const duration = kind === "laboratorio" ? 3 : 3;
  for (let offset = 0; offset < duration; offset += 1) {
    templateApp.horario.addSesion(
      new Sesion(
        overfilledPhysicsGroup.id,
        "fisica_i",
        isolatedPhysicsProfessor.id,
        roomId,
        day,
        start + offset,
        kind,
        false,
        blockId,
      ),
    );
  }
});
const overfilledSummary = GroupService.buildAsignaturaSummaries(
  templateApp,
  overfilledPhysicsGroup,
)[0];
assert.equal(overfilledSummary.programados, 12);
assert.equal(overfilledSummary.requeridos, 11);
assert.equal(
  overfilledSummary.pendientes,
  2,
  "pending segments must come from the unmatched study block, not a clamped total",
);
assert.equal(overfilledSummary.excedentes, 3);
assert.equal(overfilledSummary.bloquesCubiertos, 3);

const overfilledScheduler = new Scheduler(
  templateApp.horario,
  {
    data: templateApp.data,
    getAcademia: (id) => templateApp.data.academias.find((item) => item.id === id),
    getAsignatura: (id) => templateApp.data.asignaturas.find((item) => item.id === id),
    getGrupo: (id) =>
      [
        ...templateApp.data.grupos,
        overfilledPhysicsGroup,
      ].find((item) => item.id === id),
    getProfesor: (id) =>
      [...templateApp.data.profesores, isolatedPhysicsProfessor].find(
        (item) => item.id === id,
      ),
    getProfesoresByAcademia: (academiaId) =>
      [...templateApp.data.profesores, isolatedPhysicsProfessor].filter(
        (item) => item.academiaId === academiaId,
      ),
    hours: app.hours,
    reglasFijas: templateApp.data.reglasFijas,
  },
);
const overfilledCandidate = overfilledScheduler.validateCandidate(
  overfilledPhysicsGroup,
  physics,
  isolatedPhysicsProfessor,
  4,
  [0, 1, 2],
  "clase",
);
assert.equal(
  overfilledCandidate.valid,
  false,
  "the scheduler must reject a block that exceeds the selected variant total",
);
const cleanedOverfill = overfilledScheduler.cleanupOverassignedBlocks(
  overfilledPhysicsGroup.id,
  { useVariants: true },
);
assert.equal(cleanedOverfill.removedSessions, 3);
const cleanedSummary = GroupService.buildAsignaturaSummaries(
  templateApp,
  overfilledPhysicsGroup,
)[0];
assert.equal(cleanedSummary.programados, 9);
assert.equal(cleanedSummary.excedentes, 0);
assert.equal(cleanedSummary.pendientes, 2);

const stableVariantGroup = new Grupo({
  id: "g-stable-variant",
  nombre: "Variante estable",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["matematicas_i"],
});
templateApp.horario.addSesion(
  new Sesion(
    stableVariantGroup.id,
    "matematicas_i",
    isolatedPhysicsProfessor.id,
    null,
    0,
    0,
    "clase",
    false,
    "stable-math-class",
  ),
);
assert.equal(
  GroupService.getSelectedStructureVariantKey(
    templateApp,
    stableVariantGroup,
    mathematics,
  ),
  "default",
  "automatic variant resolution must keep the base variant after the first partial block",
);
preferredGroup.modalidad = "estructura";
assert.notEqual(
  GroupService.getGroupModality(templateApp, preferredGroup),
  "recursamiento",
  "an explicit group modality must override the period/grade rule",
);
assert.equal(templateApp.data.franjasOptativas.length, 4, "the fixed template must contain four optative slots");
assert.equal(
  templateApp.data.franjasOptativas.at(-1).inicio,
  "18:00",
  "the fourth optative slot must start at 18:00",
);

const structureRegistry = ClassroomService.createHomeRoomRegistry(templateApp);
ClassroomService.reserveHomeRoomsForGroups(
  templateApp,
  templateApp.data.grupos.filter((group) => ["101", "111", "102", "112", "301", "501"].includes(group.nombre)),
  structureRegistry,
);
assert.equal(structureRegistry.grupoAula.get("g101"), "a15", "odd 101 must use Aula 15");
assert.equal(structureRegistry.grupoAula.get("g111"), "a15", "odd 111 must share the Aula 15 pattern");
assert.equal(structureRegistry.grupoAula.get("g102"), "a14", "odd 102 must use Aula 14");
assert.equal(structureRegistry.grupoAula.get("g301"), "a4", "odd 301 must use Aula 4");
assert.equal(structureRegistry.grupoAula.get("g501"), "a1", "odd 501 must use Aula 1");

const evenData = JSON.parse(
  fs.readFileSync(path.join(root, "data", "semestre_B.json"), "utf8").replace(/^\uFEFF/, ""),
);
const evenState = Persistence.hydrateState(evenData);
const evenApp = { data: evenState.data, horario: evenState.horario, hours: app.hours };
assert.equal(
  GroupService.getGroupModality(evenApp, new Grupo({ id: "g-even", grado: 2, turno: "matutino" })),
  "estructura",
  "even-period grade 2 must default to estructura",
);
assert.equal(
  GroupService.getGroupModality(evenApp, new Grupo({ id: "g-even-re", grado: 1, turno: "matutino" })),
  "recursamiento",
  "even-period grade 1 must default to recursamiento",
);
const evenRegistry = ClassroomService.createHomeRoomRegistry(evenApp);
ClassroomService.reserveHomeRoomsForGroups(
  evenApp,
  evenApp.data.grupos.filter((group) => ["201", "211", "401", "601"].includes(group.nombre)),
  evenRegistry,
);
assert.equal(evenRegistry.grupoAula.get("g201"), "a15", "even 201 must use Aula 15");
assert.equal(evenRegistry.grupoAula.get("g211"), "a15", "even 211 must share the Aula 15 pattern");
assert.equal(evenRegistry.grupoAula.get("g401"), "a4", "even 401 must use Aula 4");
assert.equal(evenRegistry.grupoAula.get("g601"), "a1", "even 601 must use Aula 1");

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

const regularMorningGroup = new Grupo({
  id: "g-cross-morning",
  nombre: "Cruce matutino",
  turno: "matutino",
  grado: 5,
  planAsignaturas: ["matematicas_i"],
});
const eveningMathTeacher = app.data.profesores.find(
  (teacher) =>
    teacher.academiaId === "matematicas" &&
    teacher.turno === "vespertino" &&
    teacher.activo !== false,
);
assert.ok(eveningMathTeacher, "the fixture must include an active evening Math teacher");
assert.equal(
  GroupService.isProfesorCompatibleWithGrupoTurno(
    app,
    eveningMathTeacher,
    regularMorningGroup,
  ),
  true,
  "an evening teacher must be compatible with a morning group during the overlap",
);
assert.deepEqual(
  { ...Rules.getTimeWindowIntersection(
    Rules.getProfessorTimeWindow(app.data, eveningMathTeacher),
    Rules.getGroupTimeWindow(app.data, regularMorningGroup),
  ) },
  { inicio: "12:00", fin: "14:00" },
  "the default cross-turn overlap must be 12:00-14:00",
);
const compatibleMathTeachers = GroupService.getCompatibleProfesores(
  app,
  regularMorningGroup,
  "matematicas_i",
);
assert.equal(
  compatibleMathTeachers[0]?.turno,
  "matutino",
  "manual choices must prefer same-turn teachers while retaining cross-turn teachers",
);
assert.ok(
  compatibleMathTeachers.some((teacher) => teacher.id === eveningMathTeacher.id),
  "manual choices must include a compatible cross-turn teacher",
);

const regularEveningGroup = new Grupo({
  id: "g-cross-evening",
  nombre: "Cruce vespertino",
  turno: "vespertino",
  grado: 5,
  planAsignaturas: ["matematicas_i"],
});
const morningMathTeacher = app.data.profesores.find(
  (teacher) =>
    teacher.academiaId === "matematicas" &&
    teacher.turno === "matutino" &&
    teacher.activo !== false,
);
assert.equal(
  GroupService.isProfesorCompatibleWithGrupoTurno(
    app,
    morningMathTeacher,
    regularEveningGroup,
  ),
  true,
  "a morning teacher must be compatible with an evening group during the overlap",
);
assert.deepEqual(
  { ...Rules.getTimeWindowIntersection(
    Rules.getProfessorTimeWindow(app.data, morningMathTeacher),
    Rules.getGroupTimeWindow(app.data, regularEveningGroup),
  ) },
  { inicio: "14:00", fin: "16:00" },
  "the inverse default cross-turn overlap must be 14:00-16:00",
);

const exceptionalTeacher = new Profesor({
  id: "t-exception",
  nombre: "Permiso especial",
  academiaId: "matematicas",
  turno: "vespertino",
  horarioLaboral: { inicio: "10:00", fin: "18:00" },
});
assert.deepEqual(
  { ...Rules.getProfessorTimeWindow(app.data, exceptionalTeacher) },
  { inicio: "10:00", fin: "18:00" },
  "a professor-specific work window must override the default shift window",
);
const nonOverlappingSameTurnTeacher = new Profesor({
  id: "t-no-overlap",
  nombre: "Sin cruce real",
  academiaId: "matematicas",
  turno: "matutino",
  horarioLaboral: { inicio: "16:00", fin: "18:00" },
});
assert.equal(
  GroupService.isProfesorCompatibleWithGrupoTurno(
    app,
    nonOverlappingSameTurnTeacher,
    regularMorningGroup,
  ),
  false,
  "even a same-turn teacher must have a real work-window overlap with the group",
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

const advisoryBreakGroup = new Grupo({
  id: "g-advisory-breaks",
  nombre: "Asesorias",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["matematicas_i"],
});
const advisoryBreakSchedule = new Horario();
[0, 1, 2].forEach((day) => {
  [0, 2, 4].forEach((hour) => {
    advisoryBreakSchedule.addSesion(
      new Sesion(advisoryBreakGroup.id, "matematicas_i", null, null, day, hour),
    );
  });
});
const advisoryBreakScheduler = new Scheduler(advisoryBreakSchedule, {
  data: app.data,
  getGrupo: (id) => (id === advisoryBreakGroup.id ? advisoryBreakGroup : null),
  getAsignatura: (id) => app.data.asignaturas.find((subject) => subject.id === id),
  getAcademia: (id) => app.data.academias.find((academy) => academy.id === id),
  getProfesor: (id) => app.data.profesores.find((teacher) => teacher.id === id),
  getProfesoresByAcademia: (id) =>
    app.data.profesores.filter((teacher) => teacher.academiaId === id),
  getAulas: () => app.data.aulas,
  reglasFijas: app.data.reglasFijas || [],
  hours: app.hours,
});
const advisoryBreakStats = advisoryBreakScheduler.getGroupBreakStats(
  advisoryBreakGroup.id,
);
assert.equal(
  advisoryBreakStats.internalFreeSlots,
  6,
  "the schedule score must count internal half-hour advisory slots",
);
assert.equal(
  advisoryBreakStats.daysWithBreak,
  3,
  "advisory slots must be distributed across multiple days",
);
assert.equal(
  JSON.stringify([...advisoryBreakStats.breaksByDay]),
  JSON.stringify([2, 2, 2, 0, 0]),
);
assert.equal(advisoryBreakScheduler.getWeeklyAdvisoryBreakTarget(), 8);

const repairState = Persistence.hydrateState(templateData);
const repairTargetGroup = new Grupo({
  id: "g-repair-target",
  nombre: "Optativa computacion",
  turno: "matutino",
  grado: 5,
  tipo: "optativa",
  planAsignaturas: ["artes_opt"],
  profesoresPorAsignatura: { artes_opt: "t002" },
  franjasOptativasPorAsignatura: { artes_opt: "opt_5_f1" },
});
const repairBlockerGroup = new Grupo({
  id: "g-repair-blocker",
  nombre: "Computacion bloqueadora",
  turno: "matutino",
  grado: 1,
  planAsignaturas: ["artes_i"],
  profesoresPorAsignatura: { artes_i: "t001" },
});
repairState.data.grupos.push(repairTargetGroup, repairBlockerGroup);
[0, 2].forEach((day, index) => {
  [0, 1, 2].forEach((hour) => {
    repairState.horario.addSesion(
      new Sesion(
        repairBlockerGroup.id,
        "artes_i",
        "t001",
        null,
        day,
        hour,
        "clase",
        false,
        `repair-block-${index + 1}`,
      ),
    );
  });
});
const repairScheduler = new Scheduler(repairState.horario, {
  data: repairState.data,
  getGrupo: (id) => repairState.data.grupos.find((grupo) => grupo.id === id),
  getAsignatura: (id) =>
    repairState.data.asignaturas.find((subject) => subject.id === id),
  getAcademia: (id) =>
    repairState.data.academias.find((academy) => academy.id === id),
  getProfesor: (id) =>
    repairState.data.profesores.find((teacher) => teacher.id === id),
  getProfesoresByAcademia: (id) =>
    repairState.data.profesores.filter((teacher) => teacher.academiaId === id),
  getAulas: () => repairState.data.aulas,
  reglasFijas: repairState.data.reglasFijas || [],
  hours: app.hours,
});
assert.equal(
  repairScheduler.collectCandidates({
    grupo: repairTargetGroup,
    asignatura: repairState.data.asignaturas.find((subject) => subject.id === "artes_opt"),
    profesores: [repairState.data.profesores.find((teacher) => teacher.id === "t002")],
    dur: 3,
  }).length,
  0,
  "the target optative must initially be blocked by the computer academy room",
);
const repairResult = repairScheduler.repairGroupScheduleGlobally(
  repairTargetGroup.id,
  [
    {
      asignaturaId: "artes_opt",
      profesorId: "t002",
      kind: "clase",
      blockDuration: 3,
    },
  ],
);
assert.ok(repairResult.assigned.length === 3, "global repair must place the blocked target block");
assert.ok(repairResult.movedBlocks >= 1, "global repair must move the blocking block");
assert.ok(
  repairResult.displacedGroupIds.includes(repairBlockerGroup.id),
  "global repair must report the group whose block was displaced",
);
assert.equal(
  repairState.horario.sesiones.filter(
    (session) => session.grupoId === repairTargetGroup.id,
  ).length,
  3,
);
assert.equal(
  repairState.horario.sesiones.filter(
    (session) => session.grupoId === repairBlockerGroup.id,
  ).length,
  6,
  "moving a blocker must preserve all of its sessions",
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
