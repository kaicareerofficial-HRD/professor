'use strict';

const csvColumns = [
  ['id','강사 ID'],['name','이름'],['role','소속·직함'],['year','출생연도'],
  ['category','분야'],['photo','사진 URL'],['source','프로필 출처 URL'],
  ['yearSource','출생연도 출처 URL'],['career','주요 이력'],['topics','강의 주제']
];
const csvFormula = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]|^'/u;
function csvCell(value) {
  const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
  const safe = csvFormula.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"','""') + '"';
}
function parseCsv(text) {
  const result = [];
  let row = [], value = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/,'');
  function cell() { row.push(value); value=''; closed=false; }
  function endRow() { cell(); if(row.some(Boolean))result.push(row); row=[]; }
  for(let index=0;index<text.length;index++){
    const ch=text[index];
    if(quoted){
      if(ch==='"' && text[index+1]==='"'){value+='"';index++;}
      else if(ch==='"'){quoted=false;closed=true;}
      else value+=ch;
    } else if(ch===',') cell();
    else if(ch==='\r' || ch==='\n'){
      if(ch==='\r' && text[index+1]==='\n')index++;
      endRow();
    } else if(ch==='"' && !value && !closed) quoted=true;
    else if(closed || ch==='"') throw Error('CSV 따옴표 형식을 확인하세요.');
    else value+=ch;
  }
  if(quoted)throw Error('닫히지 않은 따옴표가 있습니다.');
  endRow();
  return result;
}
function csvDrafts(text, existing) {
  const [header,...records] = parseCsv(text);
  if(!header || !records.length) throw Error('가져올 강사 행이 없습니다.');
  const columns = header.map(h=>csvColumns.find(([key,label])=>[key,label].includes(h.trim()))?.[0]);
  if(!columns.includes('name') || !columns.includes('role') || new Set(columns.filter(Boolean)).size!==columns.filter(Boolean).length)
    throw Error('헤더에 이름과 소속·직함을 각각 한 번씩 입력하세요.');
  const byId = new Map(existing.map(r=>[r.id,r]));
  const drafts = new Map();
  let added = 0;
  for(const [index,record] of records.entries()){
    const fail=message=>{throw Error((index+2)+'번째 데이터 줄 · '+message);};
    if(record.length!==header.length)fail('열 개수가 헤더와 다릅니다.');
    const fields=Object.fromEntries(columns.flatMap((key,i)=>{
      if(!key)return [];
      const text=record[i];
      return [[key,(text.startsWith("'") && csvFormula.test(text.slice(1))?text.slice(1):text).trim()]];
    }));
    if(!fields.name || !fields.role)fail('이름과 소속·직함이 필요합니다.');
    if(fields.year && (!/^\d{4}$/.test(fields.year) || +fields.year<1900 || +fields.year>+todayKorea().slice(0,4)))fail('출생연도는 네 자리 숫자로 입력하세요.');
    for(const field of ['photo','source','yearSource']){
      if(fields[field] && !url(fields[field]))fail('사진과 출처 주소는 http:// 또는 https://로 입력하세요.');
    }
    const matching=[...byId.values()].filter(r=>normalize(r.name)===normalize(fields.name) && normalize(r.role)===normalize(fields.role) && (!r.year || !fields.year || r.year===fields.year));
    if(fields.id && !byId.has(fields.id))fail('강사 ID가 존재하지 않습니다. 신규 강사는 ID를 비워 두세요.');
    if(!fields.id && matching.length>1)fail('같은 이름과 직함의 강사가 여러 명입니다. 내보낸 목록에서 정확한 강사 ID를 확인하세요.');
    const previous=fields.id?byId.get(fields.id):matching[0];
    if(matching.some(r=>r.id!==previous?.id))fail('다른 강사와 이름·소속·출생연도가 중복됩니다.');
    const id=previous?.id || uid();
    if(drafts.has(id))fail('같은 강사가 파일에 두 번 포함되었습니다.');
    delete fields.id;
    if('category' in fields)fields.category=categoryList(fields).join(', ');
    for(const field of ['career','topics'])if(field in fields)fields[field]=fields[field].split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(previous?.photo.startsWith('data:') && fields.photo==='')delete fields.photo;
    const next={role:'',category:'',year:'',photo:'',source:'',career:[],topics:[],events:[],reviews:[],...previous,...fields,id};
    if(!previous)added++;
    byId.set(id,next);
    const isUnchanged=previous && Object.keys(fields).every(k=>JSON.stringify(previous[k] ?? '')===JSON.stringify(next[k]));
    drafts.set(id,isUnchanged?null:next);
  }
  return {rows:[...drafts.values()].filter(Boolean),added};
}
$('csv-export').onclick=()=>{
  const rows=[csvColumns.map(([,label])=>label),...all().map(r=>csvColumns.map(([k])=>k==='photo'&&!url(r[k])?'':r[k]))];
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
  const address=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=address;anchor.download='강사목록.csv';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(address),1000);
};
$('csv-import').onclick=()=>$('csv-file').click();
$('csv-file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';
  if(!file)return;
  try{
    if(file.size>5*1024*1024)throw Error('5MB 이하의 CSV 파일을 선택하세요.');
    let text;
    const bytes=await file.arrayBuffer();
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch{text=new TextDecoder('euc-kr',{fatal:true}).decode(bytes);}
    const {rows,added}=csvDrafts(text,all());
    if(!rows.length){toast('변경할 강사 정보가 없습니다.');return;}
    if(!confirm('강사 '+added+'명을 추가하고 '+(rows.length-added)+'명을 수정할까요? 기존 강의 이력과 평가는 유지됩니다.'))return;
    persist([...new Map([...changed,...rows].map(r=>[r.id,r])).values()]);
    categories();drawList();drawDetail();
    toast('강사 '+added+'명 추가 · '+(rows.length-added)+'명 수정');
  }catch(error){toast('CSV 가져오기 실패 · '+(error.name==='QuotaExceededError'?'브라우저 저장 공간이 부족합니다.':error.message||'파일 형식을 확인하세요.'));}
};
