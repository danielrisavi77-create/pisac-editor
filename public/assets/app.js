
(function () {
  "use strict";
  var events=[],ledger=[],prints=[],footnotes=[],comments=[],seq=0,selSpan=null,scrubAt=null,playTimer=null;
  var citeStyle="fpzg", sessionStart=0, cid=0;

  var SOURCES=[
    {id:"S1",type:"article",authors:[["Lindblom","Charles E."]],year:1959,title:"The Science of Muddling Through",journal:"Public Administration Review",vol:19,issue:2,pages:"79–88",note:"Donositelji odluka uspoređuju tek ograničen broj alternativa koje se od postojeće politike razlikuju u malim koracima."},
    {id:"S2",type:"article",authors:[["Lindblom","Charles E."]],year:1979,title:"Still Muddling, Not Yet Through",journal:"Public Administration Review",vol:39,issue:6,pages:"517–526",note:"Dvadeset godina kasnije Lindblom brani inkrementalizam kao opis prakse, ne kao normativni ideal."},
    {id:"S3",type:"article",authors:[["Etzioni","Amitai"]],year:1967,title:"Mixed-Scanning: A Third Approach to Decision-Making",journal:"Public Administration Review",vol:27,issue:5,pages:"385–392",note:"Miješano skeniranje kombinira šire strateške odluke s inkrementalnim prilagodbama."},
    {id:"S4",type:"article",authors:[["Hall","Peter A."],["Taylor","Rosemary C. R."]],year:1996,title:"Political Science and the Three New Institutionalisms",journal:"Political Studies",vol:44,issue:5,pages:"936–957",note:"Tri struje neoinstitucionalizma: povijesna, racionalnog izbora i sociološka."},
    {id:"S5",type:"book",authors:[["March","James G."],["Olsen","Johan P."]],year:1989,title:"Rediscovering Institutions: The Organizational Basis of Politics",place:"New York",publisher:"Free Press",note:"Institucije nisu samo pravila nego i logika prikladnosti koja oblikuje što akteri smatraju očekivanim."},
    {id:"S6",type:"book",authors:[["Pierson","Paul"]],year:2004,title:"Politics in Time: History, Institutions, and Social Analysis",place:"Princeton",publisher:"Princeton University Press",note:"Ovisnost o putu objašnjava zašto se rane odluke teško preokreću i nakon što prestanu biti korisne."},
    {id:"S7",type:"book",authors:[["Kingdon","John W."]],year:1984,title:"Agendas, Alternatives, and Public Policies",place:"Boston",publisher:"Little, Brown",note:"Prilika za promjenu otvara se kad se tokovi problema, rješenja i politike poklope."},
    {id:"S8",type:"book",authors:[["Peters","B. Guy"]],year:2019,title:"Institutional Theory in Political Science",place:"Cheltenham",publisher:"Edward Elgar",note:"Pregled institucionalnih pristupa i njihovih granica u objašnjavanju promjene."},
    {id:"S9",type:"institution",acronym:"DZS",institution:"Državni zavod za statistiku",year:2023,title:"Statistički ljetopis Republike Hrvatske 2023.",place:"Zagreb",publisher:"DZS",note:"Službeni podaci o migracijskim tokovima i radnim dozvolama."}
  ];
  var SRC={}; SOURCES.forEach(function(s){ SRC[s.id]=s; });
  var BUDGET={"Uvod":900,"Teorijski okvir":3200,"Metodološki okvir":1200,"Analiza slučaja":4200,"Zaključak":900};
  var OPSEG_MIN=10000,OPSEG_MAX=15000,MIN_IZVORA=15,MIN_KNJIGA=3;
  var ROK=new Date(Date.now()+62*864e5);
  var KIND_LABEL={typed:"Tipkano u sustavu",pasted_internal:"Zalijepljeno iz literature",ai_inserted:"AI umetnuto (praćeni kanal)",ai_matched:"AI podudarno (heuristika)",template:"Predložak sustava",unattributed:"Nepripisano (usklađivanje)",pasted_unknown:"Nepoznato podrijetlo"};
  /* Pouzdanost je ODVOJENA os od podrijetla: dokazana veza nije isto što i heuristika. */
  var CONF_LABEL={cryptographically_bound:"dokazana veza",exact_match:"točno podudaranje",declared:"studentova izjava",observed:"opaženo",heuristic_match:"heuristika",unresolved:"neutvrđeno"};
  var KIND_CLASS={typed:"typed",pasted_internal:"internal",ai_inserted:"ai",ai_matched:"aim",template:"tpl",unattributed:"unknown",pasted_unknown:"unknown"};
  var KIND_VAR={typed:"--p-typed",pasted_internal:"--p-internal",ai_inserted:"--p-ai",ai_matched:"--p-ai",template:"--p-template",unattributed:"--p-unknown",pasted_unknown:"--p-unknown"};
  var POLICY={max_unknown_provenance_pct:15,max_ai_inserted_pct:10,disallowed_ai_purposes:["generate"]};
  function $(id){ return document.getElementById(id); }

  function sha256(s){ return crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)).then(function(b){
    return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,"0");}).join(""); }); }
  var hq=Promise.resolve();
  function chainHash(ev){ hq=hq.then(function(){
    var i=events.indexOf(ev),prev=i>0?(events[i-1].hash||"GENESIS"):"GENESIS"; ev.prevHash=prev;
    return sha256(prev+ev.type+JSON.stringify(ev.payload)+ev.serverTs).then(function(h){ ev.hash=h; renderLog(); }); }); }
  function fp(s){ var h=5381,t=s.replace(/\s+/g," ").trim().toLowerCase();
    for(var i=0;i<t.length;i++) h=((h<<5)+h+t.charCodeAt(i))|0; return String(h); }
  /* U prototipu NE postoji server. Vrijeme se zato zove onako kako i nastaje —
     createdAtClient — a polje receivedAtServer je prazno dok ga server ne popuni.
     Nikad ne zvati klijentsko vrijeme „serverTs". */
  function push(type,payload,mins){ seq+=1;
    var ts=mins!=null?new Date(Date.now()-mins*60000).toISOString():new Date().toISOString();
    var ev={seq:seq,type:type,payload:payload,createdAtClient:ts,receivedAtServer:null,
            serverTs:ts,prevHash:null,hash:null};
    events.push(ev); chainHash(ev); return ev; }

  /* ---------- stvarna verifikacija lanca ----------
     Nije dovoljno da hash postoji: mora se PONOVNO izračunati i usporediti, i
     provjeriti da svaki prevHash odgovara hashu prethodnika. */
  function verifyChain(){
    var prevH="GENESIS";
    return events.reduce(function(chain,ev){
      return chain.then(function(st){
        if (!st.ok) return st;
        if (ev.prevHash!==prevH) return {ok:false,at:ev.seq,why:"prevHash ne odgovara prethodniku"};
        return sha256(prevH+ev.type+JSON.stringify(ev.payload)+ev.serverTs).then(function(h){
          if (!ev.hash) return {ok:false,at:ev.seq,why:"hash još nije izračunat"};
          if (h!==ev.hash) return {ok:false,at:ev.seq,why:"payload ne odgovara hashu"};
          prevH=ev.hash; return st;
        });
      });
    }, Promise.resolve({ok:true,at:null,why:""}));
  }

  /* ---------- invarijanta: reconstruct(ledger) === dokument ---------- */
  function invariant(){
    /* Nezapisani tipkani međuspremnik je LEGITIMNO u dokumentu a još ne u
       zapisniku — invarijanta ga mora uračunati, inače usklađivanje okida lažno. */
    var a=textOfSpans(reconstruct(null));
    if (pending) a = a.slice(0,pending.pos) + pending.text + a.slice(pending.pos);
    var b=extractText(ed);
    if (a===b) return {ok:true,len:b.length};
    var i=0; while (i<a.length&&i<b.length&&a[i]===b[i]) i++;
    return {ok:false,at:i,ledger:a.length,doc:b.length,
            near:JSON.stringify(b.slice(Math.max(0,i-18),i+18))};
  }
  function textOfSpans(sp){ return sp.map(function(s){ return s.text; }).join(""); }
  window.__invariant=invariant;

  /* ---------- usklađivanje ----------
     Dokazni sustav ne smije tiho razići zapisnik i dokument. Ako se to ipak
     dogodi (rubni slučaj contenteditable/execCommand), razlika se NE skriva:
     upisuje se kao poseban događaj i pripada kategoriji „nepripisano". Ovo je
     zaštitna mreža, ne rješenje — pravo rješenje je transakcijski model
     uređivača (EDITOR.md §2). */
  var reconciling=false, reconCount=0;
  function reconcile(){
    if (reconciling) return false;
    var iv=invariant(); if (iv.ok) return false;
    reconciling=true;
    var led=textOfSpans(reconstruct(null)), doc=extractText(ed);
    var i=0; while (i<led.length&&i<doc.length&&led[i]===doc[i]) i++;
    var j=0; while (j<led.length-i&&j<doc.length-i&&led[led.length-1-j]===doc[doc.length-1-j]) j++;
    var delLen=led.length-i-j, insTxt=doc.slice(i,doc.length-j);
    flush();
    if (delLen>0) push("delete",{pos:i,length:delLen,input_source:"reconciliation"});
    if (insTxt.length) push("insert",{pos:i,text:insTxt,modality:"reconciliation",
      input_source:"reconciliation",browser_event_trusted:false,
      originKind:"unattributed",originRef:null,confidence:"unresolved"});
    push("reconciliation",{at:i,removed:delLen,added:insTxt.length});
    reconCount++; reconciling=false;
    return true;
  }

  /* ---- citiranje ---- */
  function prez(s){ if (s.type==="institution") return s.acronym;
    var a=s.authors; return a.length===1?a[0][0]:a.length===2?a[0][0]+" i "+a[1][0]:a[0][0]+" i sur."; }
  function citeInText(id,page){ var s=SRC[id];
    if (citeStyle==="apa") return "("+prez(s).replace(" i "," & ")+", "+s.year+(page?", str. "+page:"")+")";
    if (citeStyle==="chicago") return "("+prez(s)+" "+s.year+(page?", "+page:"")+")";
    return "("+prez(s)+", "+s.year+(page?": "+page:"")+")"; }
  function autoriPopis(s){ return s.type==="institution" ? s.acronym+" ("+s.institution+")"
    : s.authors.map(function(a){ return a[0]+", "+a[1]; }).join(", "); }
  function bibEntry(id){ var s=SRC[id];
    if (citeStyle==="apa"){
      var aa=s.type==="institution"?s.acronym:s.authors.map(function(a){ return a[0]+", "+a[1].split(" ").map(function(x){return x[0]+".";}).join(" "); }).join(", & ");
      return s.type==="article" ? aa+" ("+s.year+"). "+s.title+". <em>"+s.journal+"</em>, "+s.vol+"("+s.issue+"), "+s.pages+"."
                                : aa+" ("+s.year+"). <em>"+s.title+"</em>. "+s.place+": "+s.publisher+"."; }
    if (citeStyle==="chicago"){
      var ac=s.type==="institution"?s.institution:s.authors.map(function(a,i){ return i===0?a[0]+", "+a[1]:a[1]+" "+a[0]; }).join(" i ");
      return s.type==="article" ? ac+". "+s.year+". „"+s.title+".” <em>"+s.journal+"</em> "+s.vol+" ("+s.issue+"): "+s.pages+"."
                                : ac+". "+s.year+". <em>"+s.title+"</em>. "+s.place+": "+s.publisher+"."; }
    var a0=autoriPopis(s);
    return s.type==="article" ? a0+" ("+s.year+") "+s.title+". "+s.journal+" "+s.vol+"/"+s.issue+": "+s.pages+"."
                              : a0+" ("+s.year+") "+s.title+". "+s.place+": "+s.publisher+"."; }
  function sortKey(id){ var s=SRC[id]; return (s.type==="institution"?s.acronym:s.authors[0][0])+"|"+s.year; }

  /* ---- ekstrakcija ---- */
  var BLOCK=/^(P|H1|H2|H3|H4|LI|BLOCKQUOTE|DIV|PRE|FIGCAPTION|FIGURE|TR)$/;
  function extractText(root){
    var out="";
    function walk(n){
      if (n.nodeType===3){ out+=n.nodeValue; return; }
      if (n.nodeType!==1) return;
      if (n.dataset && n.dataset.noprov==="1") return;
      if (n.tagName==="BR"){ out+="\n"; return; }
      var before=out.length;
      Array.prototype.forEach.call(n.childNodes,walk);
      if ((n.tagName==="TD"||n.tagName==="TH") && out.length>before && out.slice(-1)!=="\t") out+="\t";
      else if (BLOCK.test(n.tagName) && out.length>before && out.slice(-1)!=="\n") out+="\n";
    }
    Array.prototype.forEach.call(root.childNodes,walk);
    return out;
  }

  /* ---- klasifikacija ---- */
  function normWords(s){ return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").split(/\s+/).filter(Boolean); }
  function matchesLedger(t){ var w=normWords(t); if (w.length<8) return false;
    var b=ledger.map(function(l){ return " "+normWords(l.response).join(" ")+" "; });
    for (var i=0;i+8<=w.length;i++){ var win=" "+w.slice(i,i+8).join(" ")+" ";
      for (var j=0;j<b.length;j++) if (b[j].indexOf(win)!==-1) return true; } return false; }
  function classify(text,mod,ref){
    if (mod==="ai_insert") return {kind:"ai_inserted",ref:ref};
    if (mod==="paste"){ var h=fp(text),hit=null;
      for (var i=prints.length-1;i>=0;i--) if (prints[i].h===h){ hit=prints[i]; break; }
      return hit?{kind:hit.carry,ref:{source:hit.srcId}}:{kind:"pasted_unknown",ref:null}; }
    if (matchesLedger(text)) return {kind:"ai_matched",ref:null};
    return {kind:"typed",ref:null}; }

  /* ---- ritam unosa ----
     Bilježi se KADA je tekst stigao, ne KOJA je tipka pritisnuta. Razmaci su
     kvantizirani na 10 ms i ograničeni na 5 s — dovoljno za vjeran replay i za
     prepoznavanje skupnog unosa, a nedovoljno da bude zapis tipkovnice. */
  var pending=null,pendTimer=null,lastBeat=0;
  function timingOf(p){
    var gaps=p.beats.map(function(b){ return b[0]; }).slice(1);
    var tot=p.beats.reduce(function(a,b){ return a+b[0]; },0);
    var srt=gaps.slice().sort(function(a,b){ return a-b; });
    return { ms:tot, n:p.text.length,
      cps: tot>120 ? +(p.text.length/(tot/1000)).toFixed(1) : null,
      med: srt.length?srt[Math.floor(srt.length/2)]:0,
      max: srt.length?srt[srt.length-1]:0,
      beats: p.beats.slice(0,300) };
  }
  function flush(){ if (pendTimer){ clearTimeout(pendTimer); pendTimer=null; }
    if (!pending) return;
    var c=classify(pending.text,"keyboard",null);
    push("insert",{pos:pending.pos,text:pending.text,modality:"keyboard",
                   input_source:pending.src||"user",browser_event_trusted:pending.trusted!==false,
                   originKind:c.kind,originRef:c.ref,
                   confidence:c.kind==="ai_matched"?"heuristic_match":"observed",
                   timing:timingOf(pending)});
    pending=null; renderStatus(); }
  function bufferTyped(pos,text){
    var now=Date.now();
    if (pending && pending.pos+pending.text.length===pos){
      pending.beats.push([Math.min(Math.round((now-lastBeat)/10)*10,5000),text.length]);
      pending.text+=text;
      if (lastSource!=="user") pending.src=lastSource;
      if (!lastTrusted) pending.trusted=false;
    } else { flush(); pending={pos:pos,text:text,beats:[[0,text.length]],
                               src:lastSource,trusted:lastTrusted}; }
    lastBeat=now;
    if (pendTimer) clearTimeout(pendTimer);
    pendTimer=setTimeout(flush,900);
    $("st-save").textContent="upisujem…"; }

  /* ---- rekonstrukcija ---- */
  function splitAt(sp,pos){ var l=[],r=[],acc=0;
    sp.forEach(function(s){ var st=acc,en=acc+s.text.length; acc=en;
      if (en<=pos) l.push(s); else if (st>=pos) r.push(s);
      else { var k=pos-st; l.push(Object.assign({},s,{id:s.id+"a",text:s.text.slice(0,k)}));
             r.push(Object.assign({},s,{id:s.id+"b",text:s.text.slice(k)})); } });
    return [l,r]; }
  function cut(sp,pos,len){ var end=pos+len,keep=[],gone=[],acc=0;
    sp.forEach(function(s){ var st=acc,en=acc+s.text.length; acc=en;
      if (en<=pos||st>=end){ keep.push(s); return; }
      var a=Math.max(pos,st)-st,b=Math.min(end,en)-st;
      var bf=s.text.slice(0,a),md=s.text.slice(a,b),af=s.text.slice(b);
      if (bf) keep.push(Object.assign({},s,{id:s.id+"L",text:bf}));
      if (md) gone.push(Object.assign({},s,{id:s.id+"X",text:md}));
      if (af) keep.push(Object.assign({},s,{id:s.id+"R",text:af})); });
    return {keep:keep,gone:gone}; }
  function reconstruct(upto){ var sp=[],repl=null;
    for (var i=0;i<events.length;i++){ var ev=events[i]; if (upto!=null&&ev.seq>upto) break;
      if (ev.type==="insert"){ var p=ev.payload,pt=splitAt(sp,p.pos);
        sp=pt[0].concat([{id:"S"+ev.seq,text:p.text,originEventId:ev.seq,originKind:p.originKind,
          originRef:p.originRef||null,replaces:(repl&&repl.pos===p.pos)?repl.ids:[],
          replacedText:(repl&&repl.pos===p.pos)?repl.text:""}],pt[1]); repl=null; }
      else if (ev.type==="delete"){ var r=cut(sp,ev.payload.pos,ev.payload.length); sp=r.keep;
        repl={pos:ev.payload.pos,ids:r.gone.map(function(s){return s.id;}),text:r.gone.map(function(s){return s.text;}).join("")}; } }
    return sp; }
  function composition(sp){ var total=0,by={};
    sp.forEach(function(s){ total+=s.text.length; by[s.originKind]=(by[s.originKind]||0)+s.text.length; });
    footnotes.forEach(function(f){ total+=f.text.length; by[f.kind]=(by[f.kind]||0)+f.text.length; });
    var rows=Object.keys(KIND_LABEL).filter(function(k){return by[k];}).map(function(k){ return {kind:k,pct:total?(by[k]/total)*100:0}; });
    return {total:total,rows:rows,unknownPct:total?((by.pasted_unknown||0)/total)*100:0,
            aiPct:total?(((by.ai_inserted||0)+(by.ai_matched||0))/total)*100:0}; }

  /* ---- editor ---- */
  var ed=$("editor"),prev="",pasteNext=null;
  /* Izvor unosa: „user" = pravi korisnički događaj (event.isTrusted),
     „ui" = naša alatna traka, „script" = sintetički događaj nepoznatog porijekla,
     „seed" = sjeme demoa. isTrusted NIKAD ne znači „čovjek" — znači samo da je
     događaj proizveo preglednik kroz svoj sustav događaja. */
  var uiAction=false, lastTrusted=true, lastSource="user";
  ed.addEventListener("paste",function(e){ e.preventDefault();
    var t=(e.clipboardData||window.clipboardData).getData("text");
    pasteNext=t; lastTrusted=e.isTrusted===true; document.execCommand("insertText",false,t); });

  /* hrvatski navodnici */
  ed.addEventListener("beforeinput",function(e){
    if (e.inputType!=="insertText" || e.data!=='"') return;
    e.preventDefault();
    var sel=window.getSelection(), before="";
    if (sel && sel.anchorNode && sel.anchorNode.nodeType===3) before=sel.anchorNode.nodeValue.slice(0,sel.anchorOffset).slice(-1);
    document.execCommand("insertText",false, (before===""||/[\s(\[]/.test(before)) ? "„" : "”");
  });

  ed.addEventListener("input",function(e){
    lastSource = uiAction ? "ui" : ((e&&e.isTrusted===true)?"user":"script");
    lastTrusted = !!(e&&e.isTrusted===true);
    var now=extractText(ed),a=prev,b=now;
    var p=0; while (p<a.length&&p<b.length&&a[p]===b[p]) p++;
    var s=0; while (s<a.length-p&&s<b.length-p&&a[a.length-1-s]===b[b.length-1-s]) s++;
    var del=a.slice(p,a.length-s),ins=b.slice(p,b.length-s);
    prev=now;
    if (del.length){ flush(); push("delete",{pos:p,length:del.length,input_source:lastSource}); }
    if (ins.length){
      if (pasteNext!==null && ins.indexOf(pasteNext.slice(0,10))===0){
        flush(); var c=classify(ins,"paste",null);
        push("insert",{pos:p,text:ins,modality:"paste",input_source:lastSource,
                       browser_event_trusted:lastTrusted,originKind:c.kind,originRef:c.ref,
                       confidence:c.kind==="pasted_unknown"?"unresolved":"exact_match"});
        toast(c.kind==="pasted_unknown"?"Zalijepljeno — podrijetlo nije utvrđeno":"Zalijepljeno, podrijetlo prepoznato");
        pasteNext=null;
      } else { pasteNext=null; bufferTyped(p,ins); } }
    refresh();
  });
  ed.addEventListener("blur",flush);

  document.addEventListener("keydown",function(e){
    var m=e.ctrlKey||e.metaKey;
    if (m && e.key==="f"){ e.preventDefault(); openFind(); }
    else if (m && e.key==="."){ e.preventDefault(); $("tgFocus").click(); }
    else if (m && e.key==="\\"){ e.preventDefault(); $("tgL").click(); }
    else if (m && (e.key==="1"||e.key==="2"||e.key==="3")){ e.preventDefault();
      doCmd(e.key==="1"?"h2":e.key==="2"?"h3":"p"); }
    else if (e.key==="Escape"){ closeFind(); }
  });

  /* Blokovni element (figure) NIKAD se ne umeće unutar odlomka: preglednik bi
     razdvojio blok i promjena bi postala nekontinuirana — a prefix/suffix diff
     ne može opisati dvije odvojene izmjene odjednom. Umeće se IZA odlomka u
     kojem je kursor, čime promjena ostaje jedan neprekinut raspon. */
  function insertBlockAfterCaret(node){
    ed.focus(); var sel=window.getSelection(), host=null;
    if (sel&&sel.rangeCount&&ed.contains(sel.anchorNode)){
      var n=sel.anchorNode;
      while (n&&n.parentNode!==ed) n=n.parentNode;
      host=n;
    }
    if (host&&host.parentNode===ed) ed.insertBefore(node,host.nextSibling);
    else ed.appendChild(node);
  }
  function insertNodeAtCaret(node){
    ed.focus(); var sel=window.getSelection();
    if (sel&&sel.rangeCount&&ed.contains(sel.anchorNode)){
      var r=sel.getRangeAt(0); r.collapse(false); r.insertNode(node);
      r.setStartAfter(node); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    } else ed.appendChild(node);
  }

  /* ---- izvedeno ---- */
  function refresh(){
    var h1=0,h2=0;
    Array.prototype.forEach.call(ed.children,function(el){
      if (el.tagName==="H2"){ h1++; h2=0; setNo(el,h1+". "); }
      else if (el.tagName==="H3"){ h2++; setNo(el,h1+"."+h2+". "); } });
    var tn=0,gn=0;
    Array.prototype.forEach.call(ed.querySelectorAll("figure"),function(f){
      var g=f.dataset.kind==="grafikon", n=g?(++gn):(++tn);
      f.dataset.n=String(n);
      var no=f.querySelector(".figno"); if (no) no.textContent=(g?"Grafikon ":"Tablica ")+n+". "; });
    Array.prototype.forEach.call(ed.querySelectorAll(".xref"),function(x){
      var t=ed.querySelector('figure[data-fig="'+x.dataset.ref+'"]');
      x.textContent=!t?"prikaz ?":(t.dataset.kind==="grafikon"?"grafikonu ":"tablici ")+t.dataset.n; });
    var cites=Array.prototype.slice.call(ed.querySelectorAll(".cite"));
    cites.forEach(function(c){ c.textContent=citeInText(c.dataset.src,c.dataset.page||""); });
    var used=[]; cites.forEach(function(c){ if (used.indexOf(c.dataset.src)===-1) used.push(c.dataset.src); });
    used.sort(function(a,b){ return sortKey(a).localeCompare(sortKey(b),"hr"); });
    var bl=$("biblist"); bl.innerHTML="";
    used.forEach(function(id){ var d=document.createElement("div"); d.innerHTML=bibEntry(id); bl.appendChild(d); });
    var kn=used.filter(function(i){ return SRC[i].type==="book"; }).length;
    $("bibauto").textContent=used.length? "Generirano iz "+used.length+" citiranih jedinica ("+kn+" knjiga) · "
      +(citeStyle==="fpzg"?"kućni stil FPZG-a, abecedno pa kronološki":citeStyle.toUpperCase())+" · ažurira se samo"
      : "Umetni citat iz kartice Literatura — popis se gradi sam.";
    reconcile();
    renderOutline(); renderLists(); renderUpute(); renderStatus();
    if (!$("view-mentor")) {}
  }
  function setNo(el,txt){ var no=el.querySelector(".hno");
    if (!no){ no=document.createElement("span"); no.className="hno"; no.dataset.noprov="1"; no.contentEditable="false";
      el.insertBefore(no,el.firstChild); } no.textContent=txt; }
  function words(t){ return (String(t||"").trim().match(/\S+/g)||[]).length; }
  function cleanH(el){ return el.textContent.replace(/^[\d.]+\s*/,"").trim(); }
  function chapters(){ var out=[],cur=null;
    Array.prototype.forEach.call(ed.children,function(el){
      if (el.tagName==="H2"||el.tagName==="H3"){ cur={title:cleanH(el),level:el.tagName,words:0,el:el}; out.push(cur); }
      else if (cur) cur.words+=words(el.textContent); });
    return out; }

  function renderOutline(){
    var box=$("outline"); box.innerHTML=""; var tot=0;
    chapters().forEach(function(o){ tot+=o.words;
      var b=document.createElement("button"); b.className="oitem"+(o.level==="H3"?" sub":"");
      var t=document.createElement("span"); t.className="t"; t.textContent=o.title;
      var m=document.createElement("span"); m.className="m";
      var bd=BUDGET[o.title], mini=document.createElement("span"); mini.className="mini";
      var f=document.createElement("i"), ratio=bd?o.words/bd:0;
      f.style.width=(Math.min(ratio,1)*100)+"%"; if (ratio>1.05) f.className="over"; mini.appendChild(f);
      var n=document.createElement("span"); n.textContent=bd?o.words+"/"+bd:String(o.words);
      m.appendChild(mini); m.appendChild(n); b.appendChild(t); b.appendChild(m);
      b.onclick=function(){ o.el.scrollIntoView({behavior:"smooth",block:"center"}); };
      box.appendChild(b); });
    $("tot-words").textContent=tot.toLocaleString("hr-HR");
  }
  function renderLists(){
    [["tablica",$("tablist")],["grafikon",$("graflist")]].forEach(function(c){
      var box=c[1]; box.innerHTML="";
      var figs=Array.prototype.slice.call(ed.querySelectorAll('figure[data-kind="'+c[0]+'"]'));
      if (!figs.length){ var e=document.createElement("div"); e.className="empt"; e.textContent="Nema jedinica."; box.appendChild(e); return; }
      figs.forEach(function(f){
        var b=document.createElement("button"); b.className="lrow";
        var n=document.createElement("span"); n.className="n"; n.textContent=f.dataset.n+".";
        var t=document.createElement("span");
        var cap=f.querySelector("figcaption");
        t.textContent=(cap?cap.textContent.replace(/^(Tablica|Grafikon)\s+\d+\.\s*/,""):"").slice(0,32)||"bez naslova";
        b.appendChild(n); b.appendChild(t);
        if (!ed.querySelector('.xref[data-ref="'+f.dataset.fig+'"]')){
          var w=document.createElement("span"); w.className="warn"; w.textContent="!"; w.title="nije spomenut u tekstu"; b.appendChild(w); }
        b.onclick=function(){ f.scrollIntoView({behavior:"smooth",block:"center"}); };
        box.appendChild(b); }); });
    var fr=$("fnrail"); fr.innerHTML="";
    if (!footnotes.length){ var e2=document.createElement("div"); e2.className="empt"; e2.textContent="Nema fusnota."; fr.appendChild(e2); }
    else footnotes.forEach(function(f,i){ var b=document.createElement("button"); b.className="lrow";
      var n=document.createElement("span"); n.className="n"; n.textContent=(i+1)+".";
      var s=document.createElement("span"); s.textContent=f.text.slice(0,30);
      b.appendChild(n); b.appendChild(s); fr.appendChild(b); });
  }

  function renderUpute(){
    var box=$("p-up"); box.innerHTML="";
    var tijelo=chapters().reduce(function(a,o){ return a+o.words; },0);
    var cites=Array.prototype.slice.call(ed.querySelectorAll(".cite"));
    var used=[]; cites.forEach(function(c){ if (used.indexOf(c.dataset.src)===-1) used.push(c.dataset.src); });
    var kn=used.filter(function(i){ return SRC[i].type==="book"; }).length;
    var figs=Array.prototype.slice.call(ed.querySelectorAll("figure"));
    var nepoz=figs.filter(function(f){ return !ed.querySelector('.xref[data-ref="'+f.dataset.fig+'"]'); });
    var fnCit=footnotes.filter(function(f){ return /\([^)]*,\s*(1[89]|20)\d{2}/.test(f.text); });
    var verzal=Array.prototype.slice.call(ed.querySelectorAll("h2,h3")).filter(function(h){ var t=cleanH(h); return t.length>3&&t===t.toUpperCase(); });
    var kratki=Array.prototype.slice.call(ed.querySelectorAll("p")).filter(function(p){
      var t=p.textContent.trim(); if (words(t)<25) return false; return (t.match(/[.!?](\s|$)/g)||[]).length<3; });
    var checks=[
      {st:tijelo>=OPSEG_MIN&&tijelo<=OPSEG_MAX?"ok":"warnc",name:"Opseg tijela rada",
       why:tijelo.toLocaleString("hr-HR")+" / "+OPSEG_MIN.toLocaleString("hr-HR")+"–"+OPSEG_MAX.toLocaleString("hr-HR")+" riječi · od Uvoda do Literature"},
      {st:used.length>=MIN_IZVORA?"ok":"warnc",name:"Najmanje "+MIN_IZVORA+" izvora",why:used.length+" citiranih jedinica"},
      {st:kn>=MIN_KNJIGA?"ok":"badc",name:"Najmanje "+MIN_KNJIGA+" knjige",why:kn+" knjiga među citiranima"},
      {st:nepoz.length===0?"ok":"badc",name:"Svaki prikaz spomenut u tekstu",
       why:nepoz.length?nepoz.length+" prikaz(a) bez poziva":"svi prikazi imaju poziv malim slovom"},
      {st:fnCit.length===0?"ok":"badc",name:"Fusnote samo objasnidbene",
       why:fnCit.length?fnCit.length+" fusnota citira — citiranje ide u tekst":footnotes.length?footnotes.length+" fusnota, nijedna ne citira":"nema fusnota"},
      {st:verzal.length===0?"ok":"badc",name:"Naslovi rečenično, ne verzalom",
       why:verzal.length?verzal.length+" naslov(a) verzalom":"oblik „1. Uvod”, ne „1. UVOD”"},
      {st:kratki.length===0?"ok":"warnc",name:"Odlomak najmanje 3 rečenice",
       why:kratki.length?kratki.length+" odlomak(a) ispod tri rečenice":"svi odlomci zadovoljavaju"}
    ];
    checks.forEach(function(c){
      var d=document.createElement("div"); d.className="chk";
      var dot=document.createElement("i"); dot.className="dotc "+c.st;
      var b=document.createElement("div");
      var n=document.createElement("div"); n.textContent=c.name;
      var w=document.createElement("div"); w.className="why"; w.textContent=c.why;
      b.appendChild(n); b.appendChild(w); d.appendChild(dot); d.appendChild(b); box.appendChild(d); });
    var f=document.createElement("div"); f.className="note";
    f.textContent="Pravila iz Uputa FPZG-a, dopunjena obranjenim radom gdje su Upute nepotpune. "
      +"Format (TNR 12, prored 1,5, obostrano, margine 2,54 cm) postavlja se pri izvozu — ne diraš ga.";
    box.appendChild(f);
    window.__badChecks=checks.filter(function(c){ return c.st!=="ok"; }).length;
  }

  /* ---- naredbe ---- */
  function doCmd(cmd){
    ed.focus();
    var before=extractText(ed);
    var C={ undo:function(){document.execCommand("undo");}, redo:function(){document.execCommand("redo");},
      p:function(){document.execCommand("formatBlock",false,"p");}, h2:function(){document.execCommand("formatBlock",false,"h2");},
      h3:function(){document.execCommand("formatBlock",false,"h3");}, bold:function(){document.execCommand("bold");},
      italic:function(){document.execCommand("italic");}, ul:function(){document.execCommand("insertUnorderedList");},
      quote:function(){document.execCommand("formatBlock",false,"blockquote");},
      tablica:function(){ insertPrikaz("tablica"); }, grafikon:function(){ insertPrikaz("grafikon"); },
      xref:insertXref, footnote:addFootnote, comment:addComment };
    if (!C[cmd]) return;
    /* Naredbe koje SAME knjiže svoje događaje ne smiju proći i kroz generički
       put — inače se isti sadržaj upiše dvaput i zapisnik naraste iznad dokumenta.
       Invarijanta je upravo tako uhvatila ovaj kvar. */
    var SELF={tablica:1,grafikon:1,xref:1,footnote:1,comment:1};
    uiAction=true;
    C[cmd]();
    if (!SELF[cmd]){
      var after=extractText(ed);
      if (after===before) push("format",{command:cmd,input_source:"ui"});
      else { prev=before; ed.dispatchEvent(new Event("input")); }
    }
    uiAction=false;
    refresh();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".tools button.t"),function(b){
    b.addEventListener("mousedown",function(e){ e.preventDefault(); });
    b.addEventListener("click",function(){ doCmd(b.dataset.cmd); }); });
  $("style").addEventListener("change",function(){ citeStyle=this.value;
    push("format",{command:"cite_style",style:citeStyle}); refresh();
    toast(citeStyle==="fpzg"?"Kućni stil FPZG-a — (Prezime, godina: str), bez točke iza godine"
                            :citeStyle.toUpperCase()+" — citati i literatura preračunati"); });

  function insertPrikaz(kind){
    var naslov=window.prompt((kind==="tablica"?"Naslov tablice":"Naslov grafikona")+" (natpis ide IZNAD):",
      kind==="tablica"?"Izdane dozvole za boravak i rad, 2020.–2026.":"Kretanje broja izdanih dozvola po godinama");
    if (naslov===null) return;
    var izvor=window.prompt("Izvor (puna rečenica, ISPOD prikaza):","Izvor: izradio autor prema podacima Državnog zavoda za statistiku.");
    if (izvor===null) izvor="Izvor: izradio autor.";
    var id=kind[0].toUpperCase()+Date.now().toString(36);
    var fig=document.createElement("figure"); fig.dataset.fig=id; fig.dataset.kind=kind;
    var cap=document.createElement("figcaption");
    var no=document.createElement("span"); no.className="figno"; no.dataset.noprov="1"; no.contentEditable="false"; no.textContent=" . ";
    cap.appendChild(no); cap.appendChild(document.createTextNode(naslov));
    fig.appendChild(cap);
    if (kind==="tablica"){
      var tb=document.createElement("table");
      var hd=document.createElement("tr");
      ["Godina","Dozvole","Promjena"].forEach(function(h){ var th=document.createElement("th"); th.textContent=h; hd.appendChild(th); });
      tb.appendChild(hd);
      [["2024","172.499","+18 %"],["2025","201.310","+17 %"],["2026","—","—"]].forEach(function(r){
        var tr=document.createElement("tr");
        r.forEach(function(v){ var td=document.createElement("td"); td.textContent=v; tr.appendChild(td); });
        tb.appendChild(tr); });
      fig.appendChild(tb);
    } else {
      var bx=document.createElement("div"); bx.className="figbox"; bx.contentEditable="false"; bx.textContent="[ grafikon ]";
      fig.appendChild(bx);
    }
    var sr=document.createElement("div"); sr.className="figsrc"; sr.textContent=izvor; fig.appendChild(sr);
    flush();
    var bT=extractText(ed); insertBlockAfterCaret(fig); var aT=extractText(ed);
    var p=0; while (p<bT.length&&p<aT.length&&bT[p]===aT[p]) p++;
    /* Predložak prikaza nije tipkan — sustav ga je generirao. Poštenije je to
       priznati nego napuhivati postotak „tipkano". */
    push("insert",{pos:p,text:aT.slice(p,aT.length-(bT.length-p)),modality:"template_insert",
                   input_source:"ui",browser_event_trusted:false,
                   originKind:"template",originRef:{template:kind},confidence:"observed"});
    push("prikaz_insert",{id:id,kind:kind});
    prev=aT;
    toast((kind==="tablica"?"Tablica":"Grafikon")+" dodan — natpis iznad, izvor ispod, numeracija automatska");
  }
  function insertXref(){
    var figs=Array.prototype.slice.call(ed.querySelectorAll("figure"));
    if (!figs.length){ toast("Prvo dodaj tablicu ili grafikon."); return; }
    var t=figs[figs.length-1];
    var x=document.createElement("span"); x.className="xref"; x.dataset.ref=t.dataset.fig;
    x.dataset.noprov="1"; x.contentEditable="false";
    x.textContent=(t.dataset.kind==="grafikon"?"grafikonu ":"tablici ")+t.dataset.n;
    insertNodeAtCaret(x); push("xref_insert",{target:t.dataset.fig}); prev=extractText(ed);
    toast("Poziv umetnut malim slovom — prati prikaz i kad se numeracija promijeni"); }
  function addFootnote(){
    var text=window.prompt("Fusnota (FPZG: samo objasnidbena — citati idu u tekst):");
    if (!text) return;
    /* Sve što završi u predanom dokumentu pripada istom provenance modelu —
       i tekst fusnote, ne samo njezino postojanje. */
    var fc=classify(text,"keyboard",null);
    footnotes.push({text:text,kind:fc.kind,conf:fc.kind==="ai_matched"?"heuristic_match":"declared"});
    var sup=document.createElement("sup"); sup.className="fn"; sup.dataset.noprov="1"; sup.contentEditable="false";
    sup.textContent=String(footnotes.length);
    insertNodeAtCaret(sup); push("footnote_insert",{n:footnotes.length,chars:text.length}); prev=extractText(ed);
    $("fnwrap").hidden=false; var ol=$("fnlist"); ol.innerHTML="";
    footnotes.forEach(function(f){ var li=document.createElement("li"); li.textContent=f.text; ol.appendChild(li); });
    if (/\([^)]*,\s*(1[89]|20)\d{2}/.test(text)) toast("Upozorenje: fusnota sadrži citat — FPZG traži citiranje u tekstu"); }
  function insertCitation(id,page){
    var c=document.createElement("span"); c.className="cite"; c.dataset.src=id;
    c.dataset.noprov="1"; c.contentEditable="false"; if (page) c.dataset.page=page;
    c.textContent="( )"; insertNodeAtCaret(c);
    push("cite_insert",{source_id:id,page:page||null}); prev=extractText(ed);
    refresh(); renderNB(); toast("Citat vezan uz "+id+" — literatura ažurirana"); }
  function insertAtEnd(text,mod,ref){
    flush(); var c=classify(text,mod,ref); var pos=extractText(ed).length;
    var p=document.createElement("p"); p.textContent=text; ed.appendChild(p); prev=extractText(ed);
    push("insert",{pos:pos,text:text+"\n",modality:mod,input_source:"ui",
                   browser_event_trusted:false,originKind:c.kind,originRef:c.ref,
                   confidence:mod==="ai_insert"?"cryptographically_bound":"observed"});
    refresh(); }

  /* ---- komentari ---- */
  function addComment(){
    var sel=window.getSelection();
    if (!sel||sel.isCollapsed||!ed.contains(sel.anchorNode)){ toast("Označi dio teksta pa klikni Komentar."); return; }
    var txt=window.prompt("Komentar mentora:"); if (!txt) return;
    cid++; var id="C"+cid;
    var span=document.createElement("span"); span.className="cmt"; span.dataset.cid=id;
    try { sel.getRangeAt(0).surroundContents(span); }
    catch(err){ toast("Označi tekst unutar jednog odlomka."); return; }
    comments.push({id:id,text:txt,quote:span.textContent.slice(0,90),resolved:false});
    span.onclick=function(){ focusComment(id); };
    push("comment_add",{id:id,chars:txt.length});
    prev=extractText(ed);
    renderComments(); toast("Komentar dodan — ne mijenja provenijenciju teksta");
  }
  function focusComment(id){
    Array.prototype.forEach.call(ed.querySelectorAll(".cmt"),function(s){ s.classList.toggle("on",s.dataset.cid===id); });
    ["t-ai","t-nb","t-up","t-cm"].forEach(function(t,i){ $(t).setAttribute("aria-selected",String(t==="t-cm"));
      $(["p-ai","p-nb","p-up","p-cm"][i]).hidden = ["p-ai","p-nb","p-up","p-cm"][i]!=="p-cm"; });
    renderComments(id);
  }
  function renderComments(active){
    var box=$("p-cm"); box.innerHTML="";
    if (!comments.length){ var e=document.createElement("div"); e.className="note";
      e.textContent="Nema komentara. Označi dio teksta i klikni Komentar u alatnoj traci — "
        +"mentor ovdje ostavlja povratnu informaciju vezanu uz točan dio rada."; box.appendChild(e); return; }
    comments.forEach(function(c){
      var d=document.createElement("div"); d.className="card";
      if (active===c.id) d.style.borderColor="var(--cmt)";
      var q=document.createElement("div"); q.className="q"; q.style.borderLeft="2px solid var(--cmt)";
      q.style.paddingLeft="7px"; q.textContent="„"+c.quote+"”";
      var t=document.createElement("div"); t.style.fontSize="12.5px"; t.textContent=c.text;
      var r=document.createElement("div"); r.className="row";
      var b=document.createElement("button"); b.className="btn ghost sm"; b.textContent=c.resolved?"riješeno":"označi riješenim";
      b.onclick=function(){ c.resolved=!c.resolved; push("comment_resolve",{id:c.id}); renderComments(); };
      var g=document.createElement("button"); g.className="btn ghost sm"; g.textContent="pokaži";
      g.onclick=function(){ var s=ed.querySelector('.cmt[data-cid="'+c.id+'"]'); if (s) s.scrollIntoView({behavior:"smooth",block:"center"}); focusComment(c.id); };
      r.appendChild(g); r.appendChild(b);
      if (c.resolved) d.style.opacity=".55";
      d.appendChild(q); d.appendChild(t); d.appendChild(r); box.appendChild(d); });
  }

  /* ---- traži / zamijeni ---- */
  function openFind(){ $("findbar").hidden=false; $("findq").focus(); $("findq").select(); }
  function closeFind(){ $("findbar").hidden=true; }
  $("tgFind").onclick=openFind; $("findclose").onclick=closeFind;
  function findNext(){
    var q=$("findq").value; if (!q) return null;
    var w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT), n, sel=window.getSelection();
    var startNode=sel&&sel.rangeCount&&ed.contains(sel.anchorNode)?sel.focusNode:null;
    var startOff=startNode?sel.focusOffset:0, passed=!startNode, first=null;
    while ((n=w.nextNode())){
      var from=(n===startNode)?startOff:0;
      var i=n.nodeValue.toLowerCase().indexOf(q.toLowerCase(), passed?0:from);
      if (n===startNode) passed=true;
      if (i>=0 && (passed||n===startNode)){
        var r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+q.length);
        sel.removeAllRanges(); sel.addRange(r);
        n.parentNode.scrollIntoView({block:"center",behavior:"smooth"});
        return r; }
      if (!first && i>=0) first=n;
    }
    toast("Nema više pojava."); return null;
  }
  $("findnext").onclick=findNext;
  $("repone").onclick=function(){ var r=window.getSelection();
    if (!r.rangeCount||r.isCollapsed) { if(!findNext()) return; }
    ed.focus(); document.execCommand("insertText",false,$("repq").value); };
  $("repall").onclick=function(){ var n=0; while (findNext() && n<200){ ed.focus();
    document.execCommand("insertText",false,$("repq").value); n++; }
    toast(n?("Zamijenjeno "+n+"×"):"Nema pojava."); };

  /* ---- asistent ---- */
  var CANNED={
    explain:"Neoinstitucionalizam se od klasičnog institucionalizma razlikuje po tome što institucije ne promatra samo kao formalna pravila, nego i kao neformalne norme, rutine i kognitivne okvire koji oblikuju ponašanje aktera.",
    brainstorm:"Mogući pravci: usporedba Lindblomova inkrementalizma s Etzionijevim miješanim skeniranjem; primjena na konkretnu zakonsku izmjenu; pitanje razlučuje li inkrementalizam opseg od dubine promjene.",
    language:"Lindblom tvrdi da donositelji politika ne provode sveobuhvatnu analizu svih alternativa, nego uspoređuju ograničen broj opcija koje se od postojećeg stanja razlikuju u malim koracima.",
    translate:"Successive limited comparisons — sukcesivne ograničene usporedbe.",
    restructure:"Predlažem redoslijed: teorijski okvir, kritika okvira, metodološki okvir, analiza slučaja, ograničenja.",
    generate:"Inkrementalizam ostaje dominantan okvir za razumijevanje javnih politika jer prepoznaje ograničenja ljudske racionalnosti i institucionalne inercije, no teško objašnjava rijetke, ali značajne zaokrete."
  };
  var PLBL={explain:"objašnjenje",brainstorm:"brainstorming",language:"jezik",translate:"prijevod",restructure:"struktura",generate:"generiranje"};
  function assistantSelection(){
    var s=window.getSelection();
    if (!s||s.isCollapsed||!ed.contains(s.anchorNode)) return "";
    return s.toString().slice(0,6000);
  }
  $("ask").addEventListener("click",async function(){
    var q=$("prompt").value.trim(); if(!q) return;
    var p=$("purpose").value, id="AI"+(ledger.length+1), btn=$("ask"), oldLabel=btn.textContent;
    var selectedText=assistantSelection(), it=null;
    btn.disabled=true; btn.textContent="Šaljem…";
    push("ai_query",{interaction_id:id,purpose:p,execution_mode:"architect"});
    try {
      if (!window.PisacAI||typeof window.PisacAI.ask!=="function") throw Object.assign(new Error("AI Architect client nije učitan."),{code:"CLIENT_UNAVAILABLE"});
      var result=await window.PisacAI.ask({prompt:q,purpose:p,selectedText:selectedText});
      it={id:id,prompt:q,response:result.output,purpose:p,execution:result.execution||{status:"live"}};
      push("ai_result",{
        interaction_id:id,
        provider:it.execution.provider||null,
        model:it.execution.actualModel||null,
        workflow:it.execution.workflow?it.execution.workflow.id:null,
        prompt_version:it.execution.prompt?it.execution.prompt.version:null
      });
    } catch(error) {
      it={id:id,prompt:q,response:CANNED[p],purpose:p,execution:{
        status:"demo_fallback",
        code:error&&error.code?error.code:"AI_UNAVAILABLE"
      }};
      push("ai_fallback",{interaction_id:id,reason:it.execution.code});
      toast("Live AI nije dostupan — prikazan je jasno označen demo odgovor.");
    } finally {
      btn.disabled=false; btn.textContent=oldLabel;
    }
    ledger.push(it);
    $("prompt").value=""; renderAI(); renderStatus(); });
  function renderAI(){
    $("ai-count").textContent=ledger.length+" interakcija";
    var box=$("ai-list"); box.innerHTML="";
    ledger.slice().reverse().forEach(function(l){
      var d=document.createElement("div"); d.className="card";
      var tg=document.createElement("span"); tg.className="tag"; tg.textContent=PLBL[l.purpose];
      var q=document.createElement("div"); q.className="q"; q.textContent=l.prompt;
      var a=document.createElement("div"); a.className="a"; a.textContent=l.response;
      var meta=document.createElement("div"); meta.className="note";
      if (l.execution&&l.execution.status==="live"){
        meta.textContent="AI Architect · "+(l.execution.provider||"provider")+" / "+(l.execution.actualModel||l.execution.requestedModel||"model")
          +(l.execution.verificationStatus&&l.execution.verificationStatus!=="not-required"?" · verifikacija: "+l.execution.verificationStatus:"");
      } else if (l.execution&&l.execution.status==="demo_fallback"){
        meta.textContent="Demo odgovor · live AI nije dostupan ("+(l.execution.code||"AI_UNAVAILABLE")+")";
      } else {
        meta.textContent="Demo zapis iz prototipa";
      }
      var r=document.createElement("div"); r.className="row";
      var bi=document.createElement("button"); bi.className="btn sm"; bi.textContent="Umetni";
      bi.onclick=function(){ push("ai_accept",{interaction_id:l.id,accepted_chars:l.response.length});
        insertAtEnd(l.response,"ai_insert",{aiInteractionId:l.id}); toast("Umetnuto — zabilježeno kao AI doprinos"); };
      var bc=document.createElement("button"); bc.className="btn ghost sm"; bc.textContent="Kopiraj";
      bc.onclick=function(){ prints.push({h:fp(l.response),kind:"ai_response",srcId:l.id,carry:"ai_inserted"});
        if (navigator.clipboard) navigator.clipboard.writeText(l.response);
        toast("Kopirano — paste će nositi AI podrijetlo"); };
      r.appendChild(bi); r.appendChild(bc);
      d.appendChild(tg); d.appendChild(q); d.appendChild(a); d.appendChild(meta); d.appendChild(r); box.appendChild(d); }); }
  function renderNB(){
    var box=$("p-nb"); box.innerHTML="";
    var used={}; Array.prototype.forEach.call(ed.querySelectorAll(".cite"),function(c){ used[c.dataset.src]=(used[c.dataset.src]||0)+1; });
    SOURCES.forEach(function(n){
      var d=document.createElement("div"); d.className="card";
      var k=document.createElement("div"); k.className="kind";
      k.textContent=n.type==="book"?"knjiga":n.type==="article"?"članak":"institucijski autor";
      var s=document.createElement("div"); s.className="src"; s.innerHTML=bibEntry(n.id);
      var r=document.createElement("div"); r.className="row";
      var c=document.createElement("button"); c.className="btn sm"; c.textContent="Citiraj";
      c.onclick=function(){ var p=window.prompt("Stranica (prazno = cijelo djelo):",""); insertCitation(n.id,(p||"").trim()); };
      var b=document.createElement("button"); b.className="btn ghost sm"; b.textContent="Kopiraj navod";
      b.onclick=function(){ prints.push({h:fp(n.note),kind:"notebook",srcId:n.id,carry:"pasted_internal"});
        if (navigator.clipboard) navigator.clipboard.writeText(n.note);
        push("notebook_copy",{entry_id:n.id}); toast("Kopirano — paste će nositi poznato podrijetlo"); };
      r.appendChild(c); r.appendChild(b);
      d.appendChild(k); d.appendChild(s); d.appendChild(r);
      if (used[n.id]){ var u=document.createElement("div"); u.className="used"; u.textContent="citirano "+used[n.id]+"×"; d.appendChild(u); }
      box.appendChild(d); }); }

  /* ---- status ---- */
  function renderStatus(){
    var t=extractText(ed).trim(), w=t?t.split(/\s+/).length:0;
    if (!sessionStart) sessionStart=w;
    $("st-words").textContent=w.toLocaleString("hr-HR");
    $("st-pbar").style.width=Math.min(w/OPSEG_MAX,1)*100+"%";
    $("st-pages").textContent="≈ "+Math.max(1,Math.round(w/300))+" str.";
    var diff=w-sessionStart;
    $("st-session").textContent=(diff>=0?"+":"")+diff+" ove sesije";
    var tms=0,tch=0,tmax=0;
    events.forEach(function(e){ var g=e.type==="insert"&&e.payload.timing;
      if (g&&g.ms>120){ tms+=g.ms; tch+=g.n; if (g.max>tmax) tmax=g.max; } });
    $("st-rhythm-g").hidden = tms<400;
    if (tms>=400) $("st-rhythm").textContent = (tch/(tms/1000)).toFixed(1)+" zn/s · najduža stanka "
      + (tmax/1000).toFixed(1)+" s";
    $("st-save").textContent=pending?"zapisujem…":"zapisano";
    var comp=composition(reconstruct(null));
    var pb=$("st-prov"); pb.innerHTML="";
    comp.rows.forEach(function(r){ var i=document.createElement("i");
      i.style.width=r.pct+"%"; i.style.background="var("+KIND_VAR[r.kind]+")"; pb.appendChild(i); });
    $("st-prov-l").textContent="nepoznato "+comp.unknownPct.toFixed(1)+"%";
    var bad=window.__badChecks||0;
    var chip=$("st-chk"); chip.textContent=bad?bad+" za popraviti":"Upute u skladu";
    chip.className="chip"+(bad?" warn":"");
    var days=Math.max(0,Math.round((ROK-Date.now())/864e5));
    $("st-days").textContent=days+" dana do roka";
  }

  /* ---- prikazi (mentor) ---- */
  function legendInto(el){ el.innerHTML="";
    ["typed","pasted_internal","ai_inserted","ai_matched","template","pasted_unknown"].forEach(function(k){
      var s=document.createElement("span"); var sw=document.createElement("i"); sw.className="sw";
      sw.style.background="var("+KIND_VAR[k]+")"; s.appendChild(sw);
      s.appendChild(document.createTextNode(KIND_LABEL[k])); el.appendChild(s); }); }
  function compTable(comp,tb,stack){ tb.innerHTML="";
    comp.rows.forEach(function(r){ var tr=document.createElement("tr");
      var t1=document.createElement("td"); t1.className="k";
      var w=document.createElement("span"); var sw=document.createElement("i"); sw.className="sw";
      sw.style.background="var("+KIND_VAR[r.kind]+")"; w.appendChild(sw);
      w.appendChild(document.createTextNode(KIND_LABEL[r.kind])); t1.appendChild(w);
      var t2=document.createElement("td"); t2.className="v"; t2.textContent=r.pct.toFixed(1)+"%";
      tr.appendChild(t1); tr.appendChild(t2); tb.appendChild(tr); });
    if (stack){ stack.innerHTML="";
      comp.rows.forEach(function(r){ var i=document.createElement("i");
        i.style.width=r.pct+"%"; i.style.background="var("+KIND_VAR[r.kind]+")"; stack.appendChild(i); }); } }
  function renderProv(sp){ var el=$("prov"); if(!el) return; el.innerHTML="";
    sp.forEach(function(s){ var m=document.createElement("mark");
      m.className=KIND_CLASS[s.originKind]+(selSpan===s.id?" sel":"");
      m.textContent=s.text; m.title=KIND_LABEL[s.originKind];
      m.onclick=function(){ selSpan=s.id; renderMentor(); showLineage(s); }; el.appendChild(m); }); }
  function rhythmSVG(t){
    if (!t||!t.beats||t.beats.length<3) return null;
    var all=t.beats.map(function(b){ return b[0]; });
    /* uzorkuj na najviše 130 stupaca, uz zadržavanje najduže stanke u svakom koraku */
    var MAXB=130, g=all;
    if (all.length>MAXB){ g=[]; var k=all.length/MAXB;
      for (var i=0;i<MAXB;i++){ var a=Math.floor(i*k), b2=Math.floor((i+1)*k), m=0;
        for (var j=a;j<b2;j++) if (all[j]>m) m=all[j]; g.push(m); } }
    var mx=Math.max.apply(null,g.concat([250])), h=36, w=2;
    var W=g.length*w, s='<svg width="100%" height="'+h+'" viewBox="0 0 '+W+' '+h+'" preserveAspectRatio="none" role="img" aria-label="ritam unosa">';
    g.forEach(function(v,i){
      var bh=Math.max(1,Math.round((v/mx)*(h-3)));
      s+='<rect x="'+(i*w)+'" y="'+(h-bh)+'" width="1.2" height="'+bh+'" '
        +'fill="var('+(v>700?"--p-ai":"--p-typed")+')" opacity="'+(v>700?".9":".6")+'"/>';
    });
    return s+'</svg>';
  }
  function showLineage(s){ var box=$("lineage"); if(!box) return; box.innerHTML="";
    var steps=[]; if (s.replacedText) steps.push({k:"prethodna verzija",t:s.replacedText,c:"--ink-3"});
    steps.push({k:KIND_LABEL[s.originKind],t:s.text,c:KIND_VAR[s.originKind]});
    steps.forEach(function(st,i){ var w=document.createElement("div"); w.className="lin";
      var mk=document.createElement("div"); mk.className="mk"; mk.style.background="var("+st.c+")";
      var b=document.createElement("div");
      var k=document.createElement("div"); k.className="kind"; k.style.color="var("+st.c+")"; k.textContent=st.k;
      var t=document.createElement("div"); t.className="txt"; t.textContent=st.t.length>200?st.t.slice(0,200)+"…":st.t;
      b.appendChild(k); b.appendChild(t); w.appendChild(mk); w.appendChild(b); box.appendChild(w);
      if (i<steps.length-1){ var a=document.createElement("div"); a.style.cssText="color:var(--ink-3);font-size:11px;padding-left:6px"; a.textContent="↓ zamijenjeno"; box.appendChild(a); } });
    /* Četiri odvojene osi: što je opaženo, s čime je povezano, koliko dobro to
       znamo, i što o tome kaže politika. Spajanje činjenice i inferencije u jednu
       oznaku je upravo ono zbog čega su detektori izgubili kredibilitet. */
    var evx=null; for (var q=0;q<events.length;q++) if (events[q].seq===s.originEventId){ evx=events[q]; break; }
    var pay=evx&&evx.payload||{};
    var axes=document.createElement("div");
    axes.style.cssText="margin-top:9px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;color:var(--ink-3)";
    [["opaženo", pay.modality||"—"],
     ["povezano s", (s.originRef&&(s.originRef.aiInteractionId||s.originRef.source||s.originRef.template))||"ništa"],
     ["pouzdanost", CONF_LABEL[pay.confidence]||"—"],
     ["izvor unosa", pay.input_source||"—"]].forEach(function(r){
      var k=document.createElement("div"); k.textContent=r[0];
      var v=document.createElement("div"); v.style.color="var(--ink-2)"; v.textContent=r[1];
      axes.appendChild(k); axes.appendChild(v); });
    box.appendChild(axes);
    var ex=null;
    if (s.originRef&&s.originRef.aiInteractionId) ex=["Izvor: interakcija "+s.originRef.aiInteractionId+".","--ink-3"];
    else if (s.originRef&&s.originRef.source) ex=["Izvor: jedinica "+s.originRef.source+" iz literature.","--p-internal"];
    else if (s.originKind==="pasted_unknown") ex=["Zalijepljeno bez podudarnog otiska. Nepoznato podrijetlo NIJE prekršaj — može biti vlastiti raniji nacrt, bilješke ili tekst s drugog uređaja. Traži objašnjenje, ne sankciju.","--ink-3"];
    else if (s.originKind==="ai_matched") ex=["Podudara se s odgovorom asistenta iako nije umetnut klikom. Heuristika, ne dokazana veza — prikazuje se odvojeno od AI umetka upravo zato.","--p-ai"];
    if (ex){ var p=document.createElement("p"); p.style.cssText="margin:2px 0 0;font-size:11.5px;line-height:1.6;color:var("+ex[1]+")";
      p.textContent=ex[0]; box.appendChild(p); }
    /* ritam unosa za događaj koji je proizveo ovaj span */
    var ev=null; for (var i=0;i<events.length;i++) if (events[i].seq===s.originEventId){ ev=events[i]; break; }
    var tg=ev&&ev.payload?ev.payload.timing:null;
    var wrap=document.createElement("div"); wrap.style.cssText="margin-top:10px;padding-top:10px;border-top:1px solid var(--rule-2)";
    var lab=document.createElement("div"); lab.className="kind"; lab.style.color="var(--ink-3)";
    lab.textContent="Ritam unosa"; wrap.appendChild(lab);
    var svg=rhythmSVG(tg);
    if (svg){
      var d=document.createElement("div"); d.style.margin="6px 0 4px"; d.innerHTML=svg; wrap.appendChild(d);
      var m=document.createElement("div"); m.style.cssText="font-size:11px;color:var(--ink-3);line-height:1.6";
      m.textContent=(tg.ms/1000).toFixed(1)+" s · "+(tg.cps||"—")+" zn/s · medijan razmaka "+tg.med
        +" ms · najduža stanka "+(tg.max/1000).toFixed(1)+" s";
      wrap.appendChild(m);
      var n=document.createElement("div"); n.style.cssText="font-size:11px;color:var(--ink-3);margin-top:5px;line-height:1.6";
      n.textContent="Viši stupac je duža stanka prije tog dijela teksta. Ritam je dokaz o unosu, ne o autorstvu — "
        +"skripta koja tipka umjesto čovjeka proizvodi uvjerljiv ritam.";
      wrap.appendChild(n);
    } else {
      var e2=document.createElement("div"); e2.style.cssText="font-size:11px;color:var(--ink-3);margin-top:6px;line-height:1.6";
      e2.textContent = (ev&&ev.payload&&ev.payload.modality!=="keyboard")
        ? "Tekst je stigao odjednom — nema ritma unosa jer nije tipkan."
        : "Nema zabilježenog ritma za ovaj dio (uvezen ili sjeme demoa). Napiši nešto pa klikni novi span.";
      wrap.appendChild(e2);
    }
    box.appendChild(wrap);
  }
  function renderLog(){ var el=$("log"); if(!el) return; el.innerHTML="";
    events.slice().reverse().slice(0,80).forEach(function(ev){
      var kind="k-other",desc=ev.type;
      if (ev.type==="insert"){ var m=ev.payload.modality;
        kind=m==="paste"?(ev.payload.originKind==="pasted_unknown"?"k-paste":"k-int"):m==="ai_insert"?"k-ai":"k-typed";
        desc=(m==="paste"?"paste ":m==="ai_insert"?"ai ":"insert ")+ev.payload.text.length+" zn.";
        var tg=ev.payload.timing;
        if (tg&&tg.ms>120) desc+=" · "+(tg.ms/1000).toFixed(1)+" s"+(tg.cps?" · "+tg.cps+" zn/s":"");
        else if (m==="paste") desc+=" · odjednom"; }
      else if (ev.type==="delete") desc="delete "+ev.payload.length+" zn.";
      else if (ev.type==="format") desc=ev.payload.command+" · bez utjecaja";
      else if (ev.type==="cite_insert"){ kind="k-int"; desc=ev.payload.source_id+(ev.payload.page?": "+ev.payload.page:""); }
      else if (ev.type==="prikaz_insert") desc=ev.payload.kind;
      else if (ev.type==="xref_insert") desc="→ "+ev.payload.target;
      else if (ev.type==="footnote_insert") desc="fusnota "+ev.payload.n;
      else if (ev.type==="comment_add") desc="komentar "+ev.payload.id;
      else if (ev.type==="comment_resolve") desc="riješen "+ev.payload.id;
      else if (ev.type==="ai_query"){ kind="k-ai"; desc=ev.payload.purpose+" · "+(ev.payload.execution_mode||"demo"); }
      else if (ev.type==="ai_result"){ kind="k-ai"; desc=(ev.payload.provider||"provider")+" / "+(ev.payload.model||"model"); }
      else if (ev.type==="ai_fallback"){ kind="k-ai"; desc="demo fallback · "+(ev.payload.reason||"nedostupno"); }
      else if (ev.type==="ai_accept"){ kind="k-ai"; desc=ev.payload.accepted_chars+" zn."; }
      else if (ev.type==="notebook_copy"){ kind="k-int"; desc=ev.payload.entry_id; }
      else if (ev.type==="reconciliation"){ kind="k-paste"; desc="usklađeno na "+ev.payload.at+" (+"+ev.payload.added+"/−"+ev.payload.removed+")"; }
      else if (ev.type==="milestone") desc=ev.payload.label;
      var d=document.createElement("div");
      d.innerHTML='<span class="seq">'+ev.seq+'</span><span class="'+kind+'">'+ev.type+'</span><span>'+desc
        +'</span><span class="hash">'+(ev.hash?ev.hash.slice(0,7):"…")+'</span>';
      el.appendChild(d); });
    var c=$("chain"); if (!c) return;
    c.textContent="provjeravam lanac…"; c.style.color="var(--ink-3)";
    verifyChain().then(function(r){
      c.textContent = r.ok ? "lanac ponovno izračunat i potvrđen · "+events.length
                           : "LANAC PUKAO na "+r.at+" — "+r.why;
      c.style.color = r.ok ? "var(--p-typed)" : "var(--breach)"; }); }
  function renderPolicy(comp){ var el=$("policy"); if(!el) return; el.innerHTML="";
    var used={}; ledger.forEach(function(l){ used[l.purpose]=(used[l.purpose]||0)+1; });
    var bad=POLICY.disallowed_ai_purposes.filter(function(p){ return used[p]; });
    var ms=events.some(function(e){ return e.type==="milestone"; });
    [{ok:comp.unknownPct<=POLICY.max_unknown_provenance_pct,hard:true,name:"Nepoznata provenijencija ≤ 15 %",why:"izmjereno "+comp.unknownPct.toFixed(1)+" %"},
     {ok:comp.aiPct<=POLICY.max_ai_inserted_pct,hard:false,name:"AI doprinos ≤ 10 %",why:"izmjereno "+comp.aiPct.toFixed(1)+" % (praćeni kanal)"},
     {ok:bad.length===0,hard:true,name:"Generiranje teksta nije dopušteno",why:bad.length?"zabilježeno "+used.generate+"×":"nema takvih interakcija"},
     {ok:ms,hard:false,name:"Međupredaja „nacrt”",why:ms?"zabilježena":"još nije"}
    ].forEach(function(r){ var row=document.createElement("div"); row.className="prule";
      var st=r.ok?"pass":(r.hard?"breach":"flag");
      var p=document.createElement("span"); p.className="pill "+st;
      p.textContent=st==="pass"?"u skladu":st==="flag"?"za pregled":"prekoračeno";
      var b=document.createElement("div");
      var n=document.createElement("div"); n.textContent=r.name;
      var w=document.createElement("div"); w.className="why"; w.textContent=r.why;
      b.appendChild(n); b.appendChild(w); row.appendChild(p); row.appendChild(b); el.appendChild(row); });
    var f=document.createElement("div"); f.className="scope";
    f.textContent="Izlaz je izjava o sukladnosti s politikom, ne ocjena studenta.";
    el.appendChild(f); }

  var mentorBuilt=false;
  function buildMentor(){
    if (mentorBuilt) return; mentorBuilt=true;
    var v=document.createElement("div"); v.className="tv"; v.id="view-mentor"; v.hidden=true;
    v.innerHTML=
     '<div style="display:flex;flex-direction:column;gap:16px">'
    +'<div class="tvpanel"><div class="tvhd"><h2>Podrijetlo teksta</h2><span class="sp" id="tv-when"></span></div>'
    +'<div class="headline"><div class="n" id="unk-n">—</div><div class="t"><b>nepoznato podrijetlo</b>udio teksta za koji sustav nema zapis nastanka. Pitanje za razgovor, ne nalaz o prekršaju.</div></div>'
    +'<div class="stackbar" id="stack"></div><table class="comp"><tbody id="comp-rows"></tbody></table>'
    +'<div class="scope" id="citeline"></div><div class="scope" id="scope"></div></div>'
    +'<div class="tvpanel"><div class="tvhd"><h2>Rukopis s provenijencijom</h2><span class="sp">klikni span za genealogiju</span></div>'
    +'<div class="legend" id="tv-legend"></div><div class="prov" id="prov"></div>'
    +'<div class="replay"><button class="btn ghost sm" id="play">▶ Reprodukcija</button>'
    +'<select id="speed" style="font:inherit;font-size:11.5px;background:var(--ground);color:var(--ink);'
    +'border:1px solid var(--rule);border-radius:6px;padding:2px 5px" aria-label="Brzina">'
    +'<option value="1">stvarni ritam</option><option value="20" selected>20×</option>'
    +'<option value="100">100×</option></select>'
    +'<input type="range" id="scrub" min="0" max="0" value="0" aria-label="Reprodukcija"><span class="pos" id="pos">—</span></div></div></div>'
    +'<div style="display:flex;flex-direction:column;gap:16px">'
    +'<div class="tvpanel"><div class="tvhd"><h2>Politika fakulteta</h2></div><div id="policy"></div></div>'
    +'<div class="tvpanel"><div class="tvhd"><h2>Genealogija</h2></div><div class="lineage" id="lineage">'
    +'<p style="margin:0;font-size:12.5px;color:var(--ink-3)">Klikni obojeni dio rukopisa.</p></div></div>'
    +'<div class="tvpanel"><div class="tvhd"><h2>Zapisnik događaja</h2><span class="sp" id="chain"></span></div>'
    +'<div class="log" id="log"></div><div class="hint">Događaji <b>format</b>, <b>cite</b>, <b>prikaz</b> i <b>comment</b> '
    +'mijenjaju izgled ili strukturu, ne provenijenciju proze. Hash se ovdje računa u pregledniku; u sustavu ga računa server.</div></div></div>';
    $("canvas").appendChild(v);
    $("scrub").addEventListener("input",function(){ scrubAt=Number(this.value)>=seq?null:Number(this.value); renderMentor(); });
    /* Reprodukcija po STVARNIM razmacima iz zapisnika, ne po fiksnom taktu.
       Stanke se skraćuju faktorom brzine i ograničavaju da se ne čeka satima. */
    $("play").addEventListener("click",function(){ var b=this;
      if (playTimer){ clearTimeout(playTimer); playTimer=null; b.textContent="▶ Reprodukcija"; return; }
      b.textContent="❚❚ Pauza"; scrubAt=0; renderMentor();
      var step=function(){
        scrubAt=(scrubAt===null?0:scrubAt)+1;
        if (scrubAt>=seq){ scrubAt=null; playTimer=null; b.textContent="▶ Reprodukcija";
          $("scrub").value=String(seq); renderMentor(); return; }
        $("scrub").value=String(scrubAt); renderMentor();
        var sp=Number($("speed").value)||20;
        var a=events[scrubAt-1], c=events[scrubAt], gap=260;
        if (a&&c) gap=Math.abs(new Date(c.serverTs)-new Date(a.serverTs))||260;
        playTimer=setTimeout(step, Math.min(Math.max(gap/sp,35),1400));
      };
      playTimer=setTimeout(step,120); });
    legendInto($("tv-legend"));
  }
  function renderMentor(){
    buildMentor();
    var sp=reconstruct(scrubAt),comp=composition(sp);
    $("unk-n").textContent=comp.unknownPct.toFixed(1)+"%";
    compTable(comp,$("comp-rows"),$("stack"));
    renderProv(sp); renderPolicy(composition(reconstruct(null)));
    var nC=ed.querySelectorAll(".cite").length, us=[];
    Array.prototype.forEach.call(ed.querySelectorAll(".cite"),function(c){ if (us.indexOf(c.dataset.src)===-1) us.push(c.dataset.src); });
    $("citeline").innerHTML="Citati vezani uz jedinicu literature: <b style='color:var(--p-internal)'>"+nC+" / "+nC+"</b> iz "+us.length+" izvora — bez heuristike.";
    $("scrub").max=String(seq); if (scrubAt===null) $("scrub").value=String(seq);
    $("pos").textContent=(scrubAt===null?seq:scrubAt)+" / "+seq;
    $("tv-when").textContent=events.length+" događaja · "+comp.total.toLocaleString("hr-HR")+" znakova";
    $("scope").textContent="Izvještaj opisuje podrijetlo teksta unutar praćene okoline. Ne otkriva alate izvan nje, "
      +"ne utvrđuje podrijetlo ideja i ne razlikuje autora od osobe koja prepisuje tuđi tekst. "
      +"Nije samostalan temelj disciplinskog postupka.";
    renderLog();
  }

  /* ---- chrome ---- */
  function toast(m){ var t=document.createElement("div"); t.className="toast"; t.textContent=m;
    document.body.appendChild(t); setTimeout(function(){ t.remove(); },2900); }
  $("tgL").onclick=function(){
    if (window.matchMedia("(max-width:1240px)").matches){
      var op=document.body.classList.toggle("railL-open"); this.setAttribute("aria-pressed",String(op)); return; }
    var on=$("railL").hidden; $("railL").hidden=!on; this.setAttribute("aria-pressed",String(on)); };
  $("tgFocus").onclick=function(){ var on=document.body.classList.toggle("focus");
    this.setAttribute("aria-pressed",String(on)); };
  ["t-ai","t-nb","t-up","t-cm"].forEach(function(id,i){
    $(id).addEventListener("click",function(){
      ["t-ai","t-nb","t-up","t-cm"].forEach(function(x,j){ $(x).setAttribute("aria-selected",String(j===i));
        $(["p-ai","p-nb","p-up","p-cm"][j]).hidden=j!==i; });
      if (i===1) renderNB(); if (i===2) renderUpute(); if (i===3) renderComments(); }); });
  $("m-student").onclick=function(){ $("m-student").setAttribute("aria-selected","true");
    $("m-mentor").setAttribute("aria-selected","false");
    $("scroll").hidden=false; $("railR").hidden=false; document.querySelector(".tools").hidden=false;
    if ($("view-mentor")) $("view-mentor").hidden=true; };
  $("m-mentor").onclick=function(){ flush(); $("m-mentor").setAttribute("aria-selected","true");
    $("m-student").setAttribute("aria-selected","false");
    buildMentor(); $("scroll").hidden=true; $("railR").hidden=true; document.querySelector(".tools").hidden=true;
    $("view-mentor").hidden=false; renderMentor(); };

  /* ---- seed ---- */
  function seed(){
    ledger.push({id:"AI1",prompt:"Preformuliraj ovu rečenicu da bude jasnija.",response:CANNED.language,purpose:"language"});
    var U1="Teorija inkrementalizma objašnjava donošenje javnih politika kao proces sukcesivnih, ograničenih usporedbi u kojem donositelji odluka ne polaze od sveobuhvatne analize svih mogućih alternativa. Umjesto toga uspoređuju tek nekoliko opcija koje se od postojećeg stanja razlikuju u malim koracima. Takav je opis odlučivanja izravno suprotstavljen racionalno-sveobuhvatnom modelu, koji pretpostavlja da donositelj politike može unaprijed odrediti sve ciljeve, sredstva i posljedice.";
    var U2="Cilj ovog rada jest ispitati u kojoj mjeri taj okvir objašnjava donošenje izmjena Zakona o strancima koje je Hrvatski sabor izglasao 2026. godine. Istraživačko pitanje glasi: predstavlja li ta zakonska izmjena inkrementalnu prilagodbu postojećeg okvira ili značajniji zaokret u hrvatskoj migracijskoj politici? Rad polazi od pretpostavke da opseg izmjena sam po sebi nije dostatan pokazatelj njihove dubine.";
    var T1="Lindblom opisuje odlučivanje kao niz sukcesivnih ograničenih usporedbi, pri čemu se politika prilagođava postupno, uz stalnu povratnu informaciju iz prakse.";
    var DR="Lindblom smatra da je takav pristup bolji jer je jednostavniji.";
    var AI=CANNED.language;
    var Q=" Prednost takvog pristupa, prema autoru, jest u tome što smanjuje rizik od pogrešaka velikih razmjera.";
    var BAD=" Institucionalizam je pristup koji naglašava ulogu institucija u oblikovanju političkih ishoda, pri čemu institucije djeluju kao stabilizirajući čimbenik političkog sustava i smanjuju neizvjesnost u interakciji aktera.";
    var T2="Kritičari inkrementalizma upozoravaju da model zanemaruje mogućnost fundamentalnih odluka koje ne proizlaze iz postupne prilagodbe nego iz vanjskog šoka ili promjene vrijednosnog okvira. Model miješanog skeniranja predlaže kombinaciju širih strateških odluka i inkrementalnih prilagodbi. Time se otvara pitanje je li svaka zakonska izmjena doista inkrementalna samo zato što ne mijenja cijeli pravni sustav odjednom.";
    var ME="Rad se oslanja na analizu sadržaja zakonskog teksta, usporedbu s verzijom iz 2020. godine te na sažeta izvješća s rasprave u Saboru. Analiza obuhvaća sve članke izmijenjene 2026. godine, razvrstane prema tome mijenjaju li postupak, rokove ili kategorije statusa. Ograničenje pristupa jest oslanjanje na javno dostupne materijale, budući da interni radni materijali Vlade nisu objavljeni.";
    var A1="Izmjene Zakona o strancima nadovezuju se na postojeći okvir iz 2020. godine, bez uvođenja posve novih kategorija boravišnog statusa. Većina odredbi odnosi se na pojednostavljenje postupka izdavanja dozvola za rad državljanima trećih zemalja i na produljenje rokova valjanosti pojedinih dozvola. Takav obrazac odgovara opisu inkrementalne prilagodbe.";
    var CAP="Izdane dozvole za boravak i rad, 2020.–2026.";
    var SL="Izvor: izradio autor prema podacima Državnog zavoda za statistiku.";
    var A2="Ipak, opseg izmjena zahvaća gotovo trećinu članaka postojećeg zakona, što otvara pitanje predstavlja li kvantitativna opsežnost ujedno i kvalitativni zaokret. Inkrementalistički okvir tu razliku teško razlučuje, jer mjeri udaljenost od postojećeg stanja, a ne dubinu promjene.";
    var ZA="Donošenje izmjena Zakona o strancima uglavnom odgovara modelu sukcesivnih ograničenih usporedbi. Zakonodavac se oslanjao na postojeći pravni okvir i uvodio prilagodbe motivirane konkretnim administrativnim problemima, a ne cjelovitom redefinicijom migracijske politike. Ipak, opseg izmjena upućuje na to da granica između inkrementalne prilagodbe i strateškog zaokreta u praksi nije uvijek jasna.";

    var pos=0;
    /* Sjeme demoa dobiva vjerodostojan ritam: tečno tipkanje, zastoji na kraju
       rečenice, povremena duža stanka za razmišljanje. Paste i AI umetak ga
       nemaju — tekst je stigao odjednom, i to se u genealogiji i vidi. */
    var rnd=(function(s){ return function(){ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; }; })(7);
    function timingFor(t){
      var beats=[],i=0,n=t.length;
      while (i<n && beats.length<300){
        var chunk=1+(rnd()>0.82?1:0); if (i+chunk>n) chunk=n-i;
        var r=rnd(), g;
        if (r>0.975) g=900+Math.floor(rnd()*2800);
        else if (r>0.90) g=380+Math.floor(rnd()*420);
        else g=110+Math.floor(rnd()*230);
        beats.push([beats.length?Math.round(g/10)*10:0,chunk]);
        i+=chunk;
      }
      var gaps=beats.map(function(x){return x[0];}).slice(1).sort(function(a,c){return a-c;});
      var tot=beats.reduce(function(a,x){return a+x[0];},0);
      return { ms:tot, n:n, cps: tot>120?+(n/(tot/1000)).toFixed(1):null,
        med: gaps.length?gaps[Math.floor(gaps.length/2)]:0,
        max: gaps.length?gaps[gaps.length-1]:0, beats:beats };
    }
    function ins(t,m,k,r,mi){
      var pl={pos:pos,text:t,modality:m,input_source:"seed",browser_event_trusted:false,
              originKind:k,originRef:r||null,
              confidence:k==="ai_matched"?"heuristic_match":k==="pasted_unknown"?"unresolved":"observed"};
      if (m==="keyboard") pl.timing=timingFor(t);
      push("insert",pl,mi); pos+=t.length; }
    ins("Uvod\n","keyboard","typed",null,720);
    ins(U1+" \n","keyboard","typed",null,714);
    ins(U2+"\n","keyboard","typed",null,700);
    ins("Teorijski okvir\n","keyboard","typed",null,600);
    ins(T1,"keyboard","typed",null,594);
    ins(DR,"keyboard","typed",null,560);
    push("delete",{pos:pos-DR.length,length:DR.length},520); pos-=DR.length;
    ins(" "+AI,"ai_insert","ai_inserted",{aiInteractionId:"AI1"},518);
    push("ai_accept",{interaction_id:"AI1",accepted_chars:AI.length},518);
    prints.push({h:fp(Q.trim()),kind:"notebook",srcId:"S1",carry:"pasted_internal"});
    ins(Q,"paste","pasted_internal",{source:"S1"},480);
    ins(BAD+" \n","paste","pasted_unknown",null,440);
    ins(T2+"  \n","keyboard","typed",null,400);
    ins("Metodološki okvir\n","keyboard","typed",null,330);
    ins(ME+"\n","keyboard","typed",null,325);
    ins("Analiza slučaja\n","keyboard","typed",null,240);
    ins(A1+" \n","keyboard","typed",null,236);
    ins(CAP+"\n","keyboard","typed",null,200);
    ins("Godina\tDozvole\tPromjena\t\n2024\t172.499\t+18 %\t\n2025\t201.310\t+17 %\t\n2026\t—\t—\t\n","keyboard","typed",null,199);
    ins(SL+"\n","keyboard","typed",null,198);
    push("prikaz_insert",{id:"T1",kind:"tablica"},198);
    ins(A2+"\n","keyboard","typed",null,150);
    ins("Zaključak\n","keyboard","typed",null,60);
    ins(ZA+"\n","keyboard","typed",null,55);
    push("milestone",{label:"nacrt"},40);

    ed.innerHTML="";
    function el(tag,txt){ var e=document.createElement(tag); e.textContent=txt; ed.appendChild(e); return e; }
    el("h2","Uvod"); var pU=el("p",U1+" "); el("p",U2);
    el("h2","Teorijski okvir");
    var pT=el("p",T1+" "+AI+Q+BAD+" "); var pT2=el("p",T2+"  ");
    el("h2","Metodološki okvir"); el("p",ME);
    el("h2","Analiza slučaja"); var pA=el("p",A1+" ");
    var fig=document.createElement("figure"); fig.dataset.fig="T1"; fig.dataset.kind="tablica";
    var cap=document.createElement("figcaption");
    var no=document.createElement("span"); no.className="figno"; no.dataset.noprov="1"; no.contentEditable="false"; no.textContent=" . ";
    cap.appendChild(no); cap.appendChild(document.createTextNode(CAP)); fig.appendChild(cap);
    var tb=document.createElement("table");
    var hd=document.createElement("tr");
    ["Godina","Dozvole","Promjena"].forEach(function(h){ var th=document.createElement("th"); th.textContent=h; hd.appendChild(th); });
    tb.appendChild(hd);
    [["2024","172.499","+18 %"],["2025","201.310","+17 %"],["2026","—","—"]].forEach(function(r){
      var tr=document.createElement("tr"); r.forEach(function(v){ var td=document.createElement("td"); td.textContent=v; tr.appendChild(td); }); tb.appendChild(tr); });
    fig.appendChild(tb);
    var sl=document.createElement("div"); sl.className="figsrc"; sl.textContent=SL; fig.appendChild(sl);
    ed.appendChild(fig);
    el("p",A2); el("h2","Zaključak"); el("p",ZA);

    /* Razmak ispred citata dio je autorove proze i već je u zapisniku (vidi ins()).
       Čip je izveden element (noprov) i NE ulazi u tok znakova. */
    function cite(par,id,page,mi){ var c=document.createElement("span"); c.className="cite"; c.dataset.src=id;
      c.dataset.noprov="1"; c.contentEditable="false"; if (page) c.dataset.page=page;
      par.appendChild(c);
      push("cite_insert",{source_id:id,page:page||null},mi); }
    cite(pU,"S1","82",710); cite(pT,"S1","81",590);
    cite(pT2,"S3","386",398); cite(pT2,"S4",null,396); cite(pA,"S7","165",230);

    prev=extractText(ed);
  }

  seed(); refresh(); renderAI(); renderNB(); renderComments();
})();
