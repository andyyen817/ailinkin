export function competitorRoleLabel(role:unknown){
 return role==='direct'?'同类竞争候选':role==='substitute'?'替代方案':'关系待核实';
}
