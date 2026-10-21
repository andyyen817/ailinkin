import {createHash} from 'node:crypto';
export function parseModelObject(text){
  const object=value=>{if(!value||Array.isArray(value)||typeof value!=='object')throw Error('MODEL_OBJECT_REQUIRED');return value;};
  try{return object(JSON.parse(text));}catch{}
  const stack=[],closers={']':'[','}':'{'};let quoted=false,escaped=false,fixed='',insertion=null;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){fixed+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;fixed+=c;continue;}
    if(c==='{'||c==='[')stack.push(c);
    if(c==='}'||c===']'){
      if(stack.at(-1)!==closers[c]){
        if(insertion!==null||c!==']'||stack.at(-1)!=='{'||stack.at(-2)!=='[')throw Error('MODEL_JSON_UNRECOVERABLE');
        fixed+='}';stack.pop();insertion=i;
      }
      if(stack.pop()!==closers[c])throw Error('MODEL_JSON_UNRECOVERABLE');
    }
    fixed+=c;
  }
  if(quoted||stack.length||insertion===null)throw Error('MODEL_JSON_UNRECOVERABLE');
  const value=object(JSON.parse(fixed));
  value._jsonSyntaxRepair={kind:'single_object_closer_before_array_end',insertedAt:insertion,originalSha256:createHash('sha256').update(text).digest('hex')};
  return value;
}
