const tr = JSON.parse(require('fs').readFileSync('src/i18n/tr.json','utf8'));
const en = JSON.parse(require('fs').readFileSync('src/i18n/en.json','utf8'));
const checks = ['animal.title','feeds.title','herd.title','ration.optimize','results.no_ration','results.go_optimize','animal.delete','herd.milk_price','obs.title','settings.title','pm.title','scen.title','sens.title'];
checks.forEach(k => {
  const parts = k.split('.');
  let vt=tr,ve=en;
  parts.forEach(p => { vt = vt && vt[p]; ve = ve && ve[p]; });
  console.log(k + ': TR=' + JSON.stringify(vt) + '  EN=' + JSON.stringify(ve));
});
