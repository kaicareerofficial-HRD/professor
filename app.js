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
    ['topics','career','books'].every(k=>(k==='books' && r[k]===undefined) || (Array.isArray(r[k]) && r[k].every(x=>typeof x==='string'))) &&
    Array.isArray(r.events) && Array.isArray(r.reviews) &&
    r.events.every(e=>e && strings(e,['id','date','title','place','host','source'])) &&
    r.reviews.every(e=>e && strings(e,['id','date','title','note']) && grades.includes(gradeOf(e)) && (e.lectureDate===undefined || typeof e.lectureDate==='string')));
}
let changed = [];
try { const local = migrateReviews(JSON.parse(localStorage.getItem(KEY))); if(valid(local)) changed = local; } catch {}
const seedById = new Map(seed.map(row=>[row.id,row]));
const newsData=window.LECTURE_NEWS || {};
const publicNews=(Array.isArray(newsData.items)?newsData.items:[]).filter(entry=>
  entry && ['id','speaker','role','title','date','source'].every(key=>typeof entry[key]==='string' && entry[key].trim()) &&
  /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && url(entry.source));
function newsLectureMatch(event,item) {
  return event.id==='public-news-'+item.id ||
    (event.date===item.date && normalize(event.title)===normalize(item.title) &&
      (!event.time || !item.time || event.time===item.time));
}
function mergeLectureNews(profiles,items) {
  const byId=new Map(profiles.map(speaker=>[speaker.id,speaker]));
  const byName=new Map();
  for(const speaker of profiles){
    const key=normalize(speaker.name);
    if(!byName.has(key))byName.set(key,[]);
    byName.get(key).push(speaker.id);
  }
  for(const item of items){
    const name=normalize(item.speaker);
    const candidates=byName.get(name)||[];
    const matched=candidates.filter(id=>normalize(byId.get(id).role).includes(normalize(item.matchRole||item.role)));
    const id=item.speakerId && byId.has(item.speakerId) && normalize(byId.get(item.speakerId).name)===name
      ? item.speakerId : matched.length===1 ? matched[0] : '';
    if(!id && (!item.newSpeaker || candidates.length))continue;
    const speaker=id?byId.get(id):{id:'news-'+name,name:item.speaker,role:item.role,source:item.source,
      category:item.category||'',year:'',photo:'',topics:[],career:[],books:[],events:[],reviews:[]};
    const event={id:'public-news-'+item.id,title:item.title,date:item.date,time:item.time||'',place:item.place||'',
      host:item.host||'',status:item.status||'행사 공지',source:item.source};
    const previous=speaker.events.find(e=>newsLectureMatch(e,item));
    const events=previous?speaker.events:[...speaker.events,event];
    byId.set(speaker.id,{...speaker,events});
    if(!id)byName.set(name,[speaker.id]);
  }
  return [...byId.values()];
}
const all = () => sorted(mergeLectureNews([...new Map([...seedById,...changed.map(row=>{
  const base=seedById.get(row.id);
  return [row.id,row.books===undefined && base?.books?{...row,books:base.books}:row];
})]).values()],publicNews));
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
    normalize([x.name,x.role,x.year,x.category,...x.topics,...x.career,...(x.books||[]),...x.events.map(e=>e.title+' '+e.place+' '+e.host)].join(' ')).includes(term)));
}
function personText(x) { return '<strong>'+esc(x.name)+'</strong><small>'+esc([x.role,x.year && x.year+'년생'].filter(Boolean).join(' · ')||'소속 미입력')+'</small>'; }
function drawList() {
  if(!$('topic-home').hidden)drawTopics();
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
  if(!$('topic-home').hidden)showTopicView(false);
  selected=id; tab=0; active=-1; suggest(false); drawList(); drawDetail();
  if(matchMedia('(max-width:650px)').matches) $('detail').scrollIntoView({block:'start'});
}
const empty = message => '<p class="empty">'+esc(message)+'</p>';
const profileLists = {career:'주요 이력',topics:'강의 주제',books:'저서'};
const listKeys = Object.keys(profileLists);
function profileList(key,items) {
  const title=profileLists[key];
  const list=items.length?'<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':empty('등록된 정보가 없습니다.');
  const content=key==='books'&&items.length>5?'<details><summary>'+items.length+'권 보기</summary>'+list+'</details>':list;
  return '<section class="box"><div class="sectionhead"><h3>'+title+'</h3>'+
    '<button type="button" data-action="person" data-section="'+key+'">'+title+' 수정</button></div>'+content+'</section>';
}
function listRow(label,value='') {
  return '<div class="profile-edit-row"><input type="text" aria-label="'+esc(label)+' 항목" value="'+esc(value)+'">'+
    '<button type="button" data-remove-row aria-label="'+esc(label)+' 항목 삭제">삭제</button></div>';
}
function listEditor(key,items,bulk=false) {
  const label=profileLists[key];
  if(bulk)return '<fieldset class="profile-edit-list" data-profile-list="'+key+'"><legend>'+label+'</legend>'+
    '<label>한 줄에 한 항목씩 입력하거나 붙여넣으세요.<textarea rows="4" aria-label="'+label+'">'+
    esc((items||[]).join('\n'))+'</textarea></label></fieldset>';
  return '<fieldset class="profile-edit-list" data-profile-list="'+key+'"><legend>'+label+'</legend>'+
    '<div data-profile-rows>'+((items?.length?items:['']).map(item=>listRow(label,item)).join(''))+'</div>'+
    '<button type="button" data-add-row>'+label+' 추가</button></fieldset>';
}
function profileListValues(group) {
  const bulk=group.querySelector('textarea');
  if(bulk)return bulk.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  return [...group.querySelectorAll('input')].map(input=>input.value.trim()).filter(Boolean);
}
function appendProfileListValues(fields,key,values) {
  const group=fields.querySelector('[data-profile-list="'+key+'"]');
  if(!group || !values.length)return;
  const items=[...new Set([...profileListValues(group),...values])];
  const bulk=group.querySelector('textarea');
  if(bulk)bulk.value=items.join('\n');
  else group.querySelector('[data-profile-rows]').innerHTML=items.map(item=>listRow(profileLists[key],item)).join('');
}
const dateSort = (a,b) => (b.date || b.published || '').localeCompare(a.date || a.published || '');
const feeLabel = event => /^\d{1,12}$/.test(event?.fee ?? '') ? new Intl.NumberFormat('ko-KR').format(Number(event.fee))+'원' : '';
const feeNote = event => feeLabel(event) ? ' <small class="lecture-fee">('+esc(feeLabel(event))+')</small>' : '';
function records(items, kind, preview=false) {
  if(!items.length) return empty(kind==='event'?'등록된 강의 이력이 없습니다.':'평가 이력 없음');
  return items.map(e=>'<div class="record"><div class="sectionhead"><strong>'+esc(e.title)+'</strong>'+(kind==='event'?feeNote(e):'')+
    (preview?'':'<button data-action="'+kind+'" data-id="'+esc(e.id)+'">수정</button>')+'</div><p>'+
    esc(kind==='event'?[[e.date||'일자 미확인',e.time].filter(Boolean).join(' '),e.place||'장소 미확인',e.host,e.status,e.published && '후기 게시 '+e.published].filter(Boolean).join(' · '):'평가일 '+(e.date||'미확인')+' · '+gradeOf(e)+'등급')+'</p>'+
    (kind==='event'?(!preview&&e.contact?'<p>섭외 연락처 · '+esc(e.contact)+'</p>':'')+link(e.source,'강의 출처 ↗'):(e.note?'<p>'+esc(e.note)+'</p>':''))+'</div>').join('');
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
    '<div class="recent-program"><small>최근 강의 · '+esc(latest?.date || '날짜 미확인')+'</small><small>'+esc(latest?.title || '등록된 강의 프로그램 없음')+feeNote(latest)+'</small></div></div>';
}
const todayKorea = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
function drawDetail() {
  const x=all().find(r=>r.id===selected);
  if(!x) { $('detail').innerHTML=empty('강사를 선택하거나 새로 등록하세요.'); return; }
  const events=[...x.events].sort(dateSort), reviews=[...x.reviews].sort(dateSort);
  const overview='<div class="overview">'+listKeys.map(key=>profileList(key,x[key]||[])).join('')+'</div><section><div class="sectionhead"><h3>최근 강의 이력</h3><button data-tab="1">전체 이력 보기</button></div><div style="margin-top:9px">'+records(events.slice(0,3),'event',true)+'</div></section>'+
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
  if(action) openForm(action.dataset.action,all().find(r=>r.id===selected),action.dataset.id,{},action.dataset.section);
});
const forms = {
  person:[['name','이름','text',1],['role','소속·직함','text',1],['year','출생연도','year'],['yearSource','출생연도 출처 URL','url'],['category','분야 (여러 분야는 쉼표로 구분)','text'],['photo','사진 URL','url'],['source','프로필 출처 URL','url']],
  event:[['title','강의 주제','text',1],['date','강의 날짜','date'],['place','강의 장소','text'],['host','주최 기관','text'],['fee','강의료 (원, 선택)','fee'],['contact','섭외 연락처 (선택)','text'],['status','확인 상태','text'],['published','후기 게시일','date'],['source','출처 URL','url']],
  review:[['title','강의 주제','text',1],['lectureDate','강의 날짜','date',1],['date','평가 날짜','date',1],['grade','평가 등급','grade',1],['note','평가 의견','textarea']]
};
function field([name,label,type,required],data,events) {
  const value=Array.isArray(data[name])?data[name].join('\n'):(data[name]??'');
  const attr=' name="'+name+'" '+(required?'required':'');
  let control='<input'+attr+' type="'+(type==='year'?'text':type)+'" '+(type==='year'?'inputmode="numeric" pattern="[0-9]{4}"':'')+' value="'+esc(value)+'">';
  if(type==='fee') control='<input'+attr+' type="text" inputmode="numeric" maxlength="16" placeholder="예: 500,000" value="'+esc(value)+'">';
  if(type==='textarea') control='<textarea'+attr+'>'+esc(value)+'</textarea>';
  if(type==='grade') control='<select'+attr+'><option value="">등급 선택</option>'+grades.map(g=>'<option '+(g===value?'selected':'')+'>'+g+'</option>').join('')+'</select>';
  if(events?.length && name==='title') control='<input'+attr+' list="event-titles" value="'+esc(value)+'"><datalist id="event-titles">'+events.map(e=>'<option value="'+esc(e.title)+'">').join('')+'</datalist>';
  return '<label>'+label+control+'</label>';
}
function openForm(kind,row,id,draft={},section) {
  editor={kind,row,id,section,photo:photoURL((row||draft).photo)?.startsWith('data:')?(row||draft).photo:''};
  let data=kind==='person'?(row||draft):((kind==='event'?row.events:row.reviews).find(x=>x.id===id)||{});
  if(kind==='review')data={...data,date:data.date||todayKorea(),grade:gradeOf(data)||''};
  $('dialog-title').textContent=({person:'강사',event:'강의 이력',review:'강의 평가'})[kind]+(id || (row&&kind==='person')?' 수정':' 등록');
  $('fields').innerHTML=forms[kind].map(f=>field(f,data,kind==='review'?row.events:null)).join('');
  if(kind==='person'){
    if(section){
      $('dialog-title').textContent=profileLists[section]+' 수정';
      $('fields').innerHTML=listEditor(section,data[section]);
    }else{
      $('fields').insertAdjacentHTML('beforeend',listKeys.map(key=>listEditor(key,data[key],!row)).join(''));
    }
  }
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
  if(kind==='person' && !section){
    const photoInput=$('fields').querySelector('[name="photo"]');
    if(editor.photo) photoInput.value='';
    window.attachSpeakerPhotos?.($('fields'),editor,photoInput);
    if(draft.webCandidate){
      $('fields').insertAdjacentHTML('beforeend','<label class="photo-check"><input type="checkbox" id="confirm-web-speaker" required> 출처를 대조해 선택한 강사와 같은 인물임을 확인했습니다.</label>');
    }
  }
  $('form-error').textContent='';
  $('dialog').showModal();
}
$('fields').addEventListener('click',event=>{
  const button=event.target.closest('[data-add-row],[data-remove-row]');
  if(!button)return;
  const group=button.closest('[data-profile-list]');
  if(button.hasAttribute('data-remove-row')){
    const row=button.closest('.profile-edit-row');
    const focusTarget=row.nextElementSibling?.querySelector('input')||row.previousElementSibling?.querySelector('input')||group.querySelector('[data-add-row]');
    row.remove();focusTarget.focus();return;
  }
  const rows=group.querySelector('[data-profile-rows]');
  rows.insertAdjacentHTML('beforeend',listRow(profileLists[group.dataset.profileList]));
  rows.lastElementChild.querySelector('input').focus();
});
$('add').onclick=()=>window.openSpeakerLookup();
$('close').onclick=$('cancel').onclick=()=>$('dialog').close();
const editForm=$('editor');
editForm.noValidate=true;
function clearEditErrors() {
  for(const field of editForm.querySelectorAll('[aria-invalid="true"]')){
    document.getElementById(field.getAttribute('aria-describedby'))?.remove();
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }
  $('form-error').textContent='';
}
editForm.addEventListener('input',event=>{
  const field=event.target;
  if(field.getAttribute('aria-invalid')!=='true')return;
  document.getElementById(field.getAttribute('aria-describedby'))?.remove();
  field.removeAttribute('aria-invalid');
  field.removeAttribute('aria-describedby');
  if(!editForm.querySelector('[aria-invalid="true"]'))$('form-error').textContent='';
});
editForm.addEventListener('submit',e=>{
  e.preventDefault();
  const {kind,row,id,section}=editor;
  const data=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,v.trim()]));
  clearEditErrors();
  const err=message=>{
    $('form-error').textContent=message;
    $('form-error').scrollIntoView({block:'nearest'});
  };
  const errors=[];
  const mark=(name,message)=>errors.push([editForm.elements.namedItem(name)||$(name),message]);
  for(const [name,label,type,required] of section?[]:forms[kind]){
    const field=editForm.elements.namedItem(name);
    const value=data[name];
    if(field.validity.badInput)mark(name,label+' 형식을 확인하세요.');
    else if(required && !value)mark(name,type==='grade'?'평가 등급을 선택하세요.':label+' 항목을 입력하세요.');
    else if(type==='url' && value && !url(value))mark(name,label+'에 http:// 또는 https://로 시작하는 주소를 입력하세요.');
    else if(type==='year' && value && (!/^\d{4}$/.test(value) || +value<1900 || +value>new Date().getFullYear()))
      mark(name,'출생연도는 1900년부터 올해까지의 네 자리 숫자로 입력하세요.');
  }
  const confirmation=$('confirm-web-speaker');
  if(confirmation&&!confirmation.checked)mark(confirmation.id,'출처와 강사 정보가 일치하면 확인란에 체크하세요.');
  if(kind==='review' && data.lectureDate && data.date && data.lectureDate>data.date)
    mark('date','평가 날짜는 강의 날짜와 같거나 이후여야 합니다.');
  if(kind==='event'){
    if(data.fee && !/^(?:[0-9]{1,12}|[0-9]{1,3}(?:,[0-9]{3}){1,3})$/.test(data.fee))
      mark('fee','강의료는 원 단위 숫자로 입력하세요. 예: 500,000');
    else data.fee=data.fee ? String(Number(data.fee.replaceAll(',',''))) : '';
  }
  if(kind==='person'&&!section&&!errors.length){
    const duplicate=all().find(x=>x.id!==row?.id && normalize(x.name)===normalize(data.name) && normalize(x.role)===normalize(data.role) && (!x.year || !data.year || x.year===data.year));
    if(duplicate)mark('name','같은 이름과 소속·직함의 강사가 이미 등록되어 있습니다. 기존 프로필을 확인하세요.');
  }
  if(errors.length){
    errors.forEach(([field,message],index)=>{
      const notice=document.createElement('span');
      notice.id='edit-field-error-'+index;
      notice.style.color='#9e2727';
      notice.style.fontSize='0.85rem';
      notice.textContent=message;
      field.closest('label').append(notice);
      field.setAttribute('aria-invalid','true');
      field.setAttribute('aria-describedby',notice.id);
    });
    $('form-error').textContent=errors.length+'개 항목을 확인하세요.';
    errors[0][0].focus();
    return;
  }
  let next;
  if(section){
    next={...row,[section]:profileListValues($('fields').querySelector('[data-profile-list="'+section+'"]'))};
  }else if(kind==='person'){
    data.category=categoryList(data).join(', ');
    next={events:[],reviews:[],...row,...data,photo:data.photo||editor.photo,id:row?.id||uid()};
    for(const key of listKeys)next[key]=profileListValues($('fields').querySelector('[data-profile-list="'+key+'"]'));
  } else {
    const key=kind==='event'?'events':'reviews';
    const entry={...row[key].find(record=>record.id===id),id:id||uid(),...data};
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
function groupTopics(speakers) {
  const topics=new Map();
  for(const speaker of speakers){
    for(const [title,event] of [...speaker.topics.map(title=>[title,null]),...speaker.events.map(event=>[event.title,event])]){
      const key=normalize(title);
      if(!key)continue;
      if(!topics.has(key))topics.set(key,{title,speakers:new Map(),eventCount:0});
      const topic=topics.get(key);
      if(!topic.speakers.has(speaker.id))topic.speakers.set(speaker.id,{speaker,events:[]});
      if(event){
        topic.speakers.get(speaker.id).events.push(event);
        topic.eventCount++;
      }
    }
  }
  return topics;
}

const directoryIntro=document.querySelector('.intro');
const directoryLayout=document.querySelector('.layout');
directoryIntro.insertAdjacentHTML('beforebegin',
  '<nav aria-label="화면 이동" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+
    '<button type="button" id="topic-nav">주제별 강의 현황</button><button type="button" id="directory-nav">강사 찾기</button></nav>'+
  '<section id="topic-home" aria-label="강의 뉴스와 주제별 현황">'+
    '<section id="lecture-news" aria-labelledby="lecture-news-title" class="box" style="margin-bottom:18px">'+
      '<div class="sectionhead"><h1 id="lecture-news-title">오늘의 강의 뉴스</h1>'+
      '<button type="button" id="news-pause" aria-pressed="false">흐름 멈춤</button></div><p id="lecture-news-date"></p>'+
      '<div id="lecture-news-items"></div></section>'+
    '<section class="intro"><div><h2>주제별 강의 현황</h2><p>주제를 선택하면 강사별 프로필과 등록된 강의 이력을 볼 수 있습니다.</p></div>'+
    '<button type="button" class="primary" id="topic-add">＋ 강사 등록</button></section>'+
    '<div class="box" id="topic-filter"><label for="topic-search">강의 주제 검색</label>'+
      '<input id="topic-search" type="search" placeholder="예: 리더십, 조직문화, 생성형 AI" style="margin:8px 0">'+
      '<p id="topic-count" aria-live="polite"></p></div>'+
    '<div id="topic-results" style="margin:14px 0"></div></section>');
let activeTopic='',activeTopicCategory='';
const topicLimits=new Map();
function showTopicView(home) {
  $('topic-home').hidden=!home;
  directoryIntro.hidden=home;
  directoryLayout.hidden=home;
  $('topic-nav').setAttribute('aria-current',home?'page':'false');
  $('directory-nav').setAttribute('aria-current',home?'false':'page');
  if(home)drawTopics();
}
function newsStrip(label,headlines) {
  return '<div class="news-strip" role="group" aria-label="'+esc(label)+'">'+
    '<div class="news-track"><div class="news-line">'+headlines+'</div>'+
    '<div class="news-line news-copy" aria-hidden="true" inert>'+headlines+'</div></div></div>';
}

function dailyNewsAdditions(items,today,speakers) {
  const knownNames=new Set(items.filter(item=>item.newSpeaker && item.foundOn && item.foundOn<today).map(item=>normalize(item.speaker)));
  const byName=new Map();
  const byTitle=new Map();
  for(const item of items){
    if(item.foundOn!==today)continue;
    const name=normalize(item.speaker),title=normalize(item.title);
    if(!byTitle.has(title))byTitle.set(title,item);
    if(!item.newSpeaker || knownNames.has(name) || byName.has(name))continue;
    const speaker=speakers.find(s=>s.id==='news-'+name);
    if(speaker)byName.set(name,{speaker,item});
  }
  return {people:[...byName.values()],topics:[...byTitle.values()]};
}

function drawLectureNews(speakers) {
  const today=todayKorea();
  const recent=new Date(today+'T00:00:00+09:00');
  recent.setUTCDate(recent.getUTCDate()-7);
  const cutoff=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(recent);
  $('lecture-news-date').textContent=newsData.checkedOn ? newsData.checkedOn+' 확인 · 한국시간' : '확인된 강의 뉴스를 준비 중입니다.';
  const ordered=publicNews.filter(item=>item.date>=cutoff).sort((a,b)=>{
    const first=a.date>=today, second=b.date>=today;
    if(first!==second)return first?-1:1;
    return (first?a.date.localeCompare(b.date):b.date.localeCompare(a.date)) || (a.time||'').localeCompare(b.time||'');
  });
  const entries=ordered.slice(0,12);
  const ticker=$('lecture-news-items');
  const pause=$('news-pause');
  const daily=dailyNewsAdditions(publicNews,today,speakers);
  pause.hidden=!(entries.length||daily.people.length||daily.topics.length) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const headline=item=>{
    const speaker=speakers.find(s=>normalize(s.name)===normalize(item.speaker) && s.events.some(e=>newsLectureMatch(e,item)));
    const metadata=[item.date,item.time,item.place,item.status].filter(Boolean).map(esc).join(' · ');
    return '<span class="news-headline"><small>'+metadata+'</small> '+
      link(item.source,item.speaker+' · '+item.title)+
      (speaker?' <button type="button" data-person="'+esc(speaker.id)+'" aria-label="'+esc(item.speaker)+' 프로필">프로필</button>':'')+'</span>';
  };
  const rows=[entries.filter((_,index)=>index%2===0),entries.filter((_,index)=>index%2===1)];
  const speakerLine=daily.people.map(({speaker,item})=>'<span class="news-headline">'+
    '<button type="button" data-person="'+esc(speaker.id)+'">'+esc(item.speaker)+'</button>'+
    '<small>'+esc(item.role)+'</small></span>').join('');
  const topicLine=daily.topics.map(item=>'<span class="news-headline">'+link(item.source,item.title)+
    ' <small>'+esc(item.speaker+' · '+item.date)+'</small></span>').join('');
  const news=entries.length?rows.filter(row=>row.length).map((row,index)=>
    newsStrip('강의 뉴스 '+(index+1)+'줄',row.map(headline).join(''))).join(''):
    empty('최근 확인된 강의 뉴스가 없습니다.');
  ticker.innerHTML=news+
    '<section style="margin-top:12px"><h2 style="font-size:1rem;margin-bottom:4px">오늘 추가된 강사 <small>'+daily.people.length+'명</small></h2>'+
      (speakerLine?newsStrip('오늘 추가된 강사',speakerLine):empty('오늘 추가된 강사가 없습니다.'))+'</section>'+
    '<section style="margin-top:12px"><h2 style="font-size:1rem;margin-bottom:4px">오늘 추가된 강의 주제 <small>'+daily.topics.length+'개</small></h2>'+
      (topicLine?newsStrip('오늘 추가된 강의 주제',topicLine):empty('오늘 추가된 강의 주제가 없습니다.'))+'</section>';
}
$('news-pause').onclick=()=>{
  const button=$('news-pause');
  const paused=button.getAttribute('aria-pressed')!=='true';
  button.setAttribute('aria-pressed',String(paused));
  button.textContent=paused?'흐름 재생':'흐름 멈춤';
  $('lecture-news-items').classList.toggle('news-paused',paused);
};

function categorizeTopics(topics) {
  const groups=new Map();
  for(const [key,topic] of topics){
    const fields=new Set([...topic.speakers.values()].flatMap(({speaker})=>categoryList(speaker)));
    for(const field of fields.size?fields:['미분류']){
      if(!groups.has(field))groups.set(field,[]);
      groups.get(field).push([key,topic]);
    }
  }
  return [...groups].sort((a,b)=>a[0]==='미분류'?1:b[0]==='미분류'?-1:a[0].localeCompare(b[0],'ko'));
}

function drawTopics() {
  const speakers=all();
  const topics=groupTopics(speakers);
  const selectedTopic=topics.get(activeTopic);
  $('lecture-news').hidden=Boolean(selectedTopic);
  if(!selectedTopic)drawLectureNews(speakers);
  $('topic-filter').hidden=Boolean(selectedTopic);
  const result=$('topic-results');
  if(selectedTopic){
    const speakerCards=[...selectedTopic.speakers.values()].map(({speaker,events})=>
      '<section class="box"><div class="sectionhead"><h3>'+esc(speaker.name)+'</h3>'+
      '<button type="button" data-person="'+esc(speaker.id)+'">프로필 보기</button></div>'+
      '<p>'+esc(speaker.role)+'</p><p style="margin:8px 0">등록된 강의 이력 '+events.length+'건</p>'+
      (events.length?records([...events].sort(dateSort),'event',true):empty('이 주제의 강의 이력이 아직 없습니다.'))+'</section>');
    result.innerHTML='<div class="box" style="margin-bottom:12px"><div class="sectionhead"><h2 id="topic-title" tabindex="-1">'+esc(selectedTopic.title)+'</h2>'+
      '<button type="button" id="topic-back">주제 목록으로</button></div>'+
      '<p>강사 '+selectedTopic.speakers.size+'명 · 등록된 강의 이력 '+selectedTopic.eventCount+'건</p></div>'+
      '<div class="overview">'+speakerCards.join('')+'</div>';
    return;
  }
  const terms=$('topic-search').value.trim().split(/\s+/).map(normalize).filter(Boolean);
  const groups=categorizeTopics(topics);
  const openFields=new Set([...result.querySelectorAll('details[open]')].map(group=>group.dataset.topicCategory));
  if(activeTopicCategory)openFields.add(activeTopicCategory);
  const matchedTopics=new Set();
  const grouped=groups.flatMap(([field,items])=>{
    const matches=items.filter(([key])=>terms.every(term=>key.includes(term)||normalize(field).includes(term)));
    if(!matches.length)return [];
    matches.forEach(([key])=>matchedTopics.add(key));
    matches.sort((a,b)=>b[1].eventCount-a[1].eventCount || b[1].speakers.size-a[1].speakers.size || a[1].title.localeCompare(b[1].title,'ko'));
    return [{field,matches}];
  });
  $('topic-count').textContent='분야 '+grouped.length+'개 · 주제 '+matchedTopics.size+'개 / 전체 '+topics.size+'개';
  result.innerHTML=grouped.length?grouped.map(({field,matches})=>{
    const limit=topicLimits.get(field)||12;
    const cards=matches.slice(0,limit).map(([key,topic])=>
      '<button class="box topic-card" type="button" data-topic-key="'+esc(key)+'"><strong>'+esc(topic.title)+
      '</strong><br><small>강사 '+topic.speakers.size+'명 · 강의 이력 '+topic.eventCount+'건</small></button>').join('');
    return '<details class="box topic-category" data-topic-category="'+esc(field)+'"'+(terms.length||openFields.has(field)?' open':'')+'>'+
      '<summary><strong>'+esc(field)+'</strong> <small>주제 '+matches.length+'개</small></summary><div class="overview">'+cards+'</div>'+
      (matches.length>limit?'<button type="button" data-topic-more>이 분야 주제 더 보기</button>':'')+'</details>';
  }).join(''):empty('검색 조건에 맞는 강의 주제가 없습니다.');
}
$('topic-nav').onclick=()=>{activeTopic='';showTopicView(true);};
$('directory-nav').onclick=()=>showTopicView(false);
$('topic-add').onclick=()=>$('add').click();
$('topic-search').addEventListener('input',()=>{topicLimits.clear();drawTopics();});
$('topic-results').addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.hasAttribute('data-topic-key')){
    activeTopicCategory=button.closest('[data-topic-category]').dataset.topicCategory;
    activeTopic=button.dataset.topicKey;
    drawTopics();
    $('topic-title').focus();
  }else if(button.id==='topic-back'){
    const previous=activeTopic;
    activeTopic='';drawTopics();
    const group=[...$('topic-results').querySelectorAll('[data-topic-category]')].find(el=>el.dataset.topicCategory===activeTopicCategory);
    ([...(group?.querySelectorAll('[data-topic-key]')||[])].find(el=>el.dataset.topicKey===previous)||$('topic-search')).focus();
  }else if(button.hasAttribute('data-topic-more')){
    const field=button.closest('[data-topic-category]').dataset.topicCategory;
    const limit=topicLimits.get(field)||12;
    topicLimits.set(field,limit+12);drawTopics();
    const group=[...$('topic-results').querySelectorAll('[data-topic-category]')].find(el=>el.dataset.topicCategory===field);
    group?.querySelectorAll('[data-topic-key]')[limit]?.focus();
  }
});
showTopicView(true);
categories();drawList();drawDetail();
