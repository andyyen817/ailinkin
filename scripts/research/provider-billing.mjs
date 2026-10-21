export function providerBilling(service,route,body){
  if(service!=='apollo')return {unit:'request',upperBound:0};
  if(route==='/api/v1/mixed_companies/search')return {unit:'apollo_credit',upperBound:1};
  if(route==='/api/v1/mixed_people/api_search')return {unit:'apollo_credit',upperBound:0};
  if(['/api/v1/people/match','/api/v1/people/bulk_match'].includes(route)){
    if(body.run_email_waterfall||body.run_phone_waterfall||body.run_waterfall_email||body.run_waterfall_phone)throw Error('WATERFALL_BILLING_UNVERIFIED');
    const people=route.endsWith('/bulk_match')?body.details?.length:1;
    if(!Number.isInteger(people)||people<1||people>10)throw Error('ENRICHMENT_BATCH_INVALID');
    return {unit:'apollo_credit',upperBound:people*(body.reveal_phone_number?9:1),enrichmentPeople:people};
  }
  throw Error('APOLLO_ENDPOINT_BILLING_UNVERIFIED');
}
