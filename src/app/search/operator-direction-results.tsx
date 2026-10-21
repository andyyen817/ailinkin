'use client';
import {useEffect,useState} from 'react';
export function OperatorDirectionResults({batch,busy,owner,onSelect}:{batch:any;busy:boolean;owner:boolean;onSelect:(ids:string[])=>void}){
  const [ids,setIds]=useState<string[]>([]);
  useEffect(()=>setIds([]),[batch.id]);
  const companies=batch.companyChoices||[];
  return <section aria-label="本批企业搜索结果">
    <p>企业搜索 {batch.usage.companies||0} 次 · 国家解析 {batch.usage.locations||0} 次 · 保存企业候选 {companies.length} 家</p>
    <p>岗位偏好：{batch.direction?.roles?.join('、')||'不限'}。偏好只影响补查顺序，其他岗位仍保留。</p>
    {batch.state==='selecting'&&<><h3>选择要查联系人的企业</h3><p>已保存供应商返回的企业候选；总部地区与关键词匹配不代表已经确认采购需求。最多选 {batch.limits.pages} 家。</p>
      <fieldset disabled={busy||!owner}><div className="operator-table"><table><thead><tr><th>选择</th><th>企业／官网</th><th>供应商简介与待核事项</th></tr></thead><tbody>
        {companies.map((c:any)=><tr key={c.id}><td><input type="checkbox" aria-label={`采集 ${c.name} 的联系人`} checked={ids.includes(c.id)} disabled={!ids.includes(c.id)&&ids.length>=batch.limits.pages} onChange={()=>setIds(old=>old.includes(c.id)?old.filter(id=>id!==c.id):[...old,c.id])}/></td><td><strong>{c.name}</strong><br/><a href={c.website} target="_blank" rel="noreferrer">{c.domain}</a></td><td>{c.summary}<p>是否适合你的产品、采购负责人及采购意向待核实。</p></td></tr>)}
      </tbody></table></div><button disabled={busy||!owner} onClick={()=>onSelect(ids)}>{ids.length?`查所选 ${ids.length} 家的联系人`:'结束本批，仅保存企业线索'}</button></fieldset>
    </>}
    {batch.state==='blocked'&&<p>本批已停止，原结果和失败计数保留。先处理上方提示；结果未知的请求不自动重发。可在本页为新批次重新确认限额。</p>}
    {batch.state==='done'&&!batch.people.length&&<p>本批没有取得个人联系资料，已保留企业搜索回执。导出不会把企业候选写成个人联系方式。</p>}
  </section>;
}
