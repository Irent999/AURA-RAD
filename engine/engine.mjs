// AURA-RAD расчётное ядро v2 (замена функций ge/_e/be/xe/Se/Te исходного приложения)
// Источники коэффициентов указаны в комментариях; всё, чего нельзя подтвердить, помечено.
export const AR = (() => {
  "use strict";
  const G = 9.81,
    DAY = 86400,
    YEAR = 365.25 * DAY;
  const K_IMM = 1e-3 / 1e3 / 3600; // (мЗв/ч)/(кБк/м3) -> Зв/(Бк·с/м3)   [IAEA-TECDOC-1162 / FGR-12]
  const K_GND = 1e-3 / 1e3; // мЗв/(кБк/м2)     -> Зв/(Бк/м2)    [IAEA-TECDOC-1162 Table E3]
  const MR = 1e-5 / 3.7e4; // мбэр/мкКи        -> Зв/Бк         [ICRP 68, 1 мкм AMAD]
  const BR = 8100 / (365 * DAY); // взрослый, НРБ-2006 Табл. 8.1: 8.1 тыс. м3/год
  const W_THY = 0.05; // НРБ-2006: взвешивающий коэффициент щитовидной железы

  // [symbol, name, T1/2 (s), group, imm, g1(мес), g50(лет), inh{класс:мбэр/мкКи}, defClass, note]
  const RAW = [
    [
      "Kr-85",
      "Криптон-85",
      10.756 * YEAR,
      "noble",
      4.7e-7,
      0,
      0,
      {},
      "",
      "imm: оценка (<1e-6 по TECDOC-1162), не табличное",
    ],
    ["Kr-88", "Криптон-88", 2.84 * 3600, "noble", 4.8e-4, 0, 0, {}, "", ""],
    ["Xe-133", "Ксенон-133", 5.243 * DAY, "noble", 7.4e-6, 0, 0, {}, "", ""],
    ["Xe-135", "Ксенон-135", 9.14 * 3600, "noble", 5.2e-5, 0, 0, {}, "", ""],
    [
      "I-131",
      "Иод-131",
      8.0207 * DAY,
      "iodine",
      8.1e-5,
      2.5e-4,
      2.7e-4,
      { F: 28.12 },
      "F",
      "пары I2: 2.0e-8 Зв/Бк",
    ],
    ["I-132", "Иод-132", 2.295 * 3600, "iodine", 5.2e-4, 1.9e-5, 1.9e-5, { F: 0.36 }, "F", ""],
    ["I-133", "Иод-133", 20.83 * 3600, "iodine", 1.3e-4, 4.5e-5, 4.5e-5, { F: 5.55 }, "F", ""],
    [
      "I-135",
      "Иод-135",
      6.57 * 3600,
      "iodine",
      3.5e-4,
      3.7e-5,
      3.7e-5,
      { F: 1.22 },
      "F",
      "грунт: I-135+Xe-135m",
    ],
    [
      "Te-132",
      "Теллур-132",
      3.204 * DAY,
      "aerosol",
      4.4e-5,
      6.9e-4,
      6.9e-4,
      { F: 6.66, M: 8.14 },
      "F",
      "I-132 нарастает отдельно",
    ],
    [
      "Cs-134",
      "Цезий-134",
      2.0648 * YEAR,
      "aerosol",
      3.4e-4,
      2.7e-3,
      5.1e-2,
      { F: 25.16 },
      "F",
      "",
    ],
    [
      "Cs-137",
      "Цезий-137 (+Ba-137m)",
      30.05 * YEAR,
      "aerosol",
      1.3e-4,
      9.9e-4,
      1.3e-1,
      { F: 17.76 },
      "F",
      "с дочерним Ba-137m",
    ],
    [
      "Sr-89",
      "Стронций-89",
      50.53 * DAY,
      "aerosol",
      0,
      1.1e-5,
      2.8e-5,
      { F: 3.7, S: 27.75 },
      "F",
      "чистый бета-излучатель",
    ],
    [
      "Sr-90",
      "Стронций-90 (+Y-90)",
      28.79 * YEAR,
      "aerosol",
      0,
      1.7e-4,
      2.1e-2,
      { F: 88.8, S: 555 },
      "F",
      "чистый бета-излучатель",
    ],
    [
      "Ru-103",
      "Рутений-103",
      39.26 * DAY,
      "aerosol",
      1.0e-4,
      6.4e-4,
      1.5e-3,
      { F: 1.81, M: 8.51, S: 10.36 },
      "M",
      "",
    ],
    [
      "Ru-106",
      "Рутений-106 (+Rh-106)",
      371.8 * DAY,
      "aerosol",
      4.4e-5,
      4.2e-4,
      4.8e-3,
      { F: 29.6, M: 96.2, S: 229.4 },
      "M",
      "",
    ],
    [
      "Zr-95",
      "Цирконий-95",
      64.03 * DAY,
      "aerosol",
      1.6e-4,
      1.4e-3,
      6.8e-3,
      { F: 9.25, M: 16.65, S: 20.35 },
      "M",
      "",
    ],
    [
      "Co-60",
      "Кобальт-60",
      5.2711 * YEAR,
      "aerosol",
      5.6e-4,
      4.2e-3,
      1.7e-1,
      { M: 35.52, S: 107.3 },
      "M",
      "",
    ],
    [
      "Am-241",
      "Америций-241",
      432.6 * YEAR,
      "aerosol",
      0,
      3.5e-2,
      6.7,
      { M: 144300 },
      "M",
      "внешнее γ-облучение облака пренебрежимо",
    ],
    [
      "Pu-239",
      "Плутоний-239",
      24110 * YEAR,
      "aerosol",
      0,
      4.2e-2,
      8.5,
      { M: 173900, S: 55500 },
      "M",
      "α-излучатель; доминирует вдыхание",
    ],
  ];
  const NUC = {};
  for (const [s, name, T, grp, imm, g1, g50, inh, def, note] of RAW) {
    const v = {};
    for (const k in inh) v[k] = inh[k] * MR;
    const vals = Object.values(v);
    NUC[s] = {
      symbol: s,
      name,
      T,
      lambda: Math.LN2 / T,
      grp,
      imm: imm * K_IMM,
      g1: g1 * K_GND,
      g50: g50 * K_GND,
      inhVar: v,
      inhDef: v[def] ?? 0,
      inhMax: vals.length ? Math.max(...vals) : 0,
      defClass: def,
      thy: grp === "iodine",
      note,
    };
  }
  const supported = (s) => !!NUC[s];
  const IODINE_VAPOR_FACTOR = 2.0e-8 / (28.12 * MR); // I-131: пары I2 / аэрозоль F (TU Delft exam, ICRP 68/72)

  // ---------- Метеорология ----------
  const IRWIN_RURAL = { A: 0.07, B: 0.07, C: 0.1, D: 0.15, E: 0.35, F: 0.55 };
  const IRWIN_URBAN = { A: 0.15, B: 0.15, C: 0.2, D: 0.25, E: 0.3, F: 0.3 };
  const MART_SY = { A: 213, B: 156, C: 104, D: 68, E: 50.5, F: 34 };
  const MART_LT = {
    A: [440.8, 1.941, 9.27],
    B: [106.6, 1.149, 3.3],
    C: [61, 0.911, 0],
    D: [33.2, 0.725, -1.7],
    E: [22.8, 0.678, -1.3],
    F: [14.35, 0.74, -0.35],
  };
  const MART_GT = {
    A: [459.7, 2.094, -9.6],
    B: [108.2, 1.098, 2],
    C: [61, 0.911, 0],
    D: [44.5, 0.516, -13],
    E: [55.4, 0.305, -34],
    F: [62.6, 0.18, -48.6],
  };
  function sigmas(cls, x, terrain) {
    const xm = Math.max(x, 50);
    if (terrain === "urban") {
      // Briggs urban
      const r = 1 / Math.sqrt(1 + 4e-4 * xm);
      if (cls === "A" || cls === "B")
        return { sy: 0.32 * xm * r, sz: 0.24 * xm * Math.sqrt(1 + 0.001 * xm) };
      if (cls === "C") return { sy: 0.22 * xm * r, sz: 0.2 * xm };
      if (cls === "D") return { sy: 0.16 * xm * r, sz: (0.14 * xm) / Math.sqrt(1 + 3e-4 * xm) };
      return { sy: 0.11 * xm * r, sz: (0.08 * xm) / Math.sqrt(1 + 1.5e-3 * xm) };
    }
    const km = xm / 1e3,
      c = km < 1 ? MART_LT[cls] : MART_GT[cls];
    return {
      sy: Math.max(MART_SY[cls] * km ** 0.894, 0.1),
      sz: Math.max(c[0] * km ** c[1] + c[2], 0.1),
    };
  }
  function windAt(u10, h, cls, terrain) {
    const p = (terrain === "urban" ? IRWIN_URBAN : IRWIN_RURAL)[cls] ?? 0.15;
    return u10 * (Math.max(h, 10) / 10) ** p;
  }
  // Briggs: итоговый подъём факела
  function plumeRise(src, met, u, cls) {
    const Ta = (met.airTemperature ?? met.temperature ?? 15) + 273.15;
    let F = 0;
    if (src.heatMW > 0) F = 8.99e-6 * src.heatMW * 1e6;
    else if (src.exitVelocity > 0 && src.stackDiameter > 0 && src.stackTemperature != null) {
      const Ts = src.stackTemperature + 273.15;
      if (Ts > Ta) F = (((G * src.exitVelocity * src.stackDiameter ** 2) / 4) * (Ts - Ta)) / Ts;
    }
    if (F <= 0) return 0;
    let dh;
    if (cls === "E" || cls === "F") {
      const s = (G / Ta) * (cls === "E" ? 0.02 : 0.035);
      dh = 2.6 * (F / (u * s)) ** (1 / 3);
    } else dh = F < 55 ? (21.425 * F ** 0.75) / u : (38.71 * F ** 0.6) / u;
    return Math.max(
      0,
      Math.min(dh, met.mixingHeight > 0 ? 0.9 * met.mixingHeight - src.releaseHeight : dh),
    );
  }
  function chiQ(y, zr, H, L, u, sy, sz) {
    // с/м3 на 1 Бк
    const lat = Math.exp((-y * y) / (2 * sy * sy));
    if (L > 0 && sz > 1.6 * L) return lat / (Math.sqrt(2 * Math.PI) * sy * L * u);
    let s = 0;
    const N = L > 0 ? 3 : 0;
    for (let n = -N; n <= N; n++) {
      const o = L > 0 ? 2 * n * L : 0;
      s +=
        Math.exp(-((zr - H + o) ** 2) / (2 * sz * sz)) +
        Math.exp(-((zr + H + o) ** 2) / (2 * sz * sz));
    }
    return (lat * s) / (2 * Math.PI * sy * sz * u);
  }
  function dryDepletionExp(x, H, cls, terrain, vd, u) {
    // показатель экспоненты (источниковая деплеция)
    if (vd <= 0) return 0;
    const n = 40,
      x0 = 10;
    let I = 0,
      prev = null;
    for (let i = 0; i <= n; i++) {
      const xi = x0 * (Math.max(x, x0 * 1.01) / x0) ** (i / n);
      const sz = sigmas(cls, xi, terrain).sz;
      const f = (Math.exp((-H * H) / (2 * sz * sz)) / sz) * xi; // d(ln x)
      if (prev !== null) I += 0.5 * (f + prev.f) * (Math.log(xi) - Math.log(prev.x));
      prev = { x: xi, f };
    }
    return ((Math.sqrt(2 / Math.PI) * vd) / u) * I;
  }
  const wetLambda = (I) => (I > 0 ? 1e-4 * I ** 0.8 : 0); // 1/с; инженерная оценка для аэрозолей (замените данными площадки)

  // ---------- Нуклидный состав ----------
  function sourceList(src) {
    const L = (
      src.nuclides && src.nuclides.length
        ? src.nuclides
        : [{ symbol: src.isotope, activity: src.activity }]
    )
      .filter((n) => n && n.symbol && n.activity > 0)
      .slice(0, 12);
    return L;
  }

  // ---------- Ядро: дозы в точке (x вдоль ветра, y поперёк) ----------
  function point(input, x, y, ctx) {
    const { src, met, terrain } = input;
    const { cls, H, L, u, uPlume, Tdur, sy, sz, nucs, fexp, vdI, vdA, Lw, cond } = ctx;
    const X = Math.max(x, 1),
      ttr = X / uPlume;
    let cTot = 0,
      depTot = 0,
      eCloud = 0,
      eInh = 0,
      eG10 = 0,
      eG30 = 0,
      thy = 0;
    const per = [];
    for (const n of nucs) {
      const d = NUC[n.symbol];
      const decay = Math.exp(-d.lambda * ttr);
      const vd = d.grp === "noble" ? 0 : d.grp === "iodine" ? vdI : vdA;
      const dryExp = dryDepletionExp(X, H, cls, terrain.terrainType, vd, uPlume);
      const wet = Math.exp(-Lw * ttr * (d.grp === "noble" ? 0 : 1));
      const dep0 = Math.exp(-dryExp) * wet;
      const cq = chiQ(y, input.receptorHeight ?? 1.5, H, L, uPlume, sy, sz);
      const tic = n.activity * decay * dep0 * cq; // Бк·с/м3
      const cq0 = chiQ(y, 0, H, L, uPlume, sy, sz);
      const depDry = vd * n.activity * decay * dep0 * cq0; // Бк/м2
      const lat = Math.exp((-y * y) / (2 * sy * sy));
      const depWet =
        d.grp === "noble"
          ? 0
          : ((Lw * n.activity * decay * dep0) / (Math.sqrt(2 * Math.PI) * sy * uPlume)) * lat;
      const dep = depDry + depWet;
      const inhC =
        d.inhVar &&
        (ctx.conservative ? d.inhMax : d.inhDef) *
          (d.thy && ctx.iodineVapor ? IODINE_VAPOR_FACTOR : 1);
      const ec = d.imm * tic * fexp;
      const ei = BR * inhC * tic * fexp;
      const f10 = (1 - Math.exp(-d.lambda * 240 * 3600)) / (1 - Math.exp(-d.lambda * 720 * 3600));
      const eg30 = dep * d.g1,
        eg10 = eg30 * f10;
      cTot += tic / Tdur;
      depTot += dep;
      eCloud += ec;
      eInh += ei;
      eG10 += eg10;
      eG30 += eg30;
      if (d.thy) thy += ei / W_THY;
      per.push({
        symbol: n.symbol,
        tic,
        deposition: dep,
        cloud: ec,
        inhalation: ei,
        ground10d: eg10,
        ground30d: eg30,
        total10d: ec + ei + eg10,
      });
    }
    const E10 = eCloud + eInh + eG10;
    return {
      concentration: cTot,
      deposition: depTot,
      cloud: eCloud,
      inhalation: eInh,
      ground10d: eG10,
      ground30d: eG30,
      E10,
      E30: eCloud + eInh + eG30,
      thyroid: thy,
      thyroidChild: thy * 8.6 * (1.9 / 8.1),
      per,
    };
  }

  function context(input, downwindM) {
    const {
      sourceTerm: src,
      meteorology: met,
      terrain,
    } = { sourceTerm: input.src, meteorology: input.met, terrain: input.terrain };
    const cls = met.stabilityClass || "D";
    const u10 = Math.max(met.windSpeed || 0, 0);
    const uMin = 1.0; // ниже 1 м/с гауссова модель неприменима
    const uStack = Math.max(windAt(u10, src.releaseHeight || 0, cls, terrain.terrainType), uMin);
    const dh = plumeRise(src, met, uStack, cls);
    const H = Math.max(src.releaseHeight || 0, 0) + dh;
    const uPlume = Math.max(windAt(u10, H, cls, terrain.terrainType), uMin);
    const { sy, sz } = sigmas(cls, downwindM, terrain.terrainType);
    const Tdur = Math.max(src.releaseDuration, 1e-4) * 3600;
    const fexp = 1; // доза — за полное прохождение облака (критерии НРБ: 10 сут); время усреднения на дозу не влияет
    return {
      cls,
      H,
      dh,
      L: met.mixingHeight > 0 ? met.mixingHeight : 0,
      u: uStack,
      uPlume,
      Tdur,
      sy,
      sz,
      fexp,
      vdI: src.depositionVelocityIodine ?? 0.01,
      vdA: src.depositionVelocityAerosol ?? 0.002,
      Lw: wetLambda(met.precipitationRate || 0),
      conservative: !!src.conservativeAbsorption,
      iodineVapor: src.iodineForm === "vapor",
      nucs: sourceList(src).filter((n) => supported(n.symbol)),
    };
  }

  // ---------- Критерии НРБ-2006 (СанПиН РУз № 0193-06), Таблица 6.3, 6.4 ----------
  const NRB = {
    shelter: { whole: [5, 50], thy: [50, 500] },
    kiAdult: [250, 2500],
    kiChild: [100, 1000],
    evac: { whole: [50, 500], thy: [500, 5000] },
    relocMonth: 30,
  };
  function actions(rows) {
    const out = [];
    const lvl = (v, [A, B]) => (v >= B ? "B" : v >= A ? "A" : null);
    for (const r of rows) {
      const E = r.dose10d * 1e3,
        T = r.thyroidDose * 1e3,
        Tc = r.thyroidChild * 1e3,
        E30 = r.dose30d * 1e3;
      const add = (action, zone, crit, l, ref) =>
        out.push({
          distance: r.distance,
          action,
          zone,
          criteria: crit,
          level: l === "B" ? "emergency" : "alert",
          note:
            (l === "B"
              ? "Уровень Б: меры обязательны"
              : "Между уровнями А и Б: решение по обоснованию/оптимизации") +
            " (" +
            ref +
            ")",
        });
      let l = lvl(E, NRB.evac.whole);
      if (l)
        add(
          "Эвакуация населения",
          "Зона эвакуации",
          `Доза за 10 сут ${E.toFixed(1)} мЗв ≥ ${NRB.evac.whole[l === "B" ? 1 : 0]} мЗв`,
          l,
          "НРБ-2006 Табл. 6.3",
        );
      l = lvl(T, NRB.evac.thy);
      if (l)
        add(
          "Эвакуация (щитовидная железа)",
          "Зона эвакуации",
          `Щитовидка ${T.toFixed(0)} мГр ≥ ${NRB.evac.thy[l === "B" ? 1 : 0]}`,
          l,
          "НРБ-2006 Табл. 6.3",
        );
      l = lvl(E, NRB.shelter.whole);
      if (l)
        add(
          "Укрытие населения",
          "Зона укрытия",
          `Доза за 10 сут ${E.toFixed(1)} мЗв ≥ ${NRB.shelter.whole[l === "B" ? 1 : 0]} мЗв`,
          l,
          "НРБ-2006 Табл. 6.3",
        );
      l = lvl(T, NRB.shelter.thy);
      if (l)
        add(
          "Укрытие (щитовидная железа)",
          "Зона укрытия",
          `Щитовидка ${T.toFixed(0)} мГр ≥ ${NRB.shelter.thy[l === "B" ? 1 : 0]}`,
          l,
          "НРБ-2006 Табл. 6.3",
        );
      l = lvl(T, NRB.kiAdult);
      if (l)
        add(
          "Йодная профилактика — взрослые",
          "Зона йодной профилактики",
          `Щитовидка (взр.) ${T.toFixed(0)} мГр ≥ ${NRB.kiAdult[l === "B" ? 1 : 0]}`,
          l,
          "НРБ-2006 Табл. 6.3",
        );
      l = lvl(Tc, NRB.kiChild);
      if (l)
        add(
          "Йодная профилактика — дети",
          "Зона йодной профилактики (дети)",
          `Щитовидка (ребёнок, ориент.) ${Tc.toFixed(0)} мГр ≥ ${NRB.kiChild[l === "B" ? 1 : 0]}`,
          l,
          "НРБ-2006 Табл. 6.3; детский множитель ориентировочный",
        );
      if (E30 >= NRB.relocMonth)
        out.push({
          distance: r.distance,
          action: "Временное отселение (рассмотреть)",
          zone: "Зона отселения",
          criteria: `Доза за 1-й месяц ${E30.toFixed(1)} мЗв ≥ ${NRB.relocMonth} мЗв/мес`,
          level: "alert",
          note: "НРБ-2006 п. 6.4",
        });
      if (E >= 1 && !out.some((o) => o.distance === r.distance))
        out.push({
          distance: r.distance,
          action: "Радиационный контроль, информирование",
          zone: "Зона наблюдения",
          criteria: `Доза за 10 сут ${E.toFixed(2)} мЗв ≥ 1 мЗв (предел для населения, Табл. 3.1)`,
          level: "advisory",
          note: "ориентир",
        });
    }
    return out;
  }

  const fmtT = (s) =>
    s < 60
      ? `${s.toFixed(0)} с`
      : s < 3600
        ? `${(s / 60).toFixed(1)} мин`
        : `${(s / 3600).toFixed(1)} ч`;

  function run(inp) {
    const input = {
      src: inp.sourceTerm,
      met: inp.meteorology,
      terrain: inp.terrain,
      averagingTime: inp.averagingTime,
      receptorHeight: inp.receptorHeight,
    };
    const warnings = [];
    const list = sourceList(inp.sourceTerm);
    const unsup = list.filter((n) => !supported(n.symbol)).map((n) => n.symbol);
    if (unsup.length)
      warnings.push(
        `Нет проверенных дозовых коэффициентов для: ${unsup.join(", ")}. Эти нуклиды исключены из расчёта доз.`,
      );
    if (!list.length) warnings.push("Источник пуст: задайте нуклид и активность.");
    if (list.some((n) => n.symbol === "Te-132") && !list.some((n) => n.symbol === "I-132"))
      warnings.push(
        "Te-132 без I-132: ингроуз дочернего I-132 не учтён (в реакторных выбросах добавляйте I-132 ≈ A(Te-132)).",
      );
    if ((inp.meteorology.windSpeed || 0) < 1)
      warnings.push(
        "Скорость ветра < 1 м/с: гауссова модель неприменима, принято u = 1 м/с (оценка — ориентировочная).",
      );
    if (inp.terrain?.buildingWake)
      warnings.push("Аэродинамический след зданий НЕ моделируется (флаг игнорируется).");
    if (inp.terrain?.complexTerrain)
      warnings.push("Сложный рельеф НЕ моделируется (флаг игнорируется).");
    if (inp.meteorology.stabilityClass == null)
      warnings.push("Класс устойчивости не задан: принят D.");
    if (inp.distances?.some((d) => d > 30000))
      warnings.push("Расстояния > 30 км выходят за область применимости σy/σz (Martin, Briggs).");
    if (inp.distances?.some((d) => d < 100))
      warnings.push("Расстояния < 100 м: оценка грубая (σ ограничены).");
    warnings.push(
      "Дозы по НРБ-2006: эффективная доза за 10 сут (облако + вдыхание + грунт с ресуспензией), ЩЖ взрослого по wT = 0.05. Лёгкие/кожа не рассчитываются.",
    );
    if (list.some((n) => NUC[n.symbol]?.grp === "noble"))
      warnings.push("Благородные газы: бета-доза на кожу не рассчитывается (только γ-погружение).");

    const results = [];
    const wd = ((((inp.meteorology.windDirection || 0) + 180) % 360) * Math.PI) / 180; // направление ПЕРЕНОСА (азимут)
    const ex = Math.sin(wd),
      ny = Math.cos(wd); // восток, север
    for (const x of inp.distances) {
      const ctx = context(input, x),
        p = point(input, x, 0, ctx);
      const tArr = x / ctx.uPlume;
      results.push({
        distance: x,
        centerlineConcentration: p.concentration,
        crosswindSpread: ctx.sy,
        verticalSpread: ctx.sz,
        plumeWidth: ctx.sy * 4,
        arrivalTime: tArr,
        arrivalTimeFormatted: fmtT(tArr),
        exposureDuration: ctx.Tdur * ctx.fexp,
        plumeDeposition: p.deposition,
        externalDose: p.cloud + p.ground10d,
        cloudDose: p.cloud,
        groundDose: p.ground10d,
        inhalationDose: p.inhalation,
        skinDose: 0,
        ingestionEquivalentDose: 0,
        totalEffectiveDose: p.E10,
        thyroidDose: p.thyroid,
        thyroidChild: p.thyroidChild,
        dose10d: p.E10,
        dose30d: p.E30,
        effectiveHeight: ctx.H,
        plumeRise: ctx.dh,
        windAtPlume: ctx.uPlume,
        perNuclide: p.per,
      });
    }
    const best = (key) =>
      results.reduce((a, r) => (r[key] > a.value ? { distance: r.distance, value: r[key] } : a), {
        distance: 0,
        value: 0,
      });
    const far = (key, thr) =>
      results.reduce((m, r) => (r[key] >= thr && r.distance > m ? r.distance : m), 0);
    const plumeFootprint = [],
      geo = [];
    for (const x of inp.distances) {
      const ctx = context(input, x);
      for (const k of [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]) {
        const y = k * ctx.sy,
          p = point(input, x, y, ctx);
        const E = x * ex + y * ny,
          N = x * ny - y * ex; // поперечное направление: вправо по ветру
        plumeFootprint.push({ x: E, y: N, concentration: p.concentration, dose: p.E10 });
      }
    }
    const lat0 = inp.sourceTerm.latitude,
      lon0 = inp.sourceTerm.longitude;
    for (const f of plumeFootprint)
      geo.push({
        lat: lat0 + ((f.y / 6371e3) * 180) / Math.PI,
        lon: lon0 + ((f.x / (6371e3 * Math.cos((lat0 * Math.PI) / 180))) * 180) / Math.PI,
        concentration: f.concentration,
        dose: f.dose,
      });
    const acts = actions(results);
    const zone = {
      exclusionZone: far("dose10d", NRB.evac.whole[0] / 1e3),
      contaminationZone: far("dose10d", NRB.shelter.whole[0] / 1e3),
      ingestionZone: far("thyroidDose", NRB.kiAdult[0] / 1e3),
      totalAffected: far("dose10d", 1e-3),
    };
    return {
      results,
      input: inp,
      maxConcentration: best("centerlineConcentration"),
      maxDoseDistance: {
        distance: best("totalEffectiveDose").distance,
        value: best("totalEffectiveDose").value,
      },
      plumeFootprint,
      geoFootprint: geo,
      zoneSummary: zone,
      protectiveActions: acts,
      warnings,
    };
  }

  // ---------- Таймлайн аварии ----------
  function timeline(inp, receptorM, phases, opts = {}) {
    const input = {
      src: inp.sourceTerm,
      met: inp.meteorology,
      terrain: inp.terrain,
      averagingTime: 0,
      receptorHeight: inp.receptorHeight,
    };
    const ctx0 = context(input, receptorM);
    const list = sourceList(inp.sourceTerm).filter((n) => supported(n.symbol));
    const tEnd = opts.hours ?? 240,
      dt = opts.step ?? 0.25,
      nT = Math.round(tEnd / dt) + 1;
    const cum = new Float64Array(nT),
      thy = new Float64Array(nT);
    const ph =
      phases && phases.length
        ? phases
        : [
            {
              label: "Выброс",
              t0: 0,
              dur: inp.sourceTerm.releaseDuration,
              share: { noble: 1, iodine: 1, aerosol: 1 },
            },
          ];
    const tArr = receptorM / ctx0.uPlume / 3600;
    for (const p of ph) {
      const nuc = list
        .map((n) => ({
          symbol: n.symbol,
          activity: n.activity * (p.share[NUC[n.symbol].grp] ?? 0),
        }))
        .filter((n) => n.activity > 0);
      if (!nuc.length) continue;
      const src = { ...inp.sourceTerm, nuclides: nuc, releaseDuration: p.dur };
      const ctx = context({ ...input, src }, receptorM),
        pt = point({ ...input, src }, receptorM, 0, { ...ctx, fexp: 1 });
      const t1 = p.t0 + tArr,
        t2 = t1 + p.dur;
      for (let i = 0; i < nT; i++) {
        const t = i * dt,
          fr = Math.max(0, Math.min(1, (t - t1) / (t2 - t1)));
        cum[i] += (pt.cloud + pt.inhalation) * fr;
        thy[i] += pt.thyroid * fr;
        // грунт: отложение накапливается в [t1,t2]; доза набирается по (1-exp(-λτ))/(1-exp(-λ·720ч))
        for (const q of pt.per) {
          const d = NUC[q.symbol],
            k = (q.deposition * d.g1) / (1 - Math.exp(-d.lambda * 720 * 3600)),
            S = 12;
          for (let s = 0; s < S; s++) {
            const ts = t1 + ((s + 0.5) * (t2 - t1)) / S;
            if (t > ts) cum[i] += (k / S) * (1 - Math.exp(-d.lambda * (t - ts) * 3600));
          }
        }
      }
    }
    const first = (arr, thr) => {
      for (let i = 0; i < nT; i++) if (arr[i] * 1e3 >= thr) return i * dt;
      return null;
    };
    const t = Array.from({ length: nT }, (_, i) => i * dt);
    return {
      t,
      effective: Array.from(cum),
      thyroid: Array.from(thy),
      arrival: tArr,
      phases: ph,
      H: ctx0.H,
      events: [
        { id: "shelter", label: "Укрытие (А: 5 мЗв)", t: first(cum, 5) },
        { id: "evacA", label: "Эвакуация (А: 50 мЗв)", t: first(cum, 50) },
        { id: "evacB", label: "Эвакуация (Б: 500 мЗв)", t: first(cum, 500) },
        { id: "ki", label: "Йодная профилактика, взр. (А: 250 мГр)", t: first(thy, 250) },
        {
          id: "kiChild",
          label: "Йодная профилактика, дети (А: 100 мГр, ориент.)",
          t: first(
            Array.from(thy, (v) => (v * 8.6 * 1.9) / 8.1),
            100,
          ),
        },
      ],
    };
  }

  // ---------- Сценарии аварий (иллюстративные; заменять данными проекта/ООБ) ----------
  const CORE_PER_MWT = {
    "Kr-85": 7e12,
    "Xe-133": 2.0e15,
    "I-131": 9.8e14,
    "I-132": 1.4e15,
    "I-133": 2.0e15,
    "I-135": 1.85e15,
    "Te-132": 1.4e15,
    "Cs-134": 4.3e13,
    "Cs-137": 7.9e13,
    "Sr-89": 1.1e15,
    "Sr-90": 6.4e13,
    "Ru-103": 1.2e15,
    "Ru-106": 2.9e14,
    "Zr-95": 1.7e15,
  };
  const GROUPS = {
    noble: ["Kr-85", "Xe-133"],
    iodine: ["I-131", "I-132", "I-133", "I-135"],
    cs: ["Cs-134", "Cs-137"],
    te: ["Te-132"],
    sr: ["Sr-89", "Sr-90"],
    ru: ["Ru-103", "Ru-106", "Zr-95"],
  };
  function reactorSource(P, f) {
    const nuclides = [];
    for (const g in GROUPS)
      for (const s of GROUPS[g]) {
        const a = CORE_PER_MWT[s] * P * f[g];
        if (a > 0) nuclides.push({ symbol: s, activity: a });
      }
    return nuclides;
  }
  const NPP_PHASES = [
    {
      label: "Газовый зазор / ранний выброс",
      t0: 0,
      dur: 2,
      share: { noble: 0.5, iodine: 0.3, aerosol: 0.3 },
    },
    { label: "Основной выброс", t0: 2, dur: 4, share: { noble: 0.4, iodine: 0.5, aerosol: 0.5 } },
    { label: "Поздний выброс", t0: 6, dur: 6, share: { noble: 0.1, iodine: 0.2, aerosol: 0.2 } },
  ];
  const SCENARIOS = [
    {
      id: "npp-dba",
      name: "АЭС: проектная авария (течь, оболочка цела, фильтры работают)",
      kind: "npp",
      power: 3000,
      height: 100,
      duration: 12,
      heat: 0,
      phases: NPP_PHASES,
      f: { noble: 1e-2, iodine: 1e-6, cs: 1e-7, te: 1e-7, sr: 1e-8, ru: 1e-9 },
      desc: "Иллюстративные доли выхода; для реальных расчётов подставьте источниковый член из ООБ станции.",
    },
    {
      id: "npp-vent",
      name: "АЭС: тяжёлая авария, фильтруемый сброс (вентиляция оболочки)",
      kind: "npp",
      power: 3000,
      height: 100,
      duration: 12,
      heat: 0,
      phases: NPP_PHASES,
      f: { noble: 0.5, iodine: 2e-4, cs: 1e-4, te: 1e-4, sr: 1e-5, ru: 1e-6 },
      desc: "Фильтры задерживают аэрозоли/иод (иллюстративно); благородные газы выходят почти полностью.",
    },
    {
      id: "npp-fail",
      name: "АЭС: тяжёлая авария, потеря герметичности оболочки",
      kind: "npp",
      power: 3000,
      height: 30,
      duration: 12,
      heat: 0,
      phases: NPP_PHASES,
      f: { noble: 0.9, iodine: 0.05, cs: 0.04, te: 0.04, sr: 0.005, ru: 0.001 },
      desc: "Верхняя иллюстративная оценка раннего выброса; приземный выброс 30 м.",
    },
    {
      id: "rr-10",
      name: "Исследовательский реактор 10 МВт (тип ВВР-СМ): повреждение ТВС",
      kind: "npp",
      power: 10,
      height: 30,
      duration: 4,
      heat: 0,
      phases: [{ label: "Выброс", t0: 0, dur: 4, share: { noble: 1, iodine: 1, aerosol: 1 } }],
      f: { noble: 0.9, iodine: 0.05, cs: 0.04, te: 0.04, sr: 0.005, ru: 0.001 },
      desc: "Запас по условиям короткой кампании не учитывается: инвентарь взят пропорционально мощности (консервативно).",
    },
    {
      id: "rdd",
      name: "РРУ («грязная бомба»): Cs-137 1000 Ки, взрыв",
      kind: "fixed",
      height: 20,
      duration: 0.02,
      heat: 0,
      nuclides: [{ symbol: "Cs-137", activity: 1.85e13 }],
      phases: [{ label: "Взрыв", t0: 0, dur: 0.02, share: { noble: 1, iodine: 1, aerosol: 1 } }],
      desc: "Источник 3.7e13 Бк, 50 % переходит в аэрозоль; начальный подъём облака задан эффективной высотой 20 м.",
    },
    {
      id: "fire",
      name: "Пожар в хранилище источников: Co-60 + Cs-137",
      kind: "fixed",
      height: 0,
      duration: 2,
      heat: 10,
      nuclides: [
        { symbol: "Co-60", activity: 2e12 },
        { symbol: "Cs-137", activity: 5e11 },
      ],
      phases: [{ label: "Пожар", t0: 0, dur: 2, share: { noble: 1, iodine: 1, aerosol: 1 } }],
      desc: "Запас 2e14/5e13 Бк, вынос 1 %, тепловыделение 10 МВт (подъём по Briggs).",
    },
    {
      id: "lab-i131",
      name: "Лаборатория радиофармпрепаратов: выброс I-131 через вентиляцию",
      kind: "fixed",
      height: 25,
      duration: 1,
      heat: 0,
      iodineForm: "vapor",
      nuclides: [{ symbol: "I-131", activity: 2e12 }],
      phases: [{ label: "Выброс", t0: 0, dur: 1, share: { noble: 1, iodine: 1, aerosol: 1 } }],
      desc: "Йод в виде паров (коэффициент вдыхания 2.0e-8 Зв/Бк).",
    },
  ];
  function buildScenario(id, power) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) return null;
    const P = power ?? s.power;
    const nuclides = s.kind === "npp" ? reactorSource(P, s.f) : s.nuclides.map((n) => ({ ...n }));
    if (s.kind === "npp") {
      const t = nuclides.find((n) => n.symbol === "Te-132");
      if (t && !nuclides.some((n) => n.symbol === "I-132"))
        nuclides.push({ symbol: "I-132", activity: t.activity });
    }
    return {
      id: s.id,
      name: s.name,
      desc: s.desc,
      nuclides,
      releaseDuration: s.duration,
      releaseHeight: s.height,
      heatMW: s.heat || 0,
      iodineForm: s.iodineForm || "aerosol",
      phases: s.phases,
      power: P,
      kind: s.kind,
    };
  }

  // ---------- Метеоданные Узбекистана ----------
  // Координаты — центры населённых пунктов (≈±0.05°). Официальные ряды Узгидромета в открытом доступе не найдены:
  // данные подтягиваются по координатам из Open-Meteo (реанализ/модель), либо задаются генеративными пресетами.
  const STATIONS = [
    ["Ташкент", 41.3, 69.24, "Ташкент"],
    ["ИЯФ АН РУз (пос. Улугбек)", 41.34, 69.35, "Ташкентская обл."],
    ["Нурафшон", 41.04, 69.36, "Ташкентская обл."],
    ["Чирчик", 41.47, 69.58, "Ташкентская обл."],
    ["Алмалык", 40.85, 69.6, "Ташкентская обл."],
    ["Ангрен", 41.02, 70.14, "Ташкентская обл."],
    ["Бекабад", 40.22, 69.27, "Ташкентская обл."],
    ["Гулистан", 40.49, 68.78, "Сырдарьинская обл."],
    ["Джизак", 40.12, 67.84, "Джизакская обл."],
    ["Самарканд", 39.65, 66.96, "Самаркандская обл."],
    ["Навои", 40.1, 65.37, "Навоийская обл."],
    ["Зарафшан", 41.57, 64.2, "Навоийская обл."],
    ["Учкудук", 42.16, 63.55, "Навоийская обл."],
    ["Бухара", 39.77, 64.42, "Бухарская обл."],
    ["Газли", 40.13, 63.45, "Бухарская обл."],
    ["Карши", 38.86, 65.79, "Кашкадарьинская обл."],
    ["Шахрисабз", 39.06, 66.83, "Кашкадарьинская обл."],
    ["Термез", 37.22, 67.28, "Сурхандарьинская обл."],
    ["Денау", 38.27, 67.9, "Сурхандарьинская обл."],
    ["Фергана", 40.38, 71.78, "Ферганская обл."],
    ["Коканд", 40.53, 70.94, "Ферганская обл."],
    ["Маргилан", 40.47, 71.72, "Ферганская обл."],
    ["Андижан", 40.78, 72.34, "Андижанская обл."],
    ["Наманган", 41.0, 71.67, "Наманганская обл."],
    ["Ургенч", 41.55, 60.63, "Хорезмская обл."],
    ["Хива", 41.38, 60.36, "Хорезмская обл."],
    ["Нукус", 42.46, 59.61, "Каракалпакстан"],
    ["Кунград", 43.08, 58.9, "Каракалпакстан"],
    ["Муйнак", 43.77, 59.02, "Каракалпакстан"],
  ].map(([name, lat, lon, region]) => ({ name, lat, lon, region }));
  const PRESETS = [
    {
      id: "cons",
      label: "Консервативный (ночь, F, 1.5 м/с, слой перемешивания 200 м)",
      windSpeed: 1.5,
      stabilityClass: "F",
      mixingHeight: 200,
      airTemperature: 10,
      precipitationRate: 0,
    },
    {
      id: "neutral",
      label: "Нейтральный (D, 5 м/с, 1000 м)",
      windSpeed: 5,
      stabilityClass: "D",
      mixingHeight: 1000,
      airTemperature: 20,
      precipitationRate: 0,
    },
    {
      id: "day",
      label: "Дневная конвекция (B, 2.5 м/с, 2500 м)",
      windSpeed: 2.5,
      stabilityClass: "B",
      mixingHeight: 2500,
      airTemperature: 30,
      precipitationRate: 0,
    },
    {
      id: "rain",
      label: "Дождь (D, 4 м/с, 800 м, 5 мм/ч)",
      windSpeed: 4,
      stabilityClass: "D",
      mixingHeight: 800,
      airTemperature: 12,
      precipitationRate: 5,
    },
  ];
  // Класс устойчивости по Паскуиллу–Тёрнеру (инсоляция по коротковолновой радиации; ночью — по облачности)
  function pasquill(u, isDay, swW, cloudPct) {
    if (isDay) {
      const k = swW >= 700 ? 0 : swW >= 350 ? 1 : 2; // сильная/умеренная/слабая
      const T =
        u < 2
          ? ["A", "B", "B"]
          : u < 3
            ? ["B", "B", "C"]
            : u < 5
              ? ["B", "C", "C"]
              : u < 6
                ? ["C", "D", "D"]
                : ["C", "D", "D"];
      return T[k];
    }
    const cloudy = cloudPct >= 50;
    if (u < 2) return "F";
    if (u < 3) return cloudy ? "E" : "F";
    if (u < 5) return cloudy ? "D" : "E";
    return "D";
  }
  function fromOpenMeteo(j, idx) {
    const h = j.hourly,
      i = idx ?? 0;
    const u = h.wind_speed_10m[i],
      day = h.is_day[i] === 1;
    const sw = h.shortwave_radiation[i] ?? 0,
      cl = h.cloud_cover[i] ?? 50;
    return {
      time: h.time[i],
      windSpeed: u,
      windDirection: h.wind_direction_10m[i],
      airTemperature: h.temperature_2m[i],
      precipitationRate: h.precipitation[i] || 0,
      mixingHeight: Math.max(h.boundary_layer_height?.[i] ?? 800, 50),
      stabilityClass: pasquill(u, day, sw, cl),
      cloud: cl,
      isDay: day,
      shortwave: sw,
    };
  }
  const openMeteoUrl = (lat, lon) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,shortwave_radiation,is_day,boundary_layer_height&wind_speed_unit=ms&past_days=1&forecast_days=3&timezone=Asia%2FTashkent`;

  return {
    NUC,
    supported,
    run,
    timeline,
    point,
    context,
    sigmas,
    windAt,
    plumeRise,
    chiQ,
    SCENARIOS,
    buildScenario,
    STATIONS,
    PRESETS,
    pasquill,
    fromOpenMeteo,
    openMeteoUrl,
    NRB,
    constants: { K_IMM, K_GND, MR, BR, W_THY },
  };
})();
