'use strict';
const $ = id => document.getElementById(id);
const KEY = 'speaker-archive-v1.0';
const seed = Array.isArray(window.SPEAKERS) ? window.SPEAKERS : [];
const grades = ['S','A','B','C'];
const gradeOf = review => review.grade;
const legacyGrades = {'5':'S','4':'A','3':'B','2':'C','1':'C'};
const categoryList = row => [...new Set((row.category || '').split(/[;,\n]/u).map(v=>v.trim()).filter(Boolean))];
function migrateReviews(rows) {
  return Array.isArray(rows) ? rows.map(row=> row && Array.isArray(row.reviews) ? {...row,reviews:row.reviews.map(review=>{
    if(!review || typeof review!=='object')return review;
    const {score,...record}=review;
    return {...record,grade:record.grade || legacyGrades[score]};
  })} : row) : rows;
}
const lectureDate = review => review.lectureDate ?? '';
const tabs = ['프로필', '강의 이력', '강의 평가'];
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s/g, '');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const sorted = rows => [...rows].sort((a,b) => a.name.localeCompare(b.name,'ko') || a.role.localeCompare(b.role,'ko'));
const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
function url(value) {
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; }
  catch { return ''; }
}
const photoURL = value => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value || '') && value.length <= 600000 ? value : url(value);
function link(value, label) {
  return url(value) ? '<a href="'+esc(url(value))+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>' : '';
}
function strings(row, keys) { return keys.every(key => typeof row[key] === 'string'); }
function valid(rows) {
  return Array.isArray(rows) && new Set(rows.map(r=>r?.id)).size === rows.length && rows.every(r =>
    r && strings(r,['id','name','role','category','year','photo','source']) && r.id && r.name.trim() &&
    ['topics','career'].every(k=>Array.isArray(r[k]) && r[k].every(x=>typeof x==='string')) &&
    Array.isArray(r.events) && Array.isArray(r.reviews) &&
    r.events.every(e=>e && strings(e,['id','date','title','place','host','source'])) &&
    r.reviews.every(e=>e && strings(e,['id','date','title','note']) && grades.includes(gradeOf(e)) && (e.lectureDate===undefined || typeof e.lectureDate==='string')));
}
let changed = [];
try { const local = migrateReviews(JSON.parse(localStorage.getItem(KEY))); if(valid(local)) changed = local; } catch {}
const all = () => sorted([...new Map([...seed,...changed].map(row=>[row.id,row])).values()]);
let selected = seed.find(r=>r.name==='김경일')?.id || all()[0]?.id;
let tab = 0, active = -1, matches = [], editor = null, toastTimer;
const search = $('search');
function toast(message) {
  $('status').textContent = message; $('status').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>$('status').hidden=true,3200);
}
function persist(rows) { localStorage.setItem(KEY,JSON.stringify(rows)); changed = rows; }
function save(row) { persist([...changed.filter(r=>r.id!==row.id),row]); }
function categories() {
  const current = $('category').value;
  const names = [...new Set(all().flatMap(categoryList))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('category').innerHTML = '<option value="">모든 분야</option>'+names.map(n=>'<option>'+esc(n)+'</option>').join('');
  if(names.includes(current)) $('category').value=current;
}
function filtered() {
  const category = $('category').value, terms = search.value.trim().split(/\s+/).map(normalize);
  return all().filter(x=>(!category || categoryList(x).includes(category)) && terms.every(term =>
    normalize([x.name,x.role,x.year,x.category,...x.topics,...x.career,...x.events.map(e=>e.title+' '+e.place+' '+e.host)].join(' ')).includes(term)));
}
function personText(x) { return '<strong>'+esc(x.name)+'</strong><small>'+esc([x.role,x.year && x.year+'년생'].filter(Boolean).join(' · ')||'소속 미입력')+'</small>'; }
function drawList() {
  const rows=filtered();
  $('count').textContent=rows.length+'명 / 전체 '+all().length+'명';
  $('list').innerHTML=rows.map(x=>'<button class="person" data-person="'+esc(x.id)+'" aria-current="'+(x.id===selected)+'"><span class="initial" aria-hidden="true">'+esc(x.name[0])+'</span><span>'+personText(x)+'</span></button>').join('') || '<p class="empty">조건에 맞는 강사가 없습니다.</p>';
}
function suggest(show) {
  matches = show && search.value.trim() ? filtered().slice(0,7) : [];
  $('suggest').hidden = !matches.length;
  search.setAttribute('aria-expanded',String(Boolean(matches.length)));
  $('suggest').innerHTML=matches.map((x,i)=>'<div class="suggestion" style="padding:8px;cursor:pointer" id="suggest-'+i+'" role="option" aria-selected="'+(i===active)+'" data-person="'+esc(x.id)+'">'+personText(x)+'</div>').join('');
  if(active>=0 && matches[active]) search.setAttribute('aria-activedescendant','suggest-'+active);
  else search.removeAttribute('aria-activedescendant');
}
function choose(id) {
  selected=id; tab=0; active=-1; suggest(false); drawList(); drawDetail();
  if(matchMedia('(max-width:650px)').matches) $('detail').scrollIntoView({block:'start'});
}
const empty = message => '<p class="empty">'+esc(message)+'</p>';
const box = (title,items) => '<section class="box"><h3>'+title+'</h3>'+(items.length?'<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':empty('등록된 정보가 없습니다.'))+'</section>';
const dateSort = (a,b) => (b.date || b.published || '').localeCompare(a.date || a.published || '');
function records(items, kind, preview=false) {
  if(!items.length) return empty(kind==='event'?'등록된 강의 이력이 없습니다.':'평가 이력 없음');
  return items.map(e=>'<div class="record"><div class="sectionhead"><strong>'+esc(e.title)+'</strong>'+
    (preview?'':'<button data-action="'+kind+'" data-id="'+esc(e.id)+'">수정</button>')+'</div><p>'+
    esc(kind==='event'?[e.date||'일자 미확인',e.place||'장소 미확인',e.host,e.status,e.published && '후기 게시 '+e.published].filter(Boolean).join(' · '):'평가일 '+(e.date||'미확인')+' · '+gradeOf(e)+'등급')+'</p>'+
    (kind==='event'?link(e.source,'강의 출처 ↗'):(e.note?'<p>'+esc(e.note)+'</p>':''))+'</div>').join('');
}
function evaluationGroups(reviews) {
  const groups = new Map();
  for(const review of reviews){
    const date=lectureDate(review);
    const key=JSON.stringify([normalize(review.title),date]);
    if(!groups.has(key))groups.set(key,{title:review.title,date,reviews:[]});
    groups.get(key).reviews.push(review);
  }
  return [...groups.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
function gradeCounts(reviews) {
  return grades.map(grade=>[grade,reviews.filter(r=>gradeOf(r)===grade).length])
    .filter(([,count])=>count).map(([grade,count])=>grade+' '+count+'건').join(' · ');
}
function evaluationSummary(events,reviews) {
  const latest=events.filter(e=>e.date && e.date<=todayKorea()).concat(
    reviews.filter(r=>lectureDate(r)).map(r=>({date:lectureDate(r),title:r.title}))).sort(dateSort)[0] || events.find(e=>!e.date);
  const recentReview=reviews.filter(r=>lectureDate(r)).sort((a,b)=>lectureDate(b).localeCompare(lectureDate(a)) || dateSort(a,b))[0] || reviews[0];
  const round=recentReview && reviews.filter(r=>normalize(r.title)===normalize(recentReview.title) && lectureDate(r)===lectureDate(recentReview));
  const rating=round?.length>1 ? gradeCounts(round) : recentReview ? gradeOf(recentReview)+'등급' : '평가 이력 없음';
  return '<div class="profile-rating"><span>강사 평가</span>'+
    '<button type="button" data-tab="2" class="rating-value">'+esc(rating)+'</button>'+
    (recentReview?'<small>최근 평가 강의 · '+esc(recentReview.title)+'</small>':'')+
    '<div class="recent-program"><small>최근 강의 · '+esc(latest?.date || '날짜 미확인')+'</small><small>'+esc(latest?.title || '등록된 강의 프로그램 없음')+'</small></div></div>';
}
const todayKorea = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
function drawDetail() {
  const x=all().find(r=>r.id===selected);
  if(!x) { $('detail').innerHTML=empty('강사를 선택하거나 새로 등록하세요.'); return; }
  const events=[...x.events].sort(dateSort), reviews=[...x.reviews].sort(dateSort);
  const overview='<div class="overview">'+box('주요 이력',x.career)+box('강의 주제',x.topics)+'</div><section><div class="sectionhead"><h3>최근 강의 이력</h3><button data-tab="1">전체 이력 보기</button></div><div style="margin-top:9px">'+records(events.slice(0,3),'event',true)+'</div></section>'+
    ('<div class="source">'+[link(x.source,'공개 프로필 출처 ↗'),link(x.yearSource,'출생연도 출처 ↗'),
      ...(Array.isArray(x.sources)?x.sources.map(s=>s&&link(s.url,s.label)):[])].filter(Boolean).join(' · ')+'</div>');
  const history='<div class="sectionhead"><h3>강의 이력 '+events.length+'건</h3><button data-action="event">＋ 이력 등록</button></div><div>'+records(events,'event')+'</div>';
  const groups=evaluationGroups(reviews);
  const evaluations='<div class="sectionhead"><h3>강의 평가 '+reviews.length+'건</h3><button data-action="review">＋ 평가 등록</button></div>'+
    (groups.length?groups.map(g=>'<section class="box review-group"><h3>'+esc(g.title)+' · '+esc(g.date||'강의 날짜 미확인')+'</h3><p class="rating-counts">'+esc(gradeCounts(g.reviews))+'</p>'+records(g.reviews,'review')+'</section>').join(''):empty('평가 이력 없음'));
  $('detail').innerHTML='<div class="profile"><div class="portrait"><span aria-hidden="true">'+esc(x.name[0])+'</span>'+
    (photoURL(x.photo)?'<img referrerpolicy="no-referrer" src="'+esc(photoURL(x.photo))+'" alt="'+esc(x.name)+' 사진">':'')+
    '</div><div class="profile-text">'+categoryList(x).map(field=>'<span class="tag">'+esc(field)+'</span>').join(' ')+'<h2>'+esc(x.name)+'</h2><p>'+esc(x.role)+'</p><p class="meta">'+esc(x.year?x.year+'년생':'출생연도 미확인')+'</p><button data-action="person">프로필 수정</button></div>'+evaluationSummary(events,reviews)+'</div>'+
    '<div class="tabs" role="tablist" aria-label="강사 정보">'+tabs.map((t,i)=>'<button id="tab-'+i+'" role="tab" aria-controls="panel" aria-selected="'+(tab===i)+'" data-tab="'+i+'">'+t+'</button>').join('')+'</div>'+
    '<div class="panel" id="panel" role="tabpanel" aria-labelledby="tab-'+tab+'">'+[overview,history,evaluations][tab]+'</div>';
  $('detail').querySelector('img')?.addEventListener('error',e=>e.currentTarget.remove());
}
search.addEventListener('input',()=>{active=-1;drawList();suggest(true);});
search.addEventListener('focus',()=>suggest(true));
search.addEventListener('keydown',e=>{
  if(e.isComposing) return;
  if(e.key==='Escape'){active=-1;suggest(false);return;}
  if(!['ArrowDown','ArrowUp','Enter'].includes(e.key)) return;
  if(!matches.length && e.key!=='Enter') suggest(true);
  if(e.key==='Enter' && matches[active]){e.preventDefault();choose(matches[active].id);return;}
  if(e.key==='Enter' || !matches.length) return;
  e.preventDefault();
  active=active<0?(e.key==='ArrowDown'?0:matches.length-1):(active+(e.key==='ArrowDown'?1:matches.length-1))%matches.length;
  suggest(true);
});
$('category').addEventListener('change',()=>{active=-1;suggest(false);drawList();});
document.addEventListener('click',e=>{
  const person=e.target.closest('[data-person]');
  if(person) choose(person.dataset.person);
  else if(!e.target.closest('.searchbox')) {active=-1;suggest(false);}
});
$('detail').addEventListener('click',e=>{
  const tabButton=e.target.closest('[data-tab]');
  if(tabButton){tab=Number(tabButton.dataset.tab);drawDetail();$('tab-'+tab)?.focus();}
  const action=e.target.closest('[data-action]');
  if(action) openForm(action.dataset.action,all().find(r=>r.id===selected),action.dataset.id);
});
const forms = {
  person:[['name','이름','text',1],['role','소속·직함','text',1],['year','출생연도','year'],['yearSource','출생연도 출처 URL','url'],['category','분야 (여러 분야는 쉼표로 구분)','text'],['photo','사진 URL','url'],['source','프로필 출처 URL','url'],['career','주요 이력 (한 줄에 한 건)','textarea'],['topics','강의 주제 (한 줄에 한 건)','textarea']],
  event:[['title','강의 주제','text',1],['date','강의 날짜','date'],['place','강의 장소','text'],['host','주최 기관','text'],['status','확인 상태','text'],['published','후기 게시일','date'],['source','출처 URL','url']],
  review:[['title','강의 주제','text',1],['lectureDate','강의 날짜','date',1],['date','평가 날짜','date',1],['grade','평가 등급','grade',1],['note','평가 의견','textarea']]
};
function field([name,label,type,required],data,events) {
  const value=Array.isArray(data[name])?data[name].join('\n'):(data[name]??'');
  const attr=' name="'+name+'" '+(required?'required':'');
  let control='<input'+attr+' type="'+(type==='year'?'text':type)+'" '+(type==='year'?'inputmode="numeric" pattern="[0-9]{4}"':'')+' value="'+esc(value)+'">';
  if(type==='textarea') control='<textarea'+attr+'>'+esc(value)+'</textarea>';
  if(type==='grade') control='<select'+attr+'><option value="">등급 선택</option>'+grades.map(g=>'<option '+(g===value?'selected':'')+'>'+g+'</option>').join('')+'</select>';
  if(events?.length && name==='title') control='<input'+attr+' list="event-titles" value="'+esc(value)+'"><datalist id="event-titles">'+events.map(e=>'<option value="'+esc(e.title)+'">').join('')+'</datalist>';
  return '<label>'+label+control+'</label>';
}
function openForm(kind,row,id,draft={}) {
  editor={kind,row,id,photo:photoURL((row||draft).photo)?.startsWith('data:')?(row||draft).photo:''};
  let data=kind==='person'?(row||draft):((kind==='event'?row.events:row.reviews).find(x=>x.id===id)||{});
  if(kind==='review')data={...data,date:data.date||todayKorea(),grade:gradeOf(data)||''};
  $('dialog-title').textContent=({person:'강사',event:'강의 이력',review:'강의 평가'})[kind]+(id || (row&&kind==='person')?' 수정':' 등록');
  $('fields').innerHTML=forms[kind].map(f=>field(f,data,kind==='review'?row.events:null)).join('');
  if(kind==='review' && row.events.some(e=>e.date)){
    const dated=row.events.filter(e=>e.date).sort(dateSort);
    $('fields').insertAdjacentHTML('afterbegin','<label>등록된 강의 선택<select id="review-event"><option value="">직접 입력</option>'+dated.map((e,i)=>'<option value="'+i+'">'+esc(e.date+' · '+e.title)+'</option>').join('')+'</select></label>');
    $('review-event').onchange=e=>{
      if(!e.target.value)return;
      const event=dated[Number(e.target.value)];
      $('editor').elements.title.value=event.title;
      $('editor').elements.lectureDate.value=event.date;
    };
  }
  if(kind==='person'){
    const photoInput=$('fields').querySelector('[name="photo"]');
    if(editor.photo) photoInput.value='';
    window.attachSpeakerPhotos?.($('fields'),editor,photoInput);
    if(draft.webCandidate){
      $('fields').insertAdjacentHTML('beforeend','<label class="photo-check"><input type="checkbox" required> 출처를 대조해 선택한 강사와 같은 인물임을 확인했습니다.</label>');
    }
  }
  $('form-error').textContent='';
  $('dialog').showModal();
}
$('add').onclick=()=>window.openSpeakerLookup();
$('close').onclick=$('cancel').onclick=()=>$('dialog').close();
$('editor').addEventListener('submit',e=>{
  e.preventDefault();
  const {kind,row,id}=editor;
  const data=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,v.trim()]));
  const err=message=>{$('form-error').textContent=message;};
  if(!data.title && kind!=='person') return err('강의 주제를 입력하세요.');
  if(Object.keys(data).filter(k=>['photo','source','yearSource'].includes(k)).some(k=>data[k]&&!url(data[k])))return err('웹 주소는 https:// 또는 http://로 입력하세요.');
  if(kind==='review' && (!grades.includes(data.grade) || !data.lectureDate || data.lectureDate>data.date))
    return err('평가 등급과 강의 날짜를 확인하세요. 평가 날짜는 강의 날짜 이후여야 합니다.');
  let next;
  if(kind==='person'){
    if(!data.name||!data.role) return err('이름과 소속·직함을 입력하세요.');
    if(data.year && (+data.year<1900 || +data.year>new Date().getFullYear())) return err('출생연도를 확인하세요.');
    const duplicate=all().find(x=>x.id!==row?.id && normalize(x.name)===normalize(data.name) && normalize(x.role)===normalize(data.role) && (!x.year || !data.year || x.year===data.year));
    if(duplicate)return err('같은 이름과 소속·직함의 강사가 있습니다. 기존 프로필을 확인하세요.');
    data.category=categoryList(data).join(', ');
    next={events:[],reviews:[],...row,...data,photo:data.photo||editor.photo,id:row?.id||uid()};
    for(const k of ['career','topics']) next[k]=data[k].split('\n').map(s=>s.trim()).filter(Boolean);
  } else {
    const key=kind==='event'?'events':'reviews';
    const entry={id:id||uid(),...data};
    next={...row,[key]:id?row[key].map(x=>x.id===id?entry:x):[...row[key],entry]};
  }
  try{save(next);}catch{return err('브라우저에 저장할 수 없습니다. 저장 공간과 권한을 확인하세요.');}
  $('dialog').close();
  selected=next.id;
  if(!row){search.value='';$('category').value='';tab=0;}
  categories();drawList();drawDetail();toast('저장했습니다.');
});
$('backup').onclick=()=>{
  const href=URL.createObjectURL(new Blob([JSON.stringify({version:1,changes:changed},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=href;a.download='speaker-archive-backup_'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date()).replace(' ','_').replaceAll(':','')+'_KST.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
};
$('restore').onclick=()=>$('upload').click();
$('upload').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    data.changes=migrateReviews(data.changes);
    if(data.version!==1||!valid(data.changes))throw Error('invalid');
    if(!confirm('백업에 포함된 강사의 수정 사항을 불러올까요? 동일한 강사 ID의 현재 기록은 백업 내용으로 교체됩니다.'))return;
    persist([...new Map([...changed,...data.changes].map(row=>[row.id,row])).values()]);
    categories();drawList();drawDetail();toast('백업을 불러왔습니다.');
  }catch{toast('백업을 불러올 수 없습니다. 파일 형식과 저장 공간을 확인하세요.');}
};
categories();drawList();drawDetail();
