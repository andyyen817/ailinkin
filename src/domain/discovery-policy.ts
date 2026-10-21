export function discoveryPolicy(input:{discoveryMode?:string;expectedTarget?:number}){
  return input.discoveryMode==='coverage'?{mode:'coverage',expectedTarget:input.expectedTarget??null,maxOrganizations:10000,
    lowYieldRounds:3,minNewPerRound:2,reason:'优先覆盖买家群体；期望数量不等于承诺或执行停止条件'}:undefined;
}
