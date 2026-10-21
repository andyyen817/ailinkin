export const MARKET_DATA_CONTRACT = 'market-data-v3';
export const MARKET_SCHEMA_ERROR = 'MARKET_MODEL_RETURNED_SCHEMA';
export const MARKET_SCHEMA_MESSAGE = '模型返回格式错误，未生成市场分析。原资料和报告已保留；本次已计入模型额度，系统不会自动重发。';
export const MARKET_INCOMPLETE_MESSAGE = '模型输出未完整返回，报告尚未完成。原报告和响应已保留；本次已计入模型额度，系统不会自动重发。';

export function assertMarketModelData(raw: unknown) {
  if (raw && typeof raw === 'object' && ('$schema' in raw || ('properties' in raw && 'type' in raw))) {
    throw Error(MARKET_SCHEMA_ERROR);
  }
}

export function marketDataOutputContract(schema: unknown) {
  const bounded = JSON.parse(JSON.stringify(schema));
  function constrain(node: any) {
    if (!node || typeof node !== 'object') return;
    for (const [key, spec] of Object.entries(node.properties || {}) as [string, any][]) {
      if (['text','quote','summary'].includes(key)) spec.maxLength = key === 'quote' ? 200 : 240;
      if (spec.type === 'array') spec.maxItems = Math.min(spec.maxItems || 3, key === 'references' ? 2 : 3);
    }
    Object.values(node).forEach(constrain);
  }
  constrain(bounded);
  const unknown = {text: '缺少证据，待核实', kind: 'unknown', references: []};
  const example = {
    summary: '根据实际企业与目标市场资料填写结论', buyers: [unknown], channels: [],
    competitors: [], competitiveness: [], unknowns: ['尚缺的资料'], nextActions: ['下一步核实事项'],
    offerings: [{name: '实际产品或服务名称', description: unknown, applications: [unknown]}],
    usps: [{product: '实际产品名称', feature: unknown, value: unknown, comparison: unknown}],
    entryConditions: [{topic: '实际进入条件', requirement: unknown, ourReadiness: unknown, action: '具体核实行动'}],
    searchRecommendations: [],
  };
  return '输出JSON业务数据对象，必须包含summary、buyers、channels、competitors、competitiveness、unknowns、nextActions及四个计划章节。'
    + '下面仅是数据格式示例；用sources的真实内容填写，不照抄占位文字。事实逐字引用实际sourceId及quote：'
    + JSON.stringify(example)
    + '\n下面是校验数据用的JSON Schema，绝不是应输出的内容。不得输出或复制$schema、type、properties、required。'
    + '只返回紧凑JSON，不缩进；text不超过240字，quote必须8至200字，每项最多两条引用，不删除否定或条件。'
    + '同一产品的材料、功能和参数不得拆成多个产品。当地经营引用须明确包含目标国家；不同用途企业只作相邻领域参考，不能凑竞争项。'
    + '缺项明确unknown，不能编造竞争者或当地经营事实：' + JSON.stringify(bounded);
}
