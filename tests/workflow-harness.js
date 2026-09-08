const fs = require('node:fs');
const vm = require('node:vm');
module.exports = function harness() {
  const elements = new Map();
  const stored = new Map();
  function element() {
    return {value:'',dataset:{},options:[],style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},
      addEventListener(){},querySelectorAll(){return [];},querySelector(){return null;},
      setAttribute(){},remove(){},appendChild(){},close(){},innerHTML:'',textContent:''};
  }
  const context = {console,Date,Intl,Math,Set,Map,Blob,URL,window:{},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
      querySelectorAll(){return [];},querySelector(){return null;},addEventListener(){}},
    localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
    LeakIntelligence:require('../src/intelligence.js'),MeterVisibility:require('../src/meter-visibility.js'),LeakHistory:require('../src/history-comparison.js'),
    XLSX:{read:table=>({Sheets:{data:table},SheetNames:['data']}),utils:{sheet_to_json:x=>x}},
    confirm:()=>true,prompt:()=>'',requestAnimationFrame(){},setTimeout(){},clearTimeout(){}};
  vm.createContext(context);
  const app = fs.readFileSync(require.resolve('../src/app.js'),'utf8').replace(/bootstrap\(\);\s*$/, '');
  vm.runInContext(app + '\nglobalThis.testApp={state,parseWorkbook,analyze,readingTimeline};',context);
  const field=fs.readFileSync(require.resolve('../src/field-workflow.js'),'utf8').replace(/  analyze\(\);\s*\}\(\)\);\s*$/, `
    window.testWorkflow={matchingRows,matchesFilter,setMetersHidden,renderListTabs,quickAssignMeters,renderLeakSignalChart};
  }());`);
  vm.runInContext(field,context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/smart-engine.js'),'utf8'),context);
  vm.runInContext('render = function() {}; state.labels = {};',context);
  elements.get('filter').value='all'; elements.get('sort').value='risk';
  elements.get('excludeFilter').value='none'; elements.get('areaFilter').value='all';
  return {context,app:context.testApp,workflow:context.window.testWorkflow,elements,stored};
};
