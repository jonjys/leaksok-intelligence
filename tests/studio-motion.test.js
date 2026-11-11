const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/studio-motion.js'),'utf8');

function setup({reduce=false}={}) {
  const listeners={},frames=[],animations=[],cancelled=[];
  class Element {
    constructor(id,top=0){this.dataset={id};this.top=top;this.scrollTop=0;this.scrollHeight=900;this.clientHeight=300;}
    getBoundingClientRect(){return {top:this.top,bottom:this.top+70};}
    matches(){return true;}
    closest(){return this;}
    animate(keyframes,options){animations.push({id:this.dataset.id,keyframes,options});}
    getAnimations(){return [{cancel:()=>cancelled.push(this.dataset.id)}];}
  }
  const rows=[new Element('a',0),new Element('b',70),new Element('c',140)];
  const table=new Element('table');table.getBoundingClientRect=()=>({top:0,bottom:300});table.querySelectorAll=()=>rows;
  const panel=new Element('panel');let headerScrolled=false;
  const header={classList:{toggle:(name,value)=>{headerScrolled=value;}}};
  const reduced={matches:reduce,addEventListener:(name,fn)=>{reduced.change=fn;}};
  const document={
    addEventListener:(name,fn)=>{listeners[name]=fn;},
    querySelector:s=>s==='.table-wrap'?table:s==='.meter-panel'?panel:s==='.topbar'?header:null,
    querySelectorAll:s=>s==='#rows tr.row, .focus-head'?rows:[table,panel],
    getElementById:id=>id==='rows'?{}:null,
  };
  const window={scrollY:0,addEventListener(){}};
  vm.runInNewContext(source,{Element,document,window,matchMedia:()=>reduced,innerHeight:600,
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}}});
  const flush=()=>{while(frames.length)frames.shift()();};
  return {listeners,frames,animations,cancelled,rows,table,window,reduced,flush,headerScrolled:()=>headerScrolled,Element};
}

test('Scroll shading follows the start, middle and end without changing scroll positions',()=>{
  const h=setup();h.flush();assert.equal(h.table.dataset.scrollEdge,'start');
  h.table.scrollTop=150;h.listeners.scroll({target:h.table});h.flush();
  assert.equal(h.table.dataset.scrollEdge,'middle');assert.equal(h.table.scrollTop,150);
  h.table.scrollTop=600;h.listeners.scroll({target:h.table});h.flush();assert.equal(h.table.dataset.scrollEdge,'end');
  h.table.scrollHeight=300;h.listeners.scroll({target:h.table});h.flush();assert.equal(h.table.dataset.scrollEdge,'none');
});

test('Sorting animates visible retained rows without moving the table or page',()=>{
  const h=setup();h.flush();h.listeners.click({target:new h.Element('sort')});
  h.rows[0].top=140;h.rows[2].top=0;h.flush();
  assert.deepEqual(h.animations.map(a=>a.id),['a','c']);
  assert.equal(h.animations[0].keyframes[0].transform,'translateY(-140px)');
  assert.equal(h.table.scrollTop,0);assert.equal(h.window.scrollY,0);
});

test('Reduced motion skips sorting effects and cancels existing effects when enabled',()=>{
  const h=setup({reduce:true});h.flush();h.listeners.click({target:new h.Element('sort')});h.flush();
  assert.equal(h.animations.length,0);
  h.reduced.change();assert.deepEqual(h.cancelled,['a','b','c']);
});
