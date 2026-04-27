const StudentPreferences = {
  storageKey: "student-schedule-preferences-v1",

  defaults: Object.freeze({
    targetDailyHours: 8,
    minStart: "",
    maxEnd: "",
    preferredTurno: "any",
    avoidDays: [],
    priorities: {
      dailyLoad: 3,
      gaps: 3,
    },
  }),

  baseWeights: Object.freeze({
    coveredSubject: 1000,
    missingSubject: 700,
    unusedDay: 55,
    lowLoadDay: 36,
    dailyLoadDeviationSegment: 4,
    dailyLoadImbalance: 5,
    dailyLoadRange: 6,
    gapSegment: 9,
    gapSeverity: 4,
    windowSpan: 0.6,
    avoidedDaySegment: 18,
    preferredTurnoMismatch: 28,
  }),

  current: null,

  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey) || "null");
      this.current = this.normalize(parsed);
    } catch (error) {
      this.current = this.normalize(null);
    }
    return this.current;
  },

  save(preferences) {
    this.current = this.normalize(preferences);
    localStorage.setItem(this.storageKey, JSON.stringify(this.current));
    return this.current;
  },

  normalize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const priorities = source.priorities && typeof source.priorities === "object"
      ? source.priorities
      : {};

    return {
      targetDailyHours: this.clampNumber(source.targetDailyHours, 1, 12, this.defaults.targetDailyHours),
      minStart: this.normalizeHourBoundary(source.minStart),
      maxEnd: this.normalizeHourBoundary(source.maxEnd),
      preferredTurno: ["any", "matutino", "vespertino"].includes(source.preferredTurno)
        ? source.preferredTurno
        : this.defaults.preferredTurno,
      avoidDays: Array.isArray(source.avoidDays)
        ? source.avoidDays.map(Number).filter((day) => day >= 0 && day <= 4)
        : [],
      priorities: {
        dailyLoad: this.clampNumber(priorities.dailyLoad, 0, 5, this.defaults.priorities.dailyLoad),
        gaps: this.clampNumber(priorities.gaps, 0, 5, this.defaults.priorities.gaps),
      },
    };
  },

  clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  },

  normalizeHourBoundary(value) {
    if (value === "" || value == null) return "";
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? String(number) : "";
  },

  readFromDom(root = document) {
    const avoidDays = [...root.querySelectorAll("[data-student-avoid-day]:checked")]
      .map((input) => Number(input.value))
      .filter((day) => day >= 0 && day <= 4);

    return this.normalize({
      targetDailyHours: root.getElementById("student-target-hours")?.value,
      minStart: root.getElementById("student-min-start")?.value,
      maxEnd: root.getElementById("student-max-end")?.value,
      preferredTurno: root.getElementById("student-preferred-turno")?.value,
      avoidDays,
      priorities: {
        dailyLoad: root.getElementById("student-weight-daily-load")?.value,
        gaps: root.getElementById("student-weight-gaps")?.value,
      },
    });
  },

  applyToDom(root = document, preferences = this.current || this.defaults) {
    const normalized = this.normalize(preferences);
    this.setValue(root, "student-target-hours", normalized.targetDailyHours);
    this.setValue(root, "student-min-start", normalized.minStart);
    this.setValue(root, "student-max-end", normalized.maxEnd);
    this.setValue(root, "student-preferred-turno", normalized.preferredTurno);
    this.setValue(root, "student-weight-daily-load", normalized.priorities.dailyLoad);
    this.setValue(root, "student-weight-gaps", normalized.priorities.gaps);

    root.querySelectorAll("[data-student-avoid-day]").forEach((input) => {
      input.checked = normalized.avoidDays.includes(Number(input.value));
    });
  },

  setValue(root, id, value) {
    const element = root.getElementById(id);
    if (element) element.value = String(value ?? "");
  },

  getScoringWeights(preferences = this.current || this.defaults) {
    const normalized = this.normalize(preferences);
    const priority = normalized.priorities;
    return {
      ...this.baseWeights,
      unusedDay: 55,
      lowLoadDay: 34,
      dailyLoadDeviationSegment: 1 + priority.dailyLoad * 1.2,
      dailyLoadImbalance: 2 + priority.dailyLoad * 2.4,
      dailyLoadRange: 3 + priority.dailyLoad * 2.8,
      gapSegment: 2 + priority.gaps,
      gapSeverity: 1 + priority.gaps * 1.6,
      windowSpan: 0.2 + priority.gaps * 0.15,
    };
  },

  getTargetDailySegments(segmentMinutes, preferences = this.current || this.defaults) {
    const normalized = this.normalize(preferences);
    const minutes = Math.max(1, Number(segmentMinutes) || 30);
    return Math.max(1, Math.round((normalized.targetDailyHours * 60) / minutes));
  },
};

StudentPreferences.current = StudentPreferences.load();
window.StudentPreferences = StudentPreferences;
