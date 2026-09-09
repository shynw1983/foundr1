export type ComparisonCell = {state:'available'|'sold_out'|'unknown'|'excluded';reason?:string;readAt?:string};
export type ComparisonRow = {kind:string;targetId:string;label:string;isAvailable:boolean;cells:Record<string,ComparisonCell>;changes:string[]};
export type ComparisonCommand = {platform:string;status:string;payload?:Record<string,unknown>;result?:Record<string,unknown>;updatedAt?:string};
export function buildInventoryComparison(details:Record<string,unknown>,commands:ComparisonCommand[]) {
 const platforms=(details.comparisonPlatforms??[]) as string[];
 const exclusions=(details.comparisonExclusions??[]) as Array<{platform:string;kind:string;targetId:string}>;
 const preview=(details.preview??[]) as Array<{kind:string;targetId:string;label:string;isAvailable:boolean;wasAvailable:boolean|null}>;
 const rows:ComparisonRow[]=preview.map(t=>{
  const cells:Record<string,ComparisonCell>={uber_eats:{state:t.isAvailable?'available':'sold_out',readAt:String(details.previewAt??'')},foundr1:{state:t.wasAvailable===null?'unknown':t.wasAvailable?'available':'sold_out',readAt:String(details.previewAt??'')}};
  for(const platform of platforms) {
   if(exclusions.some(e=>e.platform===platform&&e.kind===t.kind&&e.targetId===t.targetId)) {cells[platform]={state:'excluded'};continue;}
   const command=commands.find(c=>c.platform===platform&&c.payload?.comparisonAudit===true);
   const targets=(command?.payload?.targets??[]) as Array<{kind:string;targetId:string}>;
   const expected=targets.some(x=>x.kind===t.kind&&x.targetId===t.targetId);
   const matches=((command?.result?.items??[]) as Array<Record<string,unknown>>).filter(x=>x.kind===t.kind&&x.targetId===t.targetId);
   const row=matches[0];
   const known=expected&&command?.status==='succeeded'&&matches.length===1&&row.found===true&&typeof row.isAvailable==='boolean'&&row.status===(row.isAvailable?'available':'sold_out');
   cells[platform]=known?{state:row.isAvailable?'available':'sold_out',readAt:command?.updatedAt}:{state:'unknown',reason:!expected?'mapping_missing':command?.status==='succeeded'?'not_found':['queued','pending','processing'].includes(command?.status??'')?'reading':'read_failed',readAt:command?.updatedAt};
  }
  return {...t,cells,changes:Object.entries(cells).filter(([p,c])=>p!=='uber_eats'&&['available','sold_out'].includes(c.state)&&c.state!==cells.uber_eats.state).map(([p])=>p)};
 });
 const pending=commands.some(c=>c.payload?.comparisonAudit===true&&['pending','queued','processing'].includes(c.status));
 const unknown=rows.filter(r=>Object.values(r.cells).some(c=>c.state==='unknown')).length;
 const counts=Object.fromEntries(['foundr1',...platforms].map(p=>[p,rows.filter(r=>r.changes.includes(p)).length]));
 return {rows,platforms,pending,unknown,counts,ready:details.comparisonVersion===1&&rows.length>0&&!pending&&!unknown};
}
