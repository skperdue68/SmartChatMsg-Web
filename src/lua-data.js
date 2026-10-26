const numericKeys=new WeakMap();
// Restricted SavedVariables data grammar. This never evaluates Lua or JavaScript.
export function parseSavedVariables(input) {
 if(typeof input!=='string'||input.length>20*1024*1024)throw Error('Choose a SavedVariables file smaller than 20 MB.');
 let i=0,count=0;const fail=message=>{throw Error(`${message} at character ${i+1}.`);};
 function space(){for(;;){while(/\s/.test(input[i]||'')&&i<input.length)i++;if(input.startsWith('--',i)){const end=input.indexOf('\n',i);i=end<0?input.length:end+1;}else break;}}
 function take(s){space();if(!input.startsWith(s,i))fail(`Expected ${s}`);i+=s.length;}
 function string(){space();const quote=input[i++];let out='';while(i<input.length){let c=input[i++];if(c===quote)return out;if(c!=='\\'){out+=c;continue;}c=input[i++];const escapes={n:'\n',r:'\r',t:'\t',a:'\x07',b:'\b',f:'\f',v:'\v','\\':'\\','"':'"',"'":"'"};if(c in escapes)out+=escapes[c];else if(/[0-9]/.test(c||'')){let n=c;while(n.length<3&&/[0-9]/.test(input[i]||''))n+=input[i++];if(+n>255)fail('Invalid byte escape');out+=String.fromCharCode(+n);}else if(c==='\n')out+='\n';else fail('Unsupported escape');}fail('Unterminated string');}
 function value(depth=0){space();if(depth>100||++count>1000000)fail('File nesting or item limit exceeded');
 if(input[i]==='"'||input[i]==="'")return string();
 if(input[i]==='{'){i++;const table=Object.create(null);const numeric=new Set();numericKeys.set(table,numeric);let sequence=1;space();while(input[i]!=='}'){
 let key,v;if(input[i]==='['){i++;key=value(depth+1);if(!['string','number'].includes(typeof key))fail('Invalid table key');take(']');take('=');v=value(depth+1);}else{
 const m=/^([A-Za-z_][A-Za-z_0-9]*)\s*=/.exec(input.slice(i));if(m){key=m[1];i+=m[0].length;v=value(depth+1);}else{key=sequence++;v=value(depth+1);}}
 if(typeof key==='number')numeric.add(String(key));if(Object.hasOwn(table,key))fail('Duplicate table key');if(v!==null)table[key]=v;space();if(input[i]===','||input[i]===';')i++;else if(input[i]!=='}')fail('Expected table separator');space();}i++;return table;}
 for(const [name,v] of [['true',true],['false',false],['nil',null]])if(input.startsWith(name,i)&&!/[A-Za-z_0-9]/.test(input[i+name.length]||'')){i+=name.length;return v;}
 const number=/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));if(number){i+=number[0].length;const n=Number(number[0]);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)fail('Unsupported numeric range');return n;}fail('Expected a data value');}
 input=input.replace(/^\uFEFF/,'');take('SmartChatMsgSavedVars');take('=');const result=value();space();if(input[i]===';'){i++;space();}if(i!==input.length)fail('Unexpected trailing code');if(!result||typeof result!=='object')fail('Expected SavedVariables table');return result;
}
export function writeSavedVariables(data){
 function encode(v,depth=0){if(depth>100)throw Error('Table nesting limit exceeded');if(v===null)return 'nil';if(typeof v==='string')return '"'+v.replace(/[\\"\x00-\x1f\x7f]/g,c=>c==='\\'?'\\\\':c==='"'?'\\"':`\\${String(c.charCodeAt(0)).padStart(3,'0')}`)+'"';if(typeof v==='boolean')return String(v);if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER)return String(v);if(!v||typeof v!=='object')throw Error('Unsupported SavedVariables value');const indent='    '.repeat(depth);return '{\n'+Object.entries(v).map(([k,x])=>indent+'    ['+(numericKeys.get(v)?.has(k)?String(Number(k)):encode(k))+'] = '+encode(x,depth+1)+',\n').join('')+indent+'}';}
 return 'SmartChatMsgSavedVars = '+encode(data)+'\n';
}
