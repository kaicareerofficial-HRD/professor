'use strict';

const lookup = $('lookup');
let lookupRun = 0;
let candidates = [];
const safeText = value => typeof value === 'string' ? value.trim() : '';
const wikiBase = 'https://ko.wikipedia.org/w/api.php';
const dataBase = 'https://www.wikidata.org/w/api.php';
const lines = value => safeText(value).split('\n').map(s=>s.trim()).filter(Boolean);
function wikiTitle(title) { return title.replace(/\s*\([^)]*\)$/, ''); }

async function publicQuery(endpoint, params) {
  const address = endpoint + '?' + new URLSearchParams({format:'json',formatversion:2,origin:'*',...params});
  const response = await fetch(address,{signal:AbortSignal.timeout(9000),credentials:'omit'});
  if(!response.ok) throw Error('search unavailable');
  const data = await response.json();
  if(data.error) throw Error('search unavailable');
  return data;
}
async function searchPeople(name,topic) {
  const query = await publicQuery(wikiBase,{
    action:'query',generator:'search',gsrsearch:'intitle:"'+name.replaceAll('"','')+'"',gsrlimit:15,
    prop:'extracts|pageimages|pageprops|info',exintro:1,explaintext:1,exlimit:15,piprop:'thumbnail',pithumbsize:250,
    ppprop:'wikibase_item|disambiguation',inprop:'url'
  });
  const pages = (query.query?.pages || []).filter(p=>normalize(wikiTitle(p.title))===normalize(name) &&
    /^Q\d+$/.test(p.pageprops?.wikibase_item || '') && p.pageprops.disambiguation===undefined);
  if(!pages.length) return [];
  const entities = await publicQuery(dataBase,{action:'wbgetentities',ids:pages.map(p=>p.pageprops.wikibase_item).join('|'),props:'claims|descriptions',languages:'ko'});
  return pages.flatMap(p=>{
    const id=p.pageprops.wikibase_item, entity=entities.entities?.[id];
    if(!entity?.claims?.P31?.some(c=>c.rank!=='deprecated' && c.mainsnak?.datavalue?.value?.id==='Q5')) return [];
    const births=[...new Set((entity.claims.P569 || []).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value).filter(v=>v?.precision>=9).map(v=>v.time?.match(/^\+(\d{4})-/)?.[1]).filter(Boolean))];
    const year=births.length===1?births[0]:'';
    const role=safeText(entity.descriptions?.ko?.value);
    const summary=safeText(p.extract).slice(0,480);
    return [{name:wikiTitle(p.title),label:p.title,role,year,yearSource:year?'https://www.wikidata.org/wiki/'+id:'',photo:p.thumbnail?.source||'',source:p.fullurl||'',career:[],topics:[],summary,
      keyword:topic ? normalize([p.title,role,summary].join(' ')).includes(normalize(topic)) : undefined,kind:'한국어 위키백과 · 위키데이터'}];
  });
}
function external(name,topic) {
  const q=encodeURIComponent([name,topic,'강연'].filter(Boolean).join(' '));
  return '<div class="lookup-links">'+link('https://search.naver.com/search.naver?where=news&query='+q,'네이버 뉴스에서 확인 ↗')+' · '+link('https://www.google.com/search?q='+q,'웹 전체에서 확인 ↗')+'</div>';
}
function candidateCard(c,index) {
  const photo=photoURL(c.photo);
  return '<section class="record lookup-card">'+(photo?'<img src="'+esc(photo)+'" alt="'+esc(c.name)+' 후보 사진" referrerpolicy="no-referrer">':'')+
    '<div><strong>'+esc(c.label||c.name)+'</strong><p>'+esc([c.kind,c.role,c.year?c.year+'년생':'출생연도 미확인'].filter(Boolean).join(' · '))+'</p>'+
    (c.career.length?'<p>주요 이력 · '+esc(c.career.slice(0,3).join(' / '))+'</p>':'')+
    (c.topics.length?'<p>강의 주제 · '+esc(c.topics.slice(0,3).join(' / '))+'</p>':'<p>강의 주제는 출처에서 추가 확인이 필요합니다.</p>')+
    (c.summary?'<details><summary>인물 소개 확인</summary><p>'+esc(c.summary)+'</p></details>':'')+
    (c.keyword===undefined?'':'<p>'+ (c.keyword?'입력 키워드가 출처에 있습니다.':'입력 키워드는 이 출처에서 확인되지 않았습니다.')+'</p>')+
    '<p>'+link(c.source,'프로필 출처 ↗')+(c.yearSource?' · '+link(c.yearSource,'출생연도 출처 ↗'):'')+'</p>'+
    '<button type="button" data-candidate="'+index+'">'+(c.id?'기존 프로필 보기':'이 후보로 입력하기')+'</button></div></section>';
}
window.openSpeakerLookup=()=>{
  lookupRun++;
  $('lookup-form').reset();
  $('lookup-results').textContent='';
  lookup.showModal();
  $('lookup-name').focus();
};
$('lookup-close').onclick=()=>lookup.close();
lookup.addEventListener('close',()=>{lookupRun++;});
function continueWith(draft,photoMode=false) {
  lookup.close();
  openForm('person',null,null,draft);
  if(photoMode) $('speaker-doc').focus();
}
$('lookup-manual').onclick=()=>continueWith({name:$('lookup-name').value.trim()});
$('lookup-photo').onclick=()=>continueWith({name:$('lookup-name').value.trim()},true);
$('lookup-form').onsubmit=async event=>{
  event.preventDefault();
  const name=$('lookup-name').value.trim(), topic=$('lookup-topic').value.trim();
  if(!name)return;
  const run=++lookupRun;
  const result=$('lookup-results');
  result.textContent='공개 프로필을 검색 중입니다…';
  const local=all().filter(r=>normalize(wikiTitle(r.name))===normalize(name)).map(r=>({...r,kind:'등록된 강사'}));
  let web=[], failed=false;
  try { web=await searchPeople(name,topic); } catch { failed=true; }
  if(run!==lookupRun || !lookup.open)return;
  candidates=[...local,...web.sort((a,b)=>Number(Boolean(b.keyword))-Number(Boolean(a.keyword)))];
  const message=failed?'웹 검색에 연결할 수 없습니다. 아래에서 다시 확인하거나 직접 입력하세요.':
    web.length?'사진, 소속, 출생연도와 출처를 대조한 뒤 후보를 선택하세요.':'웹에서 일치하는 인물 프로필을 찾을 수 없습니다. 직접 입력하거나 사진을 올릴 수 있습니다.';
  result.innerHTML='<p class="lookup-message">'+message+'</p>'+candidates.map(candidateCard).join('')+external(name,topic);
};
$('lookup-results').onclick=event=>{
  const button=event.target.closest('[data-candidate]');
  if(!button)return;
  const c=candidates[Number(button.dataset.candidate)];
  if(c.id){
    lookup.close(); search.value=''; $('category').value=''; choose(c.id); return;
  }
  continueWith({...c,career:c.career.length?c.career:[c.role].filter(Boolean),webCandidate:true});
};

function readPortrait(file) {
  return createImageBitmap(file).then(bitmap=>{
    try{
      const scale=Math.min(1,440/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',0.82);
    }finally{bitmap.close();}
  });
}
let ocrLibrary;
function loadOCR() {
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  return ocrLibrary ||= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
    script.onload=()=>resolve(window.Tesseract);
    script.onerror=()=>{ocrLibrary=null;script.remove();reject(Error('OCR unavailable'));};
    document.head.append(script);
  });
}
function fillRecognized(text,fields) {
  const form = $('editor').elements;
  const entries=lines(text);
  const name=entries.map(s=>s.match(/^(?:성명|이름|강사명)\s*[:：]\s*(.{2,30})$/)).find(Boolean)?.[1];
  const role=entries.map(s=>s.match(/^(?:소속|직함)\s*[:：]\s*(.{2,75})$/)).find(Boolean)?.[1];
  const year=text.match(/(?:출생(?:연도)?|생년월일)\s*[:：]?\s*((?:19|20)\d{2})/)?.[1];
  for(const [key,value] of Object.entries({name,role,year})) if(value && !form[key].value.trim())form[key].value=value.trim();
  let section='career';
  const output={career:[],topics:[]};
  for(const line of entries){
    if(/^(?:성명|이름|강사명|소속|직함|출생(?:연도)?|생년월일)\s*[:：]/.test(line))continue;
    const heading=line.match(/^(주요\s*이력|경력|학력|강의\s*(?:내용|주제)|강연\s*(?:내용|주제))\s*[:：]?\s*(.*)$/);
    if(heading){section=/^강/.test(heading[1])?'topics':'career';if(heading[2])output[section].push(heading[2]);}
    else output[section].push(line);
  }
  for(const key of Object.keys(output)){
    form[key].value=[...new Set([...lines(form[key].value),...output[key]])].join('\n');
  }
  fields.querySelector('textarea[name="career"]').scrollIntoView({block:'nearest'});
}
window.attachSpeakerPhotos=(fields,state,photoInput)=>{
  fields.insertAdjacentHTML('afterbegin','<section class="box photo-fields"><h3>프로필 사진과 이력 이미지</h3><label>강사 사진 파일<input id="speaker-portrait" type="file" accept="image/jpeg,image/png,image/webp"></label><label>이력이 들어 있는 이미지<input id="speaker-doc" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="photo-check"><input id="doc-as-photo" type="checkbox"> 이력 이미지도 프로필 사진으로 사용</label><p id="photo-status" role="status"></p><img id="photo-preview" alt="업로드한 강사 사진" hidden><button type="button" id="remove-photo" hidden>첨부 사진 제거</button></section>');
  const status=$('photo-status'), preview=$('photo-preview'), remove=$('remove-photo');
  let busy=false;
  const showPhoto=()=>{
    preview.hidden=remove.hidden=!state.photo;
    if(state.photo)preview.src=state.photo;else preview.removeAttribute('src');
  };
  showPhoto();
  remove.onclick=()=>{state.photo='';showPhoto();};
  const upload=(file,readText)=>{
    if(!file||busy)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024){
      status.textContent='12MB 이하의 JPG, PNG 또는 WebP 이미지를 선택하세요.';return;
    }
    const saveButton=$('editor').querySelector('button.primary');
    const usePhoto=!readText || $('doc-as-photo').checked;
    busy=true; saveButton.disabled=true;
    const run=async()=>{
      let worker;
      try{
        if(usePhoto){state.photo=await readPortrait(file);photoInput.value='';showPhoto();}
        if(!readText){status.textContent='강사 사진을 첨부했습니다.';return;}
        status.textContent='이미지에서 한글과 영어를 읽는 중입니다…';
        let timeout;
        const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('OCR timed out')),45000);});
        const scan=new Promise((resolve,reject)=>{
          loadOCR().then(tesseract=>tesseract.createWorker(['kor','eng'],1,{
            workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
            corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
            langPath:'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main',
            gzip:false,
            errorHandler:reject,
            logger:m=>{if(m.status==='recognizing text')status.textContent='문자 인식 '+Math.round(m.progress*100)+'%';}
          })).then(async ready=>{
            if(!timeout){await ready.terminate();return;}
            worker=ready;
            return worker.recognize(file);
          }).then(resolve,reject);
        });
        let text;
        try { ({data:{text}}=await Promise.race([scan,deadline])); }
        finally {clearTimeout(timeout);timeout=null;}
        if(!status.isConnected || !$('dialog').open)return;
        if(!text.trim()){status.textContent='읽을 수 있는 글자가 없습니다. 주요 이력을 직접 입력하세요.';return;}
        fillRecognized(text,fields);
        status.textContent='추출한 내용을 입력했습니다. 이름, 연도, 이력과 강의 주제를 검토한 뒤 저장하세요.';
      }catch{
        status.textContent='이미지를 처리할 수 없습니다. 사진을 다시 선택하거나 내용을 직접 입력하세요.';
      }finally{
        busy=false;saveButton.disabled=false;
        if(worker)await worker.terminate().catch(()=>{});
      }
    };
    void run();
  };
  for(const [id,readText] of [['speaker-portrait',false],['speaker-doc',true]])$(id).onchange=event=>{
    upload(event.target.files[0],readText);event.target.value='';
  };
};
