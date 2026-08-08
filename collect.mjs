/**
 * مرصد — مجمّع الأخبار
 * يعمل على خوادم GitHub Actions، لا في متصفحك.
 * لذلك لا وسطاء ولا CORS ولا حجب — يتصل بالمصادر مباشرة.
 *
 * المخرجات:
 *   docs/data/latest.json    آخر لقطة (تقرؤها الصفحة)
 *   docs/data/archive.json   أرشيف الأحداث المتراكم عبر الأيام
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';

const SRC = [
  {id:'aljazeera',n:'الجزيرة',c:'JZR',t:'#C98A3C',
   u:'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9'},
  {id:'skynews',n:'سكاي نيوز',c:'SKY',t:'#4E8FC4',
   u:'https://www.skynewsarabia.com/web/rss/home.xml'},
  {id:'bbc',n:'بي بي سي',c:'BBC',t:'#D2544F',
   u:'https://feeds.bbci.co.uk/arabic/rss.xml'},
  {id:'albayan',n:'البيان',c:'BYN',t:'#5FA37E',
   u:'https://news.google.com/rss/search?q=site:albayan.ae+when:12h&hl=ar&gl=AE&ceid=AE:ar'},
  {id:'emaratalyoum',n:'الإمارات اليوم',c:'EMY',t:'#C4A94E',
   u:'https://news.google.com/rss/search?q=site:emaratalyoum.com+when:12h&hl=ar&gl=AE&ceid=AE:ar'},
  {id:'reuters',n:'رويترز',c:'RTR',t:'#E8562A',
   u:'https://news.google.com/rss/search?q=site:reuters.com+when:6h&hl=ar&gl=AE&ceid=AE:ar'},
  {id:'guardian',n:'الغارديان',c:'GRD',t:'#6E8BC4',
   u:'https://www.theguardian.com/world/rss'},
  {id:'axios',n:'أكسيوس',c:'AXS',t:'#8A6FC4',
   u:'https://api.axios.com/feed/'}
];

/* ═══════════ التطبيع والتجميع ═══════════ */
const norm = s => (s||'')
  .replace(/[\u064B-\u0652\u0670\u0640]/g,'')
  .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
  .replace(/ؤ/g,'و').replace(/ئ/g,'ي')
  .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g,' ').toLowerCase();

const STOP = new Set(('من في على الى عن مع هذا هذه ذلك التي الذي كان كانت قال قالت بعد قبل بين '+
 'خلال حول ضد نحو منذ حتى اذا لكن ايضا كما بشان بسبب عبر او ثم لم لن ما هو هي هم '+
 'the a an of to in on for with by from at as is are was were said says has have had and or '+
 'but new news after over into more than its it his her their they this that will not you '+
 'about up out we us can may amid').split(/\s+/));

const toks = s => [...new Set(norm(s).split(/\s+/).filter(w=>w.length>=3 && !STOP.has(w)))];

function cluster(list){
  const N=list.length||1, df=new Map();
  // نفصل كلمات العنوان عن المتن: العنوان جوهر الخبر فيُوزن أثقل
  const T=list.map(x=>{
    const tt=toks(x.title), ss=toks((x.snip||'').slice(0,240));
    const all=[...new Set([...tt,...ss])];
    all.forEach(w=>df.set(w,(df.get(w)||0)+1));
    return {tt:new Set(tt), all};
  });
  const idf=w=>Math.log((N+1)/((df.get(w)||0)+0.5))+0.3;
  const W=T.map(({tt,all})=>{
    const m=new Map();
    all.forEach(w=>m.set(w, idf(w)*(tt.has(w)?2.2:1)));
    return {m, mass:[...m.values()].reduce((a,v)=>a+v,0)||1};
  });
  const nums=i=>new Set((norm(list[i].title+' '+(list[i].snip||'')).match(/\d{2,}/g)||[]));
  const NM=list.map((_,i)=>nums(i));

  /* مقياس الاحتواء: الكتلة المشتركة نسبةً إلى الأصغر.
     لا يعاقب اختلاف الطول، ولا يخنق الكلمات المشتركة كما يفعل الجيب الصرف. */
  const sim=(i,j)=>{
    const A=W[i],B=W[j]; let sh=0;
    const [S,L]=A.m.size<B.m.size?[A.m,B.m]:[B.m,A.m];
    for(const [w,v] of S){ const o=L.get(w); if(o) sh+=Math.min(v,o); }
    let s=sh/Math.min(A.mass,B.mass);
    const c=[...NM[i]].filter(x=>NM[j].has(x)).length;   // رقم مشترك = دليل قوي
    if(c) s+=Math.min(0.15,c*0.075);
    return s;
  };

  const p=list.map((_,i)=>i);
  const find=x=>p[x]===x?x:(p[x]=find(p[x]));
  for(let i=0;i<list.length;i++)
    for(let j=i+1;j<list.length;j++){
      if(list[i].src===list[j].src) continue;
      if(sim(i,j)>=0.25) p[find(i)]=find(j);
    }
  const g=new Map();
  list.forEach((_,i)=>{ const r=find(i); if(!g.has(r)) g.set(r,[]); g.get(r).push(i); });
  return [...g.values()].map(ix=>ix.map(i=>list[i]));
}

/* ═══════════ التصنيف ═══════════ */
const CATS = {
  security:{n:'أمني وعسكري',kw:'هجوم هجمات قصف غاره غارات اشتباك اشتباكات جبهه توغل عمليه عسكريه جيش قوات ميليشيا صاروخ صواريخ مسيره طيران حربي حدود توتر امني تفجير ارهاب انفجار مسلح مسلحين اغتيال اسير اسرى هدنه تصعيد قتال معارك قصفت استهدف attack strike airstrike military troops missile drone clash militant border raid offensive ceasefire shelling armed'},
  disaster:{n:'كارثة طبيعية',kw:'زلزال زلازل هزه هزات ارتداديه اعصار عواصف فيضان فيضانات سيول بركان ثوران تسونامي انهيار جفاف حريق حرايق غابات موجه حر انزلاق تربه كارثه طبيعيه مناخيه ريختر earthquake quake magnitude aftershock hurricane typhoon cyclone flood volcano eruption tsunami wildfire landslide drought heatwave storm'},
  politics:{n:'سياسي ودبلوماسي',kw:'انتخابات انتخاب تصويت برلمان حكومه وزير وزراء رييس استقاله تعديل وزاري مرسوم قانون تشريع اتفاقيه معاهده قمه دبلوماسي سفير سفاره مفاوضات حوار عقوبات مقاطعه حزب معارضه ايتلاف دستور استفتاء تحالف election vote parliament government minister president resign summit diplomatic treaty sanctions negotiation coalition referendum cabinet'},
  crime:{n:'جريمة وحادث',kw:'جريمه جرايم قتل جثه جثث سرقه سطو اختطاف خطف اختفاء مفقود تحقيق تحقيقات نيابه محكمه قضيه متهم متهمين توقيف اعتقال شرطه امن مداهمه مخدرات تهريب احتيال فساد رشوه محاكمه حادث سير تصادم انقلاب مركبه غرق crime murder theft robbery kidnap missing investigation court trial suspect arrest police raid trafficking fraud corruption crash'},
  economy:{n:'اقتصادي ومالي',kw:'اقتصاد اقتصادي سوق اسواق بورصه مؤشر مؤشرات سهم اسهم تداول استثمار استثمارات نفط يرتفع ارتفاع يتراجع تراجع مكاسب هبوط صعود خام برنت برميل غاز ذهب دولار يورو عمله عملات تضحم تضخم ركود فايده مصرف بنك مركزي ميزانيه عجز صادرات واردات تجاره رسوم جمركيه نمو صفقه استحواذ ارباح economy market stocks index trading investment oil inflation recession interest bank budget exports tariff gdp growth revenue'},
  health:{n:'صحي ووبائي',kw:'صحه صحي مرض امراض وباء جايحه فيروس فيروسات عدوى تفشي اصابات حالات لقاح تطعيم مستشفى مستشفيات علاج دواء ادويه منظمه الصحه حجر عزل تحذير صحي سلاله انفلونزا كوليرا health disease virus outbreak epidemic pandemic infection cases vaccine hospital treatment quarantine strain'},
  tech:{n:'تقني وسيبراني',kw:'تقنيه تكنولوجيا ذكاء اصطناعي روبوت خوارزميه برمجيات تطبيق منصه اطلاق اختراق قرصنه سيبراني امن معلومات بيانات تسريب فديه شريحه رقاقه معالج هاتف حاسوب انترنت قمر صناعي فضاء technology software app platform launch cyber hack breach ransomware data leak chip satellite startup algorithm'},
  sports:{n:'رياضي',kw:'مباراه مباريات بطوله دوري كاس نهايي منتخب فريق فرق لاعب لاعبين هدف اهداف فوز خساره يفوز فاز يتعادل هدفين هاتريك ركله جزاء حكم بطل وصيف موسم جوله ريال برشلونه مانشستر ليفربول تشيلسي بايرن الهلال النصر الاتحاد الاهلي match championship league cup final team player goal win draw transfer coach olympic tournament'},
  general:{n:'عام',kw:''}
};
const CATKW = Object.fromEntries(Object.entries(CATS)
  .map(([k,v])=>[k,new Set(v.kw.split(/\s+/).filter(w=>w.length>2))]));

function classify(mine){
  const sc={}; Object.keys(CATS).forEach(k=>sc[k]=0);
  mine.forEach(x=>{
    norm(x.title).split(/\s+/).forEach(w=>{ for(const k in CATKW) if(CATKW[k].has(w)) sc[k]+=3; });
    norm((x.snip||'').slice(0,260)).split(/\s+/).forEach(w=>{ for(const k in CATKW) if(CATKW[k].has(w)) sc[k]+=1; });
  });
  const rank=Object.entries(sc).filter(([k])=>k!=='general').sort((a,b)=>b[1]-a[1]);
  const [top,tv]=rank[0]||['general',0];
  if(tv<3) return {cat:'general',sub:null};
  const [sec,sv]=rank[1]||[null,0];
  return {cat:top, sub:(sv>=tv*0.5&&sv>=4)?sec:null};
}

const KW_HI=('قتل قتلى قتيل ضحايا وفيات انفجار زلزال اعصار فيضان حريق غاره قصف اشتباك حرب مجزره ارهاب اغتيال تفجير انهيار كارثه طوارئ اجلاء دمار جرحى مصابين نزوح killed dead deaths toll explosion earthquake strike bombing war attack disaster emergency wounded casualties crash').split(' ');
const KW_MD=('اتفاق عقوبات انتخابات استقاله مفاوضات قمه ازمه احتجاج اضراب تضخم ركود sanctions election talks summit crisis protest inflation recession deal resign ceasefire').split(' ');
function sev(t){
  const s=' '+norm(t)+' ';
  if(KW_HI.some(k=>s.includes(' '+k))) return 'high';
  if(KW_MD.some(k=>s.includes(' '+k))) return 'medium';
  return 'low';
}

/* ═══════════ الأماكن ═══════════ */
const GAZ={
 'غزه':['غزة',31.50,34.47],'فلسطين':['فلسطين',31.90,35.20],'اسراييل':['إسرائيل',31.77,35.21],
 'القدس':['القدس',31.77,35.21],'لبنان':['لبنان',33.89,35.50],'بيروت':['بيروت',33.89,35.50],
 'سوريا':['سوريا',33.51,36.29],'دمشق':['دمشق',33.51,36.29],'العراق':['العراق',33.31,44.36],
 'بغداد':['بغداد',33.31,44.36],'ايران':['إيران',35.69,51.39],'طهران':['طهران',35.69,51.39],
 'اليمن':['اليمن',15.35,44.20],'السودان':['السودان',15.50,32.55],'ليبيا':['ليبيا',32.88,13.19],
 'مصر':['مصر',30.04,31.24],'القاهره':['القاهرة',30.04,31.24],'الاردن':['الأردن',31.95,35.93],
 'السعوديه':['السعودية',24.71,46.68],'الرياض':['الرياض',24.71,46.68],'جده':['جدة',21.49,39.19],
 'الامارات':['الإمارات',24.45,54.38],'ابوظبي':['أبوظبي',24.45,54.38],'دبي':['دبي',25.20,55.27],
 'قطر':['قطر',25.29,51.53],'الكويت':['الكويت',29.38,47.99],'البحرين':['البحرين',26.23,50.59],
 'عمان':['عُمان',23.59,58.41],'تركيا':['تركيا',39.93,32.86],'اسطنبول':['إسطنبول',41.01,28.98],
 'روسيا':['روسيا',55.76,37.62],'موسكو':['موسكو',55.76,37.62],'اوكرانيا':['أوكرانيا',50.45,30.52],
 'كييف':['كييف',50.45,30.52],'الصين':['الصين',39.90,116.40],'امريكا':['الولايات المتحدة',38.91,-77.04],
 'واشنطن':['واشنطن',38.91,-77.04],'نيويورك':['نيويورك',40.71,-74.01],
 'بريطانيا':['بريطانيا',51.51,-0.13],'لندن':['لندن',51.51,-0.13],'فرنسا':['فرنسا',48.86,2.35],
 'باريس':['باريس',48.86,2.35],'المانيا':['ألمانيا',52.52,13.40],'برلين':['برلين',52.52,13.40],
 'ايطاليا':['إيطاليا',41.90,12.50],'اسبانيا':['إسبانيا',40.42,-3.70],'الهند':['الهند',28.61,77.21],
 'باكستان':['باكستان',33.68,73.05],'افغانستان':['أفغانستان',34.53,69.17],
 'اليابان':['اليابان',35.68,139.69],'كوريا':['كوريا',37.57,126.98],
 'فنزويلا':['فنزويلا',10.48,-66.90],'البرازيل':['البرازيل',-15.79,-47.88],
 'المكسيك':['المكسيك',19.43,-99.13],'كولومبيا':['كولومبيا',4.71,-74.07],
 'نيجيريا':['نيجيريا',9.06,7.49],'اثيوبيا':['إثيوبيا',9.03,38.74],'كينيا':['كينيا',-1.29,36.82],
 'المغرب':['المغرب',34.02,-6.84],'الجزاير':['الجزائر',36.75,3.06],'تونس':['تونس',36.81,10.18],
 'gaza':['غزة',31.50,34.47],'israel':['إسرائيل',31.77,35.21],'lebanon':['لبنان',33.89,35.50],
 'syria':['سوريا',33.51,36.29],'iraq':['العراق',33.31,44.36],'iran':['إيران',35.69,51.39],
 'yemen':['اليمن',15.35,44.20],'sudan':['السودان',15.50,32.55],'egypt':['مصر',30.04,31.24],
 'turkey':['تركيا',39.93,32.86],'russia':['روسيا',55.76,37.62],'ukraine':['أوكرانيا',50.45,30.52],
 'china':['الصين',39.90,116.40],'washington':['واشنطن',38.91,-77.04],'london':['لندن',51.51,-0.13],
 'france':['فرنسا',48.86,2.35],'germany':['ألمانيا',52.52,13.40],'india':['الهند',28.61,77.21],
 'japan':['اليابان',35.68,139.69],'brazil':['البرازيل',-15.79,-47.88],
 'venezuela':['فنزويلا',10.48,-66.90],'nigeria':['نيجيريا',9.06,7.49]
};
function locate(mine){
  const v=new Map();
  const add=(w,n)=>{ if(GAZ[w]) v.set(w,(v.get(w)||0)+n); };
  mine.forEach(x=>{
    norm(x.title).split(/\s+/).forEach(w=>add(w,3));
    norm((x.snip||'').slice(0,220)).split(/\s+/).forEach(w=>add(w,1));
  });
  let best=null,hi=0;
  for(const [w,n] of v) if(n>hi){hi=n;best=w;}
  if(!best) return null;
  const g=GAZ[best]; return {n:g[0],lat:g[1],lng:g[2]};
}

function casualties(t){
  t=String(t).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const g=re=>{let m,mx=0;const r=new RegExp(re,'gi');
    while(m=r.exec(t)){const n=parseInt(m[1].replace(/[,،]/g,''));if(n>mx&&n<1e7)mx=n;}return mx;};
  return {
    dead:g('(\\d[\\d,،]*)\\s*(?:قتيل|قتلى|شهيد|شهداء|ضحيه|ضحايا|وفاه|وفيات|dead|killed|deaths?)'),
    hurt:g('(\\d[\\d,،]*)\\s*(?:مصاب|جريح|جرحى|اصاب|إصاب|injured|wounded)'),
    miss:g('(\\d[\\d,،]*)\\s*(?:مفقود|missing)')
  };
}

/* ═══════════ السحب ═══════════ */
const parser = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@'});

async function pullFeed(s){
  const ctrl=AbortSignal.timeout(20000);
  const r=await fetch(s.u,{signal:ctrl,headers:{
    'User-Agent':'Mozilla/5.0 (compatible; MarsadBot/1.0; +https://github.com)',
    'Accept':'application/rss+xml, application/xml, text/xml, */*'
  }});
  if(!r.ok) throw new Error('HTTP '+r.status);
  const xml=await r.text();
  const j=parser.parse(xml);
  const raw = j?.rss?.channel?.item || j?.feed?.entry || [];
  const arr = Array.isArray(raw)?raw:[raw];

  return arr.slice(0,20).map(it=>{
    const txt=v=>typeof v==='string'?v:(v?.['#text']||v?.['@href']||'');
    let title=txt(it.title).replace(/<[^>]+>/g,'').replace(/\s+-\s+[^-]{2,28}$/,'').trim();
    const link=typeof it.link==='string'?it.link:(it.link?.['@href']||txt(it.link)||txt(it.guid));
    const desc=txt(it.description)||txt(it.summary)||txt(it.content);
    return {
      src:s.id, title, url:link,
      snip:desc.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,420),
      img:it.enclosure?.['@url']||it['media:content']?.['@url']||null,
      at:Date.parse(txt(it.pubDate)||txt(it.published)||txt(it.updated))||Date.now()
    };
  }).filter(x=>x.title&&x.url);
}

/* ═══════════ التشغيل ═══════════ */
async function main(){
  console.log('⟳ مرصد — بدء الدورة', new Date().toISOString());
  const status={}, all=[];

  const got=await Promise.allSettled(SRC.map(async s=>{
    try{
      const list=await pullFeed(s);
      status[s.id]={ok:true, n:list.length, at:Date.now()};
      console.log(`  ✓ ${s.c} ${list.length} عنصر`);
      return list;
    }catch(e){
      status[s.id]={ok:false, n:0, at:null, why:e.message.slice(0,60)};
      console.log(`  ✗ ${s.c} ${e.message.slice(0,50)}`);
      return [];
    }
  }));
  got.forEach(g=>{ if(g.status==='fulfilled') all.push(...g.value); });

  // دمج مع الأرشيف السابق
  await mkdir('docs/data',{recursive:true});
  let prev=[];
  try{ prev=JSON.parse(await readFile('docs/data/archive.json','utf8')).items||[]; }catch{}

  const MAXAGE=4*24*3600*1000;
  const items=[...new Map([...all,...prev].map(x=>[x.url,x])).values()]
    .filter(x=>Date.now()-x.at<MAXAGE)
    .sort((a,b)=>b.at-a.at).slice(0,600);

  console.log(`  سُحب ${all.length} · بعد الدمج ${items.length}`);

  // التجميع والبناء
  const events=cluster(items.slice(0,180)).map((mine,i)=>{
    mine.sort((a,b)=>b.at-a.at);
    const lead=mine.reduce((a,b)=>(b.snip||'').length>(a.snip||'').length?b:a);
    const loc=locate(mine), cls=classify(mine);
    const cas=casualties(mine.map(x=>x.title+' '+x.snip).join(' '));
    return {
      id:i+1, cat:cls.cat, sub:cls.sub,
      fp:norm(mine[mine.length-1].title).split(/\s+/).filter(w=>w.length>3).sort().slice(0,5).join('-')||'evt',
      severity:sev(mine.map(x=>x.title+' '+x.snip).join(' ')),
      place:loc?loc.n:SRC.find(s=>s.id===mine[0].src).n,
      lat:loc?loc.lat:null, lng:loc?loc.lng:null,
      title:mine[0].title,
      lede:(lead.snip||mine[0].title).slice(0,150),
      summary:lead.snip||mine[0].title,
      at:Math.max(...mine.map(x=>x.at)),
      linked:mine.length-1, cas,
      figs:mine.filter(x=>x.img).slice(0,3)
        .map(x=>({src:x.img,cap:SRC.find(s=>s.id===x.src).n})),
      updates:mine.slice(0,8).map(x=>({at:x.at,s:x.src,h:x.title})),
      sources:[...new Map(mine.map(x=>[x.src,x])).values()]
        .map(x=>({id:x.src,h:x.title,url:x.url,at:x.at}))
    };
  }).sort((a,b)=>(b.sources.length-a.sources.length)||(b.at-a.at));

  const payload={
    builtAt:Date.now(),
    builtISO:new Date().toISOString(),
    sources:SRC.map(s=>({...s,...status[s.id]})),
    counts:{items:items.length, events:events.length,
            high:events.filter(e=>e.severity==='high').length,
            live:Object.values(status).filter(s=>s.ok).length},
    events:events.slice(0,120)
  };

  await writeFile('docs/data/latest.json', JSON.stringify(payload), 'utf8');
  await writeFile('docs/data/archive.json', JSON.stringify({items}), 'utf8');

  console.log(`✓ ${events.length} حدث · ${payload.counts.live}/${SRC.length} مصادر حية`);
}

main().catch(e=>{ console.error('✗ فشل:', e); process.exit(1); });
