import {parseSavedVariables} from '/lua-data.js';
const status=document.querySelector('#status'),accounts=document.querySelector('#accounts');
document.querySelector('#open').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;try{
 if(file.size>20*1024*1024)throw Error('Choose a file smaller than 20 MB.');
 const data=parseSavedVariables(await file.text());accounts.replaceChildren();
 const names=Object.entries(data.Default||{}).filter(([,a])=>a?.$AccountWide).map(([name])=>name);
 status.textContent=`Read ${file.name}. ${names.length} account(s) found. This development build currently supports file inspection only.`;
 for(const name of names){const p=document.createElement('p');p.textContent=name;accounts.append(p);}
 }catch(error){status.textContent=error.message;accounts.replaceChildren();}e.target.value='';
});
