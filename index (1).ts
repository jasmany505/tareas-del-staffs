// Optional Discord notifications. Set DISCORD_WEBHOOK_URL as an Edge Function secret.
// This function never accepts a webhook URL from the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return respond({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY");
  const webhook=Deno.env.get("DISCORD_WEBHOOK_URL");
  if(!url||!anon) return respond({error:"Server configuration missing"},500);
  const auth=req.headers.get("Authorization"); if(!auth) return respond({error:"Unauthorized"},401);
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error}=await client.auth.getUser();
  if(error||!user) return respond({error:"Unauthorized"},401);
  const {data:profile}=await client.from("profiles").select("role,active,display_name").eq("id",user.id).maybeSingle();
  if(!profile?.active) return respond({error:"Inactive account"},403);
  if(!webhook) return respond({ok:false,skipped:true,reason:"Discord webhook not configured"});
  let body:any; try{body=await req.json()}catch{return respond({error:"Invalid JSON"},400)}
  const allowed=["task_created","submission_created","submission_reviewed"];
  if(!allowed.includes(body.event)) return respond({error:"Unsupported event"},400);
  const title=String(body.title||body.task_title||"Tarea").slice(0,180);
  const staff=String(body.assignee||body.staff_name||profile.display_name||"Staff").slice(0,80);
  let description="";
  if(body.event==="task_created") description=`Se creó una tarea para **${staff}**.`;
  if(body.event==="submission_created") description=`**${staff}** envió evidencia para **${title}**.`;
  if(body.event==="submission_reviewed") description=`La entrega de **${title}** fue **${body.result==="approved"?"aprobada":"rechazada"}**.${body.review_note?`\nMotivo: ${String(body.review_note).slice(0,500)}`:""}`;
  const res=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"Kronix Staff Tasks",embeds:[{title:"✦ KRONIX NETWORK · Staff Tasks",description,color:body.result==="rejected"?15158332:body.result==="approved"?5763719:11027200,footer:{text:"Notificación automática · No respondas a este mensaje"}}]})});
  if(!res.ok) return respond({error:"Discord webhook returned an error"},502);
  return respond({ok:true});
});
