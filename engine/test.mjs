import { AR } from "./engine.mjs";
const base = {
  sourceTerm: {
    isotope: "Cs-137",
    activity: 1e14,
    releaseDuration: 1,
    releaseHeight: 30,
    latitude: 40.2,
    longitude: 68.8,
    physicalForm: "aerosol",
  },
  meteorology: {
    windSpeed: 5,
    windDirection: 270,
    stabilityClass: "D",
    mixingHeight: 1000,
    airTemperature: 20,
    precipitationRate: 0,
  },
  terrain: { terrainType: "rural", surfaceRoughness: 0.1 },
  distances: [100, 250, 500, 1000, 2000, 5000, 10000, 20000],
  receptorHeight: 1.5,
  averagingTime: 3600,
};
const r = AR.run(base);
console.log("--- Cs-137 1e14 Bq, 30 m, D, 5 m/s");
for (const x of r.results)
  console.log(
    String(x.distance).padStart(6),
    "C=",
    x.centerlineConcentration.toExponential(2),
    "dep=",
    x.plumeDeposition.toExponential(2),
    "cloud=",
    (x.cloudDose * 1e3).toExponential(2),
    "inh=",
    (x.inhalationDose * 1e3).toExponential(2),
    "gnd10=",
    (x.groundDose * 1e3).toExponential(2),
    "E10 mSv=",
    (x.dose10d * 1e3).toFixed(3),
  );
// независимая проверка гауссовой формулы вручную для x=1000
{
  const x = 1000,
    u = AR.windAt(5, 30, "D", "rural");
  const { sy, sz } = AR.sigmas("D", x, "rural");
  const H = 30;
  const cq =
    (1 / (2 * Math.PI * sy * sz * u)) *
    (Math.exp(-((1.5 - H) ** 2) / (2 * sz * sz)) + Math.exp(-((1.5 + H) ** 2) / (2 * sz * sz)));
  console.log(
    "ручной chi/Q(1км)=",
    cq.toExponential(3),
    "u=",
    u.toFixed(2),
    "sy,sz=",
    sy.toFixed(1),
    sz.toFixed(1),
  );
  const tic = 1e14 * cq * Math.exp(((-Math.LN2 / (30.05 * 365.25 * 86400)) * x) / u);
  console.log("ручной TIC=", tic.toExponential(3));
}
// направление: ветер ИЗ 270 (с запада) -> шлейф на восток => x>0,y≈0
const f = r.plumeFootprint.find((p) => Math.abs(p.y) < 1e-6 && p.x > 900);
console.log("footprint при ветре с запада (270°):", f && f.x.toFixed(0), f && f.y.toFixed(0));
// иммерсия: Cs-137 TIC=1 Бк с/м3 -> Зв
console.log(
  "imm Cs-137 Sv/(Bq s m-3)=",
  AR.NUC["Cs-137"].imm.toExponential(3),
  " (приложение: 2.83e-13)",
);
// мультинуклид + йод
const m = structuredClone(base);
m.sourceTerm.nuclides = [
  { symbol: "I-131", activity: 1e15 },
  { symbol: "Cs-137", activity: 1e14 },
  { symbol: "Xe-133", activity: 1e17 },
];
m.sourceTerm.iodineForm = "vapor";
const rm = AR.run(m);
const q = rm.results[3];
console.log(
  "--- мультинуклид 1 км: E10 =",
  (q.dose10d * 1e3).toFixed(2),
  "мЗв; ЩЖ=",
  (q.thyroidDose * 1e3).toFixed(0),
  "мГр; ребёнок≈",
  (q.thyroidChild * 1e3).toFixed(0),
);
console.log(q.perNuclide.map((n) => n.symbol + ":" + (n.total10d * 1e3).toFixed(2)).join("  "));
console.log(
  "действия на 1 км:",
  rm.protectiveActions
    .filter((a) => a.distance === 1000)
    .map((a) => a.action + " [" + a.level + "]")
    .join("; "),
);
console.log("зоны:", rm.zoneSummary);
// сценарии
for (const s of AR.SCENARIOS) {
  const b = AR.buildScenario(s.id);
  const inp = structuredClone(base);
  Object.assign(inp.sourceTerm, {
    nuclides: b.nuclides,
    releaseDuration: b.releaseDuration,
    releaseHeight: b.releaseHeight,
    heatMW: b.heatMW,
    iodineForm: b.iodineForm,
  });
  const rr = AR.run(inp);
  const t = AR.timeline(inp, 2000, b.phases);
  console.log(
    s.id.padEnd(9),
    "Hэфф(2км)=",
    rr.results[4].effectiveHeight.toFixed(0),
    "E10(2км)=",
    (rr.results[4].dose10d * 1e3).toFixed(2),
    "мЗв; эвак.A зона",
    rr.zoneSummary.exclusionZone,
    "м; t(укрытие)=",
    t.events[0].t,
    "ч, t(ЩЖ)=",
    t.events[3].t,
    "; E(240ч) timeline=",
    (t.effective.at(-1) * 1e3).toFixed(2),
    "vs",
    (rr.results[4].dose10d * 1e3).toFixed(2),
  );
}
// Open-Meteo разбор / Паскуилл
console.log(
  "Pasquill день 3м/с 800Вт:",
  AR.pasquill(3, true, 800, 10),
  " ночь 1м/с:",
  AR.pasquill(1, false, 0, 0),
  " ночь 4м/с облачно:",
  AR.pasquill(4, false, 0, 80),
);
console.log(
  "wind<1:",
  AR.run({ ...base, meteorology: { ...base.meteorology, windSpeed: 0.3 } }).warnings[0],
);
