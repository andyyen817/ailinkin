type SavedAnalysis={id:string;state:string;report:unknown;previousId?:string;hasModelOrigin?:boolean;usage:{requests:number}};
export function selectSavedAnalysis<T extends SavedAnalysis>(rows:T[],selectedId?:string|null){
  if(selectedId){const selected=rows.find(row=>row.id===selectedId);if(selected)return selected;}
  const byId=new Map(rows.map(row=>[row.id,row]));
  const backed=(row:T)=>{const seen=new Set<string>();let current:T|undefined=row;
    while(current&&!seen.has(current.id)){seen.add(current.id);if(current.report&&(current.usage.requests>0||current.hasModelOrigin===true))return true;current=current.previousId?byId.get(current.previousId):undefined;}
    return false;};
  return rows.find(row=>row.state==='complete'&&backed(row))||rows.find(backed)||rows[0]||null;
}
