// Integration smoke test of the real page/controllers in a small detached DOM.
// No browser, network, external packages or real localStorage are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.className = ""; this.textContent = ""; this.disabled = false; this.hidden = false;
    this.checked = false; this._value = null; this._html = ""; this.offsetParent = null;
    const changeClass = (token, present) => {
      const tokens = new Set(this.className.split(/\s+/).filter(Boolean));
      if (present) tokens.add(token); else tokens.delete(token);
      this.className = [...tokens].join(" ");
    };
    this.classList = {
      add: (...tokens) => tokens.forEach((token) => changeClass(token, true)),
      remove: (...tokens) => tokens.forEach((token) => changeClass(token, false)),
      contains: (token) => this.className.split(/\s+/).includes(token),
      toggle: (token, flag) => changeClass(token, flag ?? !this.classList.contains(token)),
    };
  }
  setAttribute(key, value = "") {
    this.attributes[key] = value;
    if (key === "class") this.className = value;
    else if (key === "style") value.split(";").forEach((entry) => {
      const [name, content] = entry.split(":"); if (name) this.style[name.trim()] = content?.trim();
    });
    else if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase())] = value;
    else if (["checked", "hidden", "disabled", "selected"].includes(key)) this[key] = true;
    else this[key] = value;
  }
  get value() {
    if (this._value !== null) return this._value;
    const option = this.querySelectorAll("option").find((item) => item.selected) || this.querySelector("option");
    return this.tagName === "SELECT" ? option?.value || "" : "";
  }
  set value(value) { this._value = String(value); }
  get options() { return this.querySelectorAll("option"); }
  appendChild(child) {
    child.remove(); child.parentElement = this; this.children.push(child); return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, next) {
    child.remove(); child.parentElement = this;
    const index = this.children.indexOf(next); this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  after(child) { if (this.parentElement) this.parentElement.insertBefore(child, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this); this.parentElement = null; }
  replaceChildren(...children) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this.append(...children); }
  set innerHTML(value) { this.replaceChildren(); this._html = value; this._value = null; parse(value, this); }
  get innerHTML() { return this._html; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  focus() {}
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 100, width: 100, height: 100 }; }
  click() { if (!this.disabled) return this.onclick?.({ target: this }); }
  closest(selector) { let node = this; while (node) { if (matches(node, selector)) return node; node = node.parentElement; } return null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = (parent) => parent.children.forEach((child) => {
      if (selector.split(",").some((part) => matchesChain(child, part.trim()))) found.push(child);
      visit(child);
    });
    visit(this); return found;
  }
}
function matches(element, selector) {
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  const id = selector.match(/#([\w-]+)/)?.[1]; if (id && element.id !== id) return false;
  if ([...selector.matchAll(/\.([\w-]+)/g)].some((match) => !element.classList.contains(match[1]))) return false;
  return [...selector.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)].every((match) => {
    const key = match[1];
    const value = key.startsWith("data-") ? element.dataset[key.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase())]
      : element[key] ?? element.attributes[key];
    return match[2] === undefined ? value !== undefined : String(value) === match[2];
  });
}
function matchesChain(element, selector) {
  const parts = selector.split(/\s+/); if (!matches(element, parts.pop())) return false;
  let node = element.parentElement;
  while (parts.length) {
    const target = parts.pop(); while (node && !matches(node, target)) node = node.parentElement;
    if (!node) return false; node = node.parentElement;
  }
  return true;
}
function parse(markup, host) {
  const stack = [host]; const voids = new Set(["INPUT", "BR", "META", "LINK", "HR", "IMG"]);
  for (const match of markup.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>|([^<]+)/gi)) {
    if (match[4]) { stack[stack.length - 1].textContent += match[4]; continue; }
    if (match[1]) { if (stack.length > 1) stack.pop(); continue; }
    const element = new Element(match[2]);
    for (const attr of match[3].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? "");
    stack[stack.length - 1].appendChild(element);
    if (!voids.has(element.tagName)) stack.push(element);
  }
}
function bootstrap(storage = new Map()) {
  const document = new Element("document"); parse(html, document);
  document.body = document.querySelector("body");
  document.createElement = (tag) => new Element(tag);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  const timers = new Set();
  const window = { listeners: {}, confirm: () => true, prompt: () => "test.json",
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn),
  };
  const context = vm.createContext({ document, window, console: { log() {}, warn() {}, error: console.error },
    alert: () => {}, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, Date });
  for (const script of html.matchAll(/<script src="([^"]+)"/g)) vm.runInContext(fs.readFileSync(path.join(root, script[1]), "utf8"), context, { filename: script[1] });
  return { app: window.app, window, document, context, storage, element: (id) => document.getElementById(id) };
}
const fixture = {
  meta: { periodo: "impar" }, config: { horario: { inicio: "08:00", fin: "20:00" } },
  academias: [{ id: "ac", nombre: "Ciencias" }],
  asignaturas: [{ id: "s", nombre: "Materia", academiaId: "ac", sesionesPorSemana: 1, duracionSegmentos: 2 }],
  grupos: [{ id: "g1", nombre: "101", turno: "matutino", grado: 1, planAsignaturas: ["s"], profesoresPorAsignatura: { s: "p1" } }],
  profesores: [{ id: "p1", nombre: "Profesor", academiaId: "ac", turno: "matutino", gruposAsignados: ["g1"] }],
  aulas: [{ id: "a1", nombre: "Aula 1", tipo: "normal" }],
  sesiones: [0, 1].map((hora) => ({ grupoId: "g1", asignaturaId: "s", profesorId: "p1", aulaId: "a1", dia: 0, hora, locked: true, blockId: "one" })),
};
async function main() {
  const test = bootstrap(); const { app, element, window, context } = test;
  assert.ok(app.workspaceHistory, "startup must initialize history and recovery");
  assert.equal(element("btn-undo").disabled, true);
  app.loadTemplateFromJson(fixture, { label: "Prueba", templateKey: "A" });
  app.selectGrupo(app.data.grupos[0]);
  const original = app.workspaceHistory.capture().documentJSON;
  assert.equal(element("btn-group-delete").hidden, false);
  assert.equal(documentChildrenLast(element("btn-group-delete")), true, "danger action must follow normal group actions");
  window.confirm = () => false;
  element("btn-group-delete").click();
  assert.equal(app.data.grupos.length, 1);
  window.confirm = () => true;
  element("btn-group-delete").click();
  assert.equal(app.data.grupos.length, 0);
  assert.equal(element("group-editor").style.display, "none");
  element("btn-undo").click();
  assert.equal(app.workspaceHistory.capture().documentJSON, original);
  assert.equal(element("group-editor").style.display, "block");
  element("btn-redo").click();
  assert.equal(app.data.grupos.length, 0);
  element("btn-undo").click();
  element("group-subject-teacher").value = "";
  element("group-subject-teacher").onchange();
  assert.equal(app.data.grupos[0].profesoresPorAsignatura.s, null, "redrawing must not silently reassign a removed professor");
  element("btn-undo").click();
  assert.equal(app.workspaceHistory.capture().documentJSON, original);
  const unlock = test.document.querySelector('[data-group-lock-action="unlock"]');
  unlock.click();
  assert.ok(app.horario.sesiones.every((session) => !session.locked));
  element("btn-undo").click();
  assert.ok(app.horario.sesiones.every((session) => session.locked));
  element("btn-review").click();
  assert.equal(element("dialog-review").style.display, "block");
  assert.match(element("review-summary").textContent, /0 problemas · 0 avisos/);
  assert.equal(app.workspaceHistory.capture().documentJSON, original);
  element("btn-review-close").click();
  app.exportData();
  let downloads = 0;
  vm.runInContext("Persistence.downloadJson = () => { window.downloads += 1; };", context);
  window.downloads = 0;
  window.prompt = () => null;
  window.confirm = () => false;
  element("btn-review-export").click();
  assert.equal(window.downloads, downloads);
  window.confirm = () => true;
  app.exportData(); element("btn-review-export").click();
  assert.equal(window.downloads, 1);
  assert.equal(app.workspaceHistory.hasUnexportedChanges(), false);
  vm.runInContext("ScheduleEditor.runAutoSchedule = async (app) => { app.setAutomationBusy(true); app.horario.sesiones[0].locked = false; await Promise.resolve(); app.setAutomationBusy(false); };", context);
  await element("btn-group-auto-schedule").click();
  element("btn-undo").click();
  assert.equal(app.workspaceHistory.capture().documentJSON, original, "the local automatic-fill button must produce one undoable action");
  app.setAutomationBusy(true);
  assert.equal(element("btn-group-delete").disabled, true);
  assert.equal(element("btn-undo").disabled, true);
  app.setAutomationBusy(false);
  element("group-name").value = "101 editado";
  element("btn-group-save").click();
  assert.equal(app.data.grupos[0].nombre, "101 editado");
  let prevented = false;
  window.listeners.beforeunload[0]({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const recovered = bootstrap(test.storage);
  assert.equal(recovered.element("dialog-recovery").style.display, "block");
  assert.equal(recovered.app.data.grupos.length, 0, "startup must offer recovery, not silently replace the page");
  recovered.element("btn-recovery-later").click();
  assert.ok(recovered.app.workspaceHistory.pendingRecovery);
  recovered.element("btn-recovery").click();
  recovered.element("btn-recovery-restore").click();
  assert.equal(recovered.app.data.grupos[0].nombre, "101 editado");
  assert.ok(recovered.app.horario.sesiones.every((session) => session.locked));
  assert.equal(recovered.element("group-editor").style.display, "block");
  assert.equal(recovered.element("btn-undo").disabled, true, "reloading must start a fresh history");
  console.log("Workspace UI checks passed (real page/controllers in a detached test DOM; not a visual browser test).");
}
function documentChildrenLast(element) { return element.parentElement.children.at(-1) === element; }
main().catch((error) => { console.error(error); process.exitCode = 1; });
