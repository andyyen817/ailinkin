import {ProviderError} from './http.mjs';
import {parseModelObject} from './model-json-syntax.mjs';
export async function modelJson(call,messages,model='deepseek-chat'){
  const raw=await call('ai','/chat/completions',{model,messages,thinking:{type:'disabled'},temperature:0.2,
    response_format:{type:'json_object'},max_tokens:8000});
  const choice=raw.choices?.[0];
  if(choice?.finish_reason!=='stop')throw new ProviderError(choice?.finish_reason==='length'?'模型输出截断，不能记录为完整分析':'模型未完整返回分析','待核实');
  const content=choice.message?.content;
  if(typeof content!=='string'||!content.trim())throw new ProviderError('模型返回空正文','待核实');
  try{return parseModelObject(content);}
  catch{throw new ProviderError('模型 JSON 格式不正确','待核实');}
}
