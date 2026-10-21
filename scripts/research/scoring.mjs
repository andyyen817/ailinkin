export const scoreWeights=Object.freeze({application:30,companyType:25,role:25,region:10,size:10});
export function scoreCustomer(draft,evidence,contacts=[]){
  const dimensions={};let total=0,covered=0;
  for(const [key,weight] of Object.entries(scoreWeights)){
    const claim=draft?.[key],source=evidence.find(e=>e.id===claim?.evidenceId);
    const value=claim?.value;
    const contact=contacts.find(c=>c.id===claim?.contactId&&!c.suppressed&&c.employerVerified===true);
    const known=Number.isFinite(value)&&value>=0&&value<=1&&source&&typeof claim.quote==='string'&&
      claim.quote.length>=8&&source.quote.includes(claim.quote)&&(key!=='role'||Boolean(contact));
    const points=known?Math.round(weight*value):0;
    if(known)covered+=weight;
    total+=points;dimensions[key]={weight,points,known:Boolean(known),evidenceId:known?source.id:null};
  }
  return {total,grade:total>=80?'A':total>=60?'B':'C',coverage:covered,dimensions};
}
