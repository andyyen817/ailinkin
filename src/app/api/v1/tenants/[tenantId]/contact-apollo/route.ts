import {z} from 'zod';
import {json,failure,mutationOrigin} from '@/server/http';
import {apolloContactStatus,runApolloContacts} from '@/server/contact-apollo-service';
export const runtime='nodejs';export const maxDuration=90;
type Context={params:Promise<{tenantId:string}>};
export async function GET(request:Request,{params}:Context){try{const {tenantId}=await params,id=z.uuid().parse(new URL(request.url).searchParams.get('campaignId'));return json(await apolloContactStatus(request,tenantId,id));}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){try{mutationOrigin(request);const {tenantId}=await params;
 const body=await request.text();if(body.length>4096)throw Error('INPUT_TOO_LARGE');const input=z.object({campaignId:z.uuid()}).strict().parse(JSON.parse(body));
 return json(await runApolloContacts(request,tenantId,input.campaignId));}catch(e){return failure(e);}}
