const o = [
    {
      name: `Iodine-131`,
      symbol: `I-131`,
      atomicMass: 131,
      halfLife: 8.04,
      halfLifeUnit: `days`,
      decayConstant: 998e-9,
      gammaEnergy: 0.364,
      betaEnergy: 0.181,
      alphaEnergy: 0,
      doseRateConstant: 217e-15,
      inhalationCoefficient: 2e-8,
      ingestionCoefficient: 22e-9,
      externalDoseCoefficient: 174e-18,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Xe-131`, branchingRatio: 1 }],
      notes: `Primary thyroid hazard; significant in reactor accidents`,
    },
    {
      name: `Cesium-137`,
      symbol: `Cs-137`,
      atomicMass: 137,
      halfLife: 30.17,
      halfLifeUnit: `years`,
      decayConstant: 73e-11,
      gammaEnergy: 0.662,
      betaEnergy: 0.188,
      alphaEnergy: 0,
      doseRateConstant: 283e-15,
      inhalationCoefficient: 39e-9,
      ingestionCoefficient: 13e-9,
      externalDoseCoefficient: 223e-18,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Ba-137m`, branchingRatio: 0.946 }],
      notes: `Long-lived fission product; major contributor to chronic exposure`,
    },
    {
      name: `Strontium-90`,
      symbol: `Sr-90`,
      atomicMass: 90,
      halfLife: 28.8,
      halfLifeUnit: `years`,
      decayConstant: 763e-12,
      gammaEnergy: 0,
      betaEnergy: 0.546,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 16e-8,
      ingestionCoefficient: 28e-9,
      externalDoseCoefficient: 0,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Y-90`, branchingRatio: 1 }],
      notes: `Bone seeker; pure beta emitter; mimics calcium`,
    },
    {
      name: `Cobalt-60`,
      symbol: `Co-60`,
      atomicMass: 60,
      halfLife: 5.27,
      halfLifeUnit: `years`,
      decayConstant: 4.17e-9,
      gammaEnergy: 2.505,
      betaEnergy: 0.318,
      alphaEnergy: 0,
      doseRateConstant: 253e-15,
      inhalationCoefficient: 1e-8,
      ingestionCoefficient: 7e-9,
      externalDoseCoefficient: 341e-18,
      lungClass: `W`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Ni-60`, branchingRatio: 1 }],
      notes: `Strong gamma emitter; used in medical/industrial sources`,
    },
    {
      name: `Plutonium-239`,
      symbol: `Pu-239`,
      atomicMass: 239,
      halfLife: 24065,
      halfLifeUnit: `years`,
      decayConstant: 913e-15,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 5.157,
      doseRateConstant: 0,
      inhalationCoefficient: 12e-5,
      ingestionCoefficient: 25e-8,
      externalDoseCoefficient: 0,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `U-235`, branchingRatio: 1 }],
      notes: `Extreme alpha hazard; lung and bone seeker; weapons material`,
    },
    {
      name: `Uranium-235`,
      symbol: `U-235`,
      atomicMass: 235,
      halfLife: 704e6,
      halfLifeUnit: `years`,
      decayConstant: 312e-19,
      gammaEnergy: 0.186,
      betaEnergy: 0,
      alphaEnergy: 4.679,
      doseRateConstant: 47e-15,
      inhalationCoefficient: 32e-6,
      ingestionCoefficient: 46e-9,
      externalDoseCoefficient: 146e-18,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Th-231`, branchingRatio: 1 }],
      notes: `Fissile material; alpha and weak gamma emitter`,
    },
    {
      name: `Tritium`,
      symbol: `H-3`,
      atomicMass: 3,
      halfLife: 12.3,
      halfLifeUnit: `years`,
      decayConstant: 1.78e-9,
      gammaEnergy: 0,
      betaEnergy: 0.0186,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 18e-11,
      ingestionCoefficient: 18e-11,
      externalDoseCoefficient: 0,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `He-3`, branchingRatio: 1 }],
      notes: `Weak beta emitter; readily absorbed as tritiated water`,
    },
    {
      name: `Krypton-85`,
      symbol: `Kr-85`,
      atomicMass: 85,
      halfLife: 10.76,
      halfLifeUnit: `years`,
      decayConstant: 2.04e-9,
      gammaEnergy: 0.514,
      betaEnergy: 0.687,
      alphaEnergy: 0,
      doseRateConstant: 13e-17,
      inhalationCoefficient: 53e-13,
      ingestionCoefficient: 0,
      externalDoseCoefficient: 13e-17,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Rb-85`, branchingRatio: 1 }],
      notes: `Noble gas; external exposure from immersion is primary concern`,
    },
    {
      name: `Iodine-133`,
      symbol: `I-133`,
      atomicMass: 133,
      halfLife: 0.867,
      halfLifeUnit: `days`,
      decayConstant: 926e-8,
      gammaEnergy: 0.53,
      betaEnergy: 0.423,
      alphaEnergy: 0,
      doseRateConstant: 33e-14,
      inhalationCoefficient: 26e-9,
      ingestionCoefficient: 28e-9,
      externalDoseCoefficient: 271e-18,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Xe-133`, branchingRatio: 0.97 }],
      notes: `Short-lived iodine isotope; early-phase reactor accident concern`,
    },
    {
      name: `Xenon-133`,
      symbol: `Xe-133`,
      atomicMass: 133,
      halfLife: 5.25,
      halfLifeUnit: `days`,
      decayConstant: 153e-8,
      gammaEnergy: 0.081,
      betaEnergy: 0.346,
      alphaEnergy: 0,
      doseRateConstant: 11e-17,
      inhalationCoefficient: 43e-13,
      ingestionCoefficient: 0,
      externalDoseCoefficient: 11e-17,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Cs-133`, branchingRatio: 1 }],
      notes: `Noble gas; dominant external dose in early reactor accident phase`,
    },
    {
      name: `Ruthenium-106`,
      symbol: `Ru-106`,
      atomicMass: 106,
      halfLife: 1.01,
      halfLifeUnit: `years`,
      decayConstant: 2.18e-8,
      gammaEnergy: 0,
      betaEnergy: 1.41,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 26e-9,
      ingestionCoefficient: 4.7e-9,
      externalDoseCoefficient: 0,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Rh-106`, branchingRatio: 1 }],
      notes: `Beta emitter; beta decay to Rh-106 which emits high-energy gamma`,
    },
    {
      name: `Americium-241`,
      symbol: `Am-241`,
      atomicMass: 241,
      halfLife: 432.2,
      halfLifeUnit: `years`,
      decayConstant: 508e-13,
      gammaEnergy: 0.06,
      betaEnergy: 0,
      alphaEnergy: 5.638,
      doseRateConstant: 56e-15,
      inhalationCoefficient: 37e-6,
      ingestionCoefficient: 2e-7,
      externalDoseCoefficient: 532e-19,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Np-237`, branchingRatio: 1 }],
      notes: `Alpha emitter; found in smoke detectors and industrial sources`,
    },
    {
      name: `Barium-137m`,
      symbol: `Ba-137m`,
      atomicMass: 137,
      halfLife: 2.55,
      halfLifeUnit: `minutes`,
      decayConstant: 453e-6,
      gammaEnergy: 0.662,
      betaEnergy: 0,
      alphaEnergy: 0,
      doseRateConstant: 283e-15,
      inhalationCoefficient: 0,
      ingestionCoefficient: 0,
      externalDoseCoefficient: 223e-18,
      lungClass: `D`,
      icrpSource: `ICRP 38`,
      decayMode: `IT`,
      daughters: [{ symbol: `Ba-137`, branchingRatio: 1 }],
      notes: `Metastable state; primary gamma emitter in Cs-137 decay chain`,
    },
    {
      name: `Yttrium-90`,
      symbol: `Y-90`,
      atomicMass: 90,
      halfLife: 2.67,
      halfLifeUnit: `days`,
      decayConstant: 3e-6,
      gammaEnergy: 0,
      betaEnergy: 2.28,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 1.5e-9,
      ingestionCoefficient: 2.7e-9,
      externalDoseCoefficient: 0,
      lungClass: `W`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Zr-90`, branchingRatio: 1 }],
      notes: `High-energy beta emitter; daughter of Sr-90; used in radiotherapy`,
    },
    {
      name: `Radium-226`,
      symbol: `Ra-226`,
      atomicMass: 226,
      halfLife: 1600,
      halfLifeUnit: `years`,
      decayConstant: 137e-13,
      gammaEnergy: 0.186,
      betaEnergy: 0,
      alphaEnergy: 4.871,
      doseRateConstant: 849e-16,
      inhalationCoefficient: 35e-7,
      ingestionCoefficient: 28e-8,
      externalDoseCoefficient: 613e-19,
      lungClass: `W`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Rn-222`, branchingRatio: 1 }],
      notes: `Historically significant; decays to radon-222 gas; bone seeker`,
    },
    {
      name: `Radon-222`,
      symbol: `Rn-222`,
      atomicMass: 222,
      halfLife: 3.82,
      halfLifeUnit: `days`,
      decayConstant: 21e-7,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 5.49,
      doseRateConstant: 0,
      inhalationCoefficient: 1e-8,
      ingestionCoefficient: 3.5e-9,
      externalDoseCoefficient: 0,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Po-218`, branchingRatio: 1 }],
      notes: `Noble gas; indoor air hazard; daughter of Ra-226; lung cancer risk`,
    },
    {
      name: `Polonium-210`,
      symbol: `Po-210`,
      atomicMass: 210,
      halfLife: 138.4,
      halfLifeUnit: `days`,
      decayConstant: 58e-9,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 5.304,
      doseRateConstant: 0,
      inhalationCoefficient: 12e-6,
      ingestionCoefficient: 12e-8,
      externalDoseCoefficient: 0,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Pb-206`, branchingRatio: 1 }],
      notes: `Highly toxic alpha emitter; daughter of Rn-222 chain; assassination agent`,
    },
    {
      name: `Carbon-14`,
      symbol: `C-14`,
      atomicMass: 14,
      halfLife: 5730,
      halfLifeUnit: `years`,
      decayConstant: 383e-14,
      gammaEnergy: 0,
      betaEnergy: 0.0495,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 58e-11,
      ingestionCoefficient: 58e-11,
      externalDoseCoefficient: 0,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `N-14`, branchingRatio: 1 }],
      notes: `Naturally occurring; cosmogenic; used in radiocarbon dating`,
    },
    {
      name: `Iodine-125`,
      symbol: `I-125`,
      atomicMass: 125,
      halfLife: 59.4,
      halfLifeUnit: `days`,
      decayConstant: 135e-9,
      gammaEnergy: 0.035,
      betaEnergy: 0,
      alphaEnergy: 0,
      doseRateConstant: 137e-15,
      inhalationCoefficient: 3.3e-9,
      ingestionCoefficient: 15e-9,
      externalDoseCoefficient: 109e-18,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `EC`,
      daughters: [{ symbol: `Te-125`, branchingRatio: 1 }],
      notes: `Electron capture; used in brachytherapy seeds and radioimmunoassay`,
    },
    {
      name: `Technetium-99m`,
      symbol: `Tc-99m`,
      atomicMass: 99,
      halfLife: 6.01,
      halfLifeUnit: `hours`,
      decayConstant: 32e-6,
      gammaEnergy: 0.141,
      betaEnergy: 0,
      alphaEnergy: 0,
      doseRateConstant: 135e-15,
      inhalationCoefficient: 12e-12,
      ingestionCoefficient: 22e-12,
      externalDoseCoefficient: 119e-18,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `IT`,
      daughters: [{ symbol: `Tc-99`, branchingRatio: 1 }],
      notes: `Most widely used medical imaging isotope; metastable state of Tc-99`,
    },
    {
      name: `Technetium-99`,
      symbol: `Tc-99`,
      atomicMass: 99,
      halfLife: 211e3,
      halfLifeUnit: `years`,
      decayConstant: 104e-15,
      gammaEnergy: 0,
      betaEnergy: 0.294,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 1.3e-9,
      ingestionCoefficient: 64e-11,
      externalDoseCoefficient: 0,
      lungClass: `W`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Ru-99`, branchingRatio: 1 }],
      notes: `Long-lived fission product; environmental contaminant; daughter of Tc-99m`,
    },
    {
      name: `Strontium-89`,
      symbol: `Sr-89`,
      atomicMass: 89,
      halfLife: 50.5,
      halfLifeUnit: `days`,
      decayConstant: 159e-9,
      gammaEnergy: 0,
      betaEnergy: 1.463,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 3.6e-9,
      ingestionCoefficient: 2.6e-9,
      externalDoseCoefficient: 0,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Y-89`, branchingRatio: 1 }],
      notes: `Bone-seeking beta emitter; used in palliative radiotherapy for bone metastases`,
    },
    {
      name: `Curium-244`,
      symbol: `Cm-244`,
      atomicMass: 244,
      halfLife: 18.1,
      halfLifeUnit: `years`,
      decayConstant: 1.21e-9,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 5.805,
      doseRateConstant: 0,
      inhalationCoefficient: 69e-6,
      ingestionCoefficient: 18e-8,
      externalDoseCoefficient: 0,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Pu-240`, branchingRatio: 1 }],
      notes: `Alpha emitter; used in RTGs and neutron sources; high radiotoxicity`,
    },
    {
      name: `Neptunium-237`,
      symbol: `Np-237`,
      atomicMass: 237,
      halfLife: 214e4,
      halfLifeUnit: `years`,
      decayConstant: 103e-16,
      gammaEnergy: 0.087,
      betaEnergy: 0,
      alphaEnergy: 4.959,
      doseRateConstant: 33e-15,
      inhalationCoefficient: 26e-6,
      ingestionCoefficient: 11e-8,
      externalDoseCoefficient: 257e-19,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Pa-233`, branchingRatio: 1 }],
      notes: `Daughter of Am-241; long-lived actinide; potential waste repository concern`,
    },
    {
      name: `Plutonium-238`,
      symbol: `Pu-238`,
      atomicMass: 238,
      halfLife: 87.7,
      halfLifeUnit: `years`,
      decayConstant: 25e-11,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 5.593,
      doseRateConstant: 0,
      inhalationCoefficient: 11e-5,
      ingestionCoefficient: 23e-8,
      externalDoseCoefficient: 0,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `U-234`, branchingRatio: 1 }],
      notes: `High decay heat; primary isotope for radioisotope thermoelectric generators (RTGs)`,
    },
    {
      name: `Uranium-238`,
      symbol: `U-238`,
      atomicMass: 238,
      halfLife: 447e7,
      halfLifeUnit: `years`,
      decayConstant: 492e-20,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 4.27,
      doseRateConstant: 224e-16,
      inhalationCoefficient: 29e-6,
      ingestionCoefficient: 45e-9,
      externalDoseCoefficient: 693e-20,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Th-234`, branchingRatio: 1 }],
      notes: `Most abundant uranium isotope; primordial; head of natural decay chain`,
    },
    {
      name: `Thorium-232`,
      symbol: `Th-232`,
      atomicMass: 232,
      halfLife: 14e9,
      halfLifeUnit: `years`,
      decayConstant: 157e-20,
      gammaEnergy: 0,
      betaEnergy: 0,
      alphaEnergy: 4.083,
      doseRateConstant: 148e-16,
      inhalationCoefficient: 28e-6,
      ingestionCoefficient: 22e-8,
      externalDoseCoefficient: 459e-20,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `alpha`,
      daughters: [{ symbol: `Ra-228`, branchingRatio: 1 }],
      notes: `Primordial radionuclide; head of thorium decay chain; fertile material`,
    },
    {
      name: `Lead-210`,
      symbol: `Pb-210`,
      atomicMass: 210,
      halfLife: 22.3,
      halfLifeUnit: `years`,
      decayConstant: 986e-12,
      gammaEnergy: 0.0465,
      betaEnergy: 0.064,
      alphaEnergy: 0,
      doseRateConstant: 33e-15,
      inhalationCoefficient: 36e-8,
      ingestionCoefficient: 69e-8,
      externalDoseCoefficient: 376e-19,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Bi-210`, branchingRatio: 1 }],
      notes: `Daughter in Rn-222 decay chain; used in historical dating; bone seeker`,
    },
    {
      name: `Bismuth-210`,
      symbol: `Bi-210`,
      atomicMass: 210,
      halfLife: 5.01,
      halfLifeUnit: `days`,
      decayConstant: 16e-7,
      gammaEnergy: 0,
      betaEnergy: 1.163,
      alphaEnergy: 0,
      doseRateConstant: 0,
      inhalationCoefficient: 9.3e-9,
      ingestionCoefficient: 1.3e-9,
      externalDoseCoefficient: 0,
      lungClass: `W`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Po-210`, branchingRatio: 1 }],
      notes: `Intermediate in Pb-210 to Po-210 decay chain; weak alpha branch`,
    },
    {
      name: `Cerium-144`,
      symbol: `Ce-144`,
      atomicMass: 144,
      halfLife: 284.9,
      halfLifeUnit: `days`,
      decayConstant: 2.82e-8,
      gammaEnergy: 0.134,
      betaEnergy: 0.319,
      alphaEnergy: 0,
      doseRateConstant: 88e-15,
      inhalationCoefficient: 26e-9,
      ingestionCoefficient: 5.2e-9,
      externalDoseCoefficient: 647e-19,
      lungClass: `Y`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Pr-144`, branchingRatio: 1 }],
      notes: `Fission product; significant in early fallout; liver and bone accumulator`,
    },
    {
      name: `Zirconium-95`,
      symbol: `Zr-95`,
      atomicMass: 95,
      halfLife: 64,
      halfLifeUnit: `days`,
      decayConstant: 125e-9,
      gammaEnergy: 0.757,
      betaEnergy: 0.366,
      alphaEnergy: 0,
      doseRateConstant: 728e-16,
      inhalationCoefficient: 5.6e-9,
      ingestionCoefficient: 86e-11,
      externalDoseCoefficient: 526e-19,
      lungClass: `D`,
      icrpSource: `ICRP 107`,
      decayMode: `beta-`,
      daughters: [{ symbol: `Nb-95`, branchingRatio: 1 }],
      notes: `Fission product; gamma emitter; decays to Nb-95; environmental tracer`,
    },
  ];
function s(e){return o.find(t=>t.symbol===e)}
var c = {
    A: {
      name: `A - Extremely Unstable`,
      description: `Strong insolation, low wind speed; vigorous convection`,
      pasquillA: 0.527,
      pasquillB: 0.865,
      pasquillC: 0,
      pasquillD: -9,
      windRange: `< 3 m/s`,
      weather: `Sunny, light winds, daytime`,
      color: `#ef4444`,
    },
    B: {
      name: `B - Moderately Unstable`,
      description: `Moderate insolation, moderate convection`,
      pasquillA: 0.371,
      pasquillB: 0.866,
      pasquillC: 0,
      pasquillD: -9,
      windRange: `2-5 m/s`,
      weather: `Partly cloudy, moderate winds, daytime`,
      color: `#f97316`,
    },
    C: {
      name: `C - Slightly Unstable`,
      description: `Moderate wind, slight insolation or overcast`,
      pasquillA: 0.285,
      pasquillB: 0.918,
      pasquillC: -0.148,
      pasquillD: -9,
      windRange: `2-6 m/s`,
      weather: `Cloudy, moderate winds`,
      color: `#eab308`,
    },
    D: {
      name: `D - Neutral`,
      description: `Overcast, strong winds; neutral stability`,
      pasquillA: 0.15,
      pasquillB: 0.895,
      pasquillC: -0.147,
      pasquillD: -3,
      windRange: `3-7 m/s`,
      weather: `Overcast, windy day or night`,
      color: `#22c55e`,
    },
    E: {
      name: `E - Slightly Stable`,
      description: `Light wind, partial cloud cover at night`,
      pasquillA: 0.098,
      pasquillB: 0.919,
      pasquillC: -0.208,
      pasquillD: -2,
      windRange: `2-5 m/s`,
      weather: `Clear night, light winds`,
      color: `#3b82f6`,
    },
    F: {
      name: `F - Moderately Stable`,
      description: `Clear night, light wind; strong inversion`,
      pasquillA: 0.065,
      pasquillB: 0.896,
      pasquillC: -0.332,
      pasquillD: -1.7,
      windRange: `< 3 m/s`,
      weather: `Clear night, calm conditions`,
      color: `#6366f1`,
    },
  },
  l = 1 / 5,
  u = 3 / 10,
  d = 4 / 5,
  f = 8 / 9,
  p = 1 / 5,
  m = 3 / 40,
  h = 9 / 40,
  g = 44 / 45,
  _ = -56 / 15,
  v = 32 / 9,
  ee = 19372 / 6561,
  te = -25360 / 2187,
  ne = 64448 / 6561,
  re = -212 / 729,
  ie = 9017 / 3168,
  ae = -355 / 33,
  y = 46732 / 5247,
  b = 49 / 176,
  oe = -5103 / 18656,
  se = 35 / 384,
  ce = 500 / 1113,
  x = 125 / 192,
  le = -2187 / 6784,
  S = 11 / 84,
  ue = 71 / 57600,
  C = -71 / 16695,
  w = 71 / 1920,
  T = -17253 / 339200,
  E = 22 / 525,
  D = -1 / 40;
function O(e, t, n, r, i) {
  let a = i?.initialStep ?? Math.min(0.01 * (r - t), 1),
    o = i?.minStep ?? 1e-12,
    s = i?.maxStep ?? Math.abs(r - t),
    c = i?.rtol ?? 1e-8,
    O = i?.atol ?? 1e-12,
    k = i?.maxIterations ?? 1e5,
    A = i?.recordInterval ?? 1,
    j = t,
    M = [...n],
    N = a,
    de = 0,
    fe = 0,
    pe = 0,
    me = [{ t: j, y: [...M] }],
    he = 0,
    P = n.length;
  for (; j < r && de < k;) {
    (j + N > r && (N = r - j), N < o && (N = o));
    let t = e(j, M),
      n = Array(P);
    for (let e = 0; e < P; e++) n[e] = M[e] + N * p * t[e];
    let i = e(j + l * N, n),
      a = Array(P);
    for (let e = 0; e < P; e++) a[e] = M[e] + N * (m * t[e] + h * i[e]);
    let k = e(j + u * N, a),
      ge = Array(P);
    for (let e = 0; e < P; e++)
      ge[e] = M[e] + N * (g * t[e] + _ * i[e] + v * k[e]);
    let _e = e(j + d * N, ge),
      ve = Array(P);
    for (let e = 0; e < P; e++)
      ve[e] = M[e] + N * (ee * t[e] + te * i[e] + ne * k[e] + re * _e[e]);
    let ye = e(j + f * N, ve),
      be = Array(P);
    for (let e = 0; e < P; e++)
      be[e] =
        M[e] + N * (ie * t[e] + ae * i[e] + y * k[e] + b * _e[e] + oe * ye[e]);
    let xe = e(j + N, be),
      Se = Array(P);
    for (let e = 0; e < P; e++)
      Se[e] =
        M[e] + N * (se * t[e] + ce * k[e] + x * _e[e] + le * ye[e] + S * xe[e]);
    let Ce = Array(P);
    for (let e = 0; e < P; e++)
      Ce[e] = Math.abs(
        N *
          (ue * t[e] +
            C * k[e] +
            w * _e[e] +
            T * ye[e] +
            E * xe[e] +
            (D * (Se[e] - M[e])) / N),
      );
    let we = Array(P);
    for (let e = 0; e < P; e++)
      we[e] = O + c * Math.max(Math.abs(M[e]), Math.abs(Se[e]));
    let Te = 0;
    for (let e = 0; e < P; e++) {
      let t = Ce[e] / we[e];
      t > Te && (Te = t);
    }
    if ((de++, Te <= 1)) {
      ((j += N),
        (M = Se),
        fe++,
        he++,
        he >= A && (me.push({ t: j, y: [...M] }), (he = 0)));
      let e = 0.9 * (1 / Math.max(Te, 1e-20)) ** (1 / 5);
      N = Math.min(s, Math.max(o, N * Math.min(e, 5)));
    } else {
      pe++;
      let e = 0.9 * (1 / Te) ** (1 / 5);
      N = Math.max(o, N * Math.max(e, 0.2));
    }
  }
  return (
    me.push({ t: j, y: [...M] }),
    { states: me, steps: de, accepted: fe, rejected: pe, finalTime: j }
  );
}
function k(e, t) {
  let { totalTime: n, initialActivity: r, maxGenerations: i = 5 } = t,
    a = [],
    o = new Set();
  function c(e, t) {
    if (t >= i || o.has(e)) return;
    let n = s(e);
    if (n) {
      (o.add(e), a.push(n));
      for (let e of n.daughters) c(e.symbol, t + 1);
    }
  }
  if ((c(e, 0), a.length === 0))
    return {
      chain: [],
      isotopes: [],
      rk45: { states: [], steps: 0, accepted: 0, rejected: 0, finalTime: 0 },
    };
  let l = a.length,
    u = a.map((e) => e.decayConstant);
  a.map((e) => (e.daughters.length > 0 ? e.daughters[0].branchingRatio : 0));
  let d = [];
  for (let e = 0; e < l; e++) {
    let t = [];
    for (let n = 0; n < l; n++)
      n !== e &&
        a[n].daughters.some((t) => t.symbol === a[e].symbol) &&
        t.push(n);
    d.push(t);
  }
  let f = Array(l).fill(0);
  f[0] = r;
  let p = O(
    (e, t) => {
      let n = Array(l).fill(0);
      for (let e = 0; e < l; e++) {
        let r = 0;
        for (let n of d[e]) {
          let i = a[n].daughters.find((t) => t.symbol === a[e].symbol),
            o = i ? i.branchingRatio : 0;
          r += o * u[n] * t[n];
        }
        let i = u[e] * t[e];
        n[e] = r - i;
      }
      return n;
    },
    0,
    f,
    n,
    {
      rtol: 1e-10,
      atol: 1e-15,
      maxIterations: 5e4,
      recordInterval: Math.max(1, Math.floor(n / 100)),
    },
  );
  return {
    chain: p.states.map((e) => ({
      time: e.t,
      activities: e.y.map((e, t) => ({ symbol: a[t].symbol, activity: e })),
    })),
    isotopes: a,
    rk45: p,
  };
}
var A = 33e-5,
  j = 6371e3,
  M = { A: 213, B: 156, C: 104, D: 68, E: 50.5, F: 34 },
  N = {
    A: { c: 440.8, d: 1.941, f: 9.27 },
    B: { c: 106.6, d: 1.149, f: 3.3 },
    C: { c: 61, d: 0.911, f: 0 },
    D: { c: 33.2, d: 0.725, f: -1.7 },
    E: { c: 22.8, d: 0.678, f: -1.3 },
    F: { c: 14.35, d: 0.74, f: -0.35 },
  },
  de = {
    A: { c: 459.7, d: 2.094, f: -9.6 },
    B: { c: 108.2, d: 1.098, f: 2 },
    C: { c: 61, d: 0.911, f: 0 },
    D: { c: 44.5, d: 0.516, f: -13 },
    E: { c: 55.4, d: 0.305, f: -34 },
    F: { c: 62.6, d: 0.18, f: -48.6 },
  };
function fe(e, t) {
  let n = Math.max(t, 1) / 1e3;
  return Math.max(M[e] * n ** 0.894, 0.1);
}
function pe(e, t) {
  let n = Math.max(t, 1) / 1e3,
    r = n < 1 ? N[e] : de[e];
  return Math.max(r.c * n ** +r.d + r.f, 0.1);
}
function me(e, t) {
  let n = Math.max(t, 1);
  switch (e) {
    case `A`:
    case `B`:
      return {
        sy: (0.32 * n) / Math.sqrt(1 + 4e-4 * n),
        sz: 0.24 * n * Math.sqrt(1 + 0.001 * n),
      };
    case `C`:
      return { sy: (0.22 * n) / Math.sqrt(1 + 4e-4 * n), sz: 0.2 * n };
    case `D`:
      return {
        sy: (0.16 * n) / Math.sqrt(1 + 4e-4 * n),
        sz: (0.14 * n) / Math.sqrt(1 + 3e-4 * n),
      };
    default:
      return {
        sy: (0.11 * n) / Math.sqrt(1 + 4e-4 * n),
        sz: (0.08 * n) / Math.sqrt(1 + 0.0015 * n),
      };
  }
}
function he(e, t, n) {
  return n === `urban` ? me(e, t) : { sy: fe(e, t), sz: pe(e, t) };
}
function P(e, t, n) {
  let r = Math.max(n, 0.01),
    i = Math.max(t, 10 * r, 2);
  return e * (Math.log(i / r) / Math.log(10 / r));
}
function ge(e) {
  let { sourceTerm: t, meteorology: n } = e,
    r = Math.max(t.releaseHeight, 0),
    i =
      (t.stackTemperature ?? n.airTemperature ?? 20) - (n.airTemperature ?? 20);
  if (Math.abs(i) < 0.1 || n.windSpeed < 0.1) return r;
  let a = i > 0 ? 1.5 * Math.abs(i) ** 0.5 : -1 * Math.abs(i) ** 0.4;
  return Math.max(r + a, 0);
}
function _e(e, t) {
  let { sourceTerm: n, meteorology: r, terrain: i } = e,
    a = r.windSpeed < 0.5,
    o = ge(e),
    c = s(n.isotope),
    { sy: l, sz: u } = a
      ? { sy: Math.max(t * 0.35, 15), sz: Math.max(t * 0.25, 10) }
      : he(r.stabilityClass, t, i.terrainType);
  if (!c || n.activity <= 0) return { concentration: 0, sy: l, sz: u };
  let d = Math.max(n.releaseDuration, 1e-6) * 3600,
    f = n.activity / d;
  if (a) {
    let e = Math.max(t, 1),
      r = (4 / 3) * Math.PI * e ** 3,
      i = (n.activity / r) * Math.exp(-c.decayConstant * (e / 0.5));
    return { concentration: Math.max(i, 0), sy: e, sz: e };
  }
  let p = Math.max(P(r.windSpeed, o, i.surfaceRoughness), 0.5),
    m = t / p,
    h = f * Math.exp(-c.decayConstant * m),
    g = Math.max(e.receptorHeight, 0),
    _ = r.mixingHeight,
    v;
  if (_ > 0 && u > 1.2 * _) v = h / (Math.sqrt(2 * Math.PI) * l * _ * p);
  else {
    let e =
      Math.exp(-((g - o) ** 2) / (2 * u * u)) +
      Math.exp(-((g + o) ** 2) / (2 * u * u));
    v = (h / (2 * Math.PI * l * u * p)) * e;
  }
  return { concentration: Math.max(v, 0), sy: l, sz: u };
}
function ve(e) {
  return e === `gas` ? 0.001 : e === `particle` ? 0.02 : 0.01;
}
function ye(e) {
  return /^I-\d+/i.test(e);
}
function be(e, t) {
  let { sourceTerm: n } = t,
    r = s(n.isotope);
  if (!r || e <= 0)
    return {
      plumeDeposition: 0,
      externalDose: 0,
      cloudDose: 0,
      groundDose: 0,
      inhalationDose: 0,
      skinDose: 0,
      ingestionEquivalentDose: 0,
      totalEffectiveDose: 0,
      thyroidDose: 0,
    };
  let i = Math.min(
      t.averagingTime || 3600,
      Math.max(n.releaseDuration, 1e-6) * 3600,
    ),
    a = e * r.doseRateConstant * i,
    o = e * A * i * r.inhalationCoefficient,
    c = e * ve(n.physicalForm) * i,
    l = c * r.externalDoseCoefficient,
    u = a * 1.5 + c * 2.2,
    d = c * 0.8 * (r.inhalationCoefficient * 0.5),
    f = a + o + l,
    p = ye(r.symbol) ? o / 0.05 : f;
  return {
    plumeDeposition: c,
    externalDose: l + a,
    cloudDose: a,
    groundDose: l,
    inhalationDose: o,
    skinDose: u,
    ingestionEquivalentDose: d,
    totalEffectiveDose: f,
    thyroidDose: p,
  };
}
function xe(e, t) {
  let n = ye(t),
    r = [];
  for (let t of e) {
    let e = t.totalEffectiveDose;
    (e >= 0.1
      ? r.push({
          distance: t.distance,
          action: `Эвакуация населения / Укрытие в защитных сооружениях`,
          zone: `Зона экстренных мероприятий (Exclusion Zone)`,
          criteria: `Эффективная доза >= 100 мЗв`,
          level: `emergency`,
        })
      : e >= 0.05
        ? r.push({
            distance: t.distance,
            action: `Укрытие населения / Подготовка к эвакуации`,
            zone: `Зона предупредительных действий`,
            criteria: `Эффективная доза >= 50 мЗв`,
            level: `alert`,
          })
        : e >= 0.01
          ? r.push({
              distance: t.distance,
              action: `Радиационный контроль / Ограничение въезда`,
              zone: `Зона радиационного контроля`,
              criteria: `Эффективная доза >= 10 мЗв`,
              level: `caution`,
            })
          : e >= 0.001 &&
            r.push({
              distance: t.distance,
              action: `Мониторинг параметров среды`,
              zone: `Зона наблюдения`,
              criteria: `Эффективная доза >= 1 мЗв`,
              level: `advisory`,
            }),
      n &&
        t.thyroidDose >= 0.05 &&
        !r.some(
          (e) => e.distance === t.distance && e.action.includes(`Йодная`),
        ) &&
        r.push({
          distance: t.distance,
          action: `Проведение йодной профилактики (калия йодид)`,
          zone: `Зона йодной профилактики`,
          criteria: `Доза на щитовидную железу >= 50 мЗв`,
          level: `alert`,
        }));
  }
  return r;
}
function Se(e, t) {
  let n = [],
    { meteorology: r } = e,
    i = r.windSpeed < 0.5,
    a = (r.windDirection * Math.PI) / 180;
  for (let r of t) {
    let { concentration: t, sy: o } = _e(e, r),
      s = be(t, e);
    if (i)
      for (let e = 0; e < 16; e++) {
        let i = (e / 16) * 2 * Math.PI;
        n.push({
          x: r * Math.cos(i),
          y: r * Math.sin(i),
          concentration: t,
          dose: s.totalEffectiveDose,
        });
      }
    else
      for (let e of [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]) {
        let i = e * o,
          c = Math.exp(-(i * i) / (2 * o * o)),
          l = t * c,
          u = s.totalEffectiveDose * c,
          d = r * Math.cos(a) - i * Math.sin(a),
          f = r * Math.sin(a) + i * Math.cos(a);
        n.push({ x: d, y: f, concentration: l, dose: u });
      }
  }
  return n;
}
function Ce(e, t, n, r) {
  let i = (r / j) * (180 / Math.PI),
    a = (n / (j * Math.cos((e * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: e + i, lon: t + a };
}
function we(e, t) {
  let n = e.sourceTerm.latitude,
    r = e.sourceTerm.longitude;
  return t.map((e) => {
    let t = Ce(n, r, e.x, e.y);
    return {
      lat: t.lat,
      lon: t.lon,
      concentration: e.concentration,
      dose: e.dose,
    };
  });
}
function Te(e) {
  let t = [],
    n = [];
  e.meteorology.windSpeed < 0.5 &&
    n.push(
      `Режим штиля (< 0.5 м/с): активирована 3D-модель изотропного рассеивания облака.`,
    );
  let r = e.sourceTerm.stackTemperature ?? e.meteorology.airTemperature ?? 20,
    i = e.meteorology.airTemperature ?? 20;
  Math.abs(r - i) > 5 &&
    n.push(
      `Учтен градиент температур (ΔT = ${(r - i).toFixed(1)} °C) для плавучести факела.`,
    );
  for (let n of e.distances) {
    let { concentration: r, sy: i, sz: a } = _e(e, n),
      o = be(r, e),
      s = n / Math.max(e.meteorology.windSpeed, 0.5);
    t.push({
      distance: n,
      centerlineConcentration: r,
      crosswindSpread: i,
      verticalSpread: a,
      plumeWidth: i * 4,
      arrivalTime: s,
      arrivalTimeFormatted: Oe(s),
      exposureDuration: Math.min(
        e.averagingTime || 3600,
        e.sourceTerm.releaseDuration * 3600,
      ),
      ...o,
    });
  }
  let a = t.reduce(
      (e, t) =>
        t.centerlineConcentration > e.value
          ? { distance: t.distance, value: t.centerlineConcentration }
          : e,
      { distance: 0, value: 0 },
    ),
    o = t.reduce(
      (e, t) =>
        t.totalEffectiveDose > e.value
          ? { distance: t.distance, value: t.totalEffectiveDose }
          : e,
      { distance: 0, value: 0 },
    ),
    s = 0,
    c = 0,
    l = 0;
  for (let e of t)
    (e.totalEffectiveDose >= 0.1 && e.distance > s && (s = e.distance),
      e.totalEffectiveDose >= 0.01 && e.distance > c && (c = e.distance),
      e.totalEffectiveDose >= 0.001 && e.distance > l && (l = e.distance));
  let u = xe(t, e.sourceTerm.isotope),
    d = Se(e, e.distances),
    f = we(e, d),
    p = e.sourceTerm.releaseDuration * 3600,
    m = k(e.sourceTerm.isotope, {
      totalTime: p,
      initialActivity: e.sourceTerm.activity,
      maxGenerations: 5,
    });
  return {
    results: t,
    input: e,
    maxConcentration: a,
    maxDoseDistance: o,
    plumeFootprint: d,
    geoFootprint: f,
    decayChainResult: m.chain,
    rk45Stats: {
      steps: m.rk45.steps,
      accepted: m.rk45.accepted,
      rejected: m.rk45.rejected,
      finalTime: m.rk45.finalTime,
    },
    zoneSummary: {
      exclusionZone: s,
      contaminationZone: c,
      ingestionZone: l,
      totalAffected: l,
    },
    protectiveActions: u,
    warnings: n,
  };
}

export {Te};function Oe(e){return e+'s'}
