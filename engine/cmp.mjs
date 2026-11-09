import {Te} from './legacy.mjs'; import {AR} from './engine.mjs';
const mk=(sym,act,u,cls,dir)=>({sourceTerm:{isotope:sym,activity:act,releaseDuration:1,releaseHeight:30,latitude:40.2,longitude:68.8,physicalForm:'aerosol'},meteorology:{windSpeed:u,windDirection:dir,stabilityClass:cls,mixingHeight:1000},terrain:{terrainType:'rural',surfaceRoughness:.1},distances:[500,1000,2000,5000],receptorHeight:1.5,averagingTime:3600});
for (const [sym,act] of [['Cs-137',1e14],['I-131',1e14],['Xe-133',1e16],['Co-60',1e13],['Sr-90',1e13],['Pu-239',1e11]]) {
  const i=mk(sym,act,5,'D',90); const o=Te(i), n=AR.run(i);
  console.log(sym.padEnd(7),'1км: старое E=',(o.results[1].totalEffectiveDose*1e3).toExponential(2),'мЗв | новое E10=',(n.results[1].dose10d*1e3).toExponential(2),'мЗв | отношение нов/стар =',(n.results[1].dose10d/o.results[1].totalEffectiveDose).toFixed(2));
}
// направление
const i=mk('Cs-137',1e14,5,'D',90); const o=Te(i), n=AR.run(i);
const far=(f)=>f.reduce((a,p)=>Math.hypot(p.x,p.y)>Math.hypot(a.x,a.y)?p:a);
const fo=far(o.plumeFootprint.filter(p=>Math.abs(p.y)<1e-3||true)); const fn=far(n.plumeFootprint);
console.log('ветер ОТКУДА 90° (с востока): старый шлейф уходит в (E,N)=',o.plumeFootprint.find(p=>Math.hypot(p.x,p.y)>4900)?.x.toFixed(0),o.plumeFootprint.find(p=>Math.hypot(p.x,p.y)>4900)?.y.toFixed(0),' новый:',fn.x.toFixed(0),fn.y.toFixed(0),'(должен быть на запад: x<0)');
// штиль
const c=mk('Cs-137',1e14,0.3,'D',90); console.log('штиль 0.3 м/с, 500 м: старое C=',Te(c).results[0].centerlineConcentration.toExponential(2),' новое C=',AR.run(c).results[0].centerlineConcentration.toExponential(2));
console.log('поля UI, не влиявшие на расчёт: precipitationRate, buildingWake, complexTerrain, particleSize, releaseType, calculationType, inversionHeight; airTemperature был недоступен по умолчанию (поле temperature)');
