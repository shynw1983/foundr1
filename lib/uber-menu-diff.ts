import {type UberSourceCatalog,uberContextPrice} from './uber-menu-authority.ts';
import {canonicalMenuValue} from './menu-change-display.ts';
export type MenuChange={kind:string;name:string;field:string;before:string;after:string;sourceKey:string};
export function uberMenuChanges(before:UberSourceCatalog|null,after:UberSourceCatalog):MenuChange[] {
  const flatten=(catalog:UberSourceCatalog|null)=>{
    const rows=new Map<string,{name:string;price?:number;groups:string;groupIds?:string;description?:string;quantity?:string}>();
    if(!catalog)return rows;
    const names=new Map(catalog.entities.map(e=>[e.id,e.name]));
    for(const c of catalog.categories)rows.set(`category:${c.id}`,{name:c.name,groups:c.itemIds.map(id=>names.get(id)??id).join(' / '),groupIds:JSON.stringify(c.itemIds)});
    for(const g of catalog.groups)rows.set(`option_group:${g.id}`,{name:g.name,groups:g.optionIds.map(id=>names.get(id)??id).join(' / '),groupIds:JSON.stringify(g.optionIds),quantity:canonicalMenuValue([g.min,g.max,g.quantityInfo??null])});
    for(const e of catalog.entities) {
      const parents=catalog.groups.filter(g=>g.optionIds.includes(e.id));
      const memberships=parents.length?parents:catalog.categories.filter(c=>c.itemIds.includes(e.id));
      rows.set(`entity:${e.id}`,{name:e.name,price:parents.length?undefined:e.price,description:e.description,groups:memberships.map(g=>g.name).join(' / '),groupIds:JSON.stringify(memberships.map(g=>g.id).sort())});
      for(const g of parents)rows.set(`price:${g.id}:${e.id}`,{name:`${e.name} (${g.name})`,price:uberContextPrice(e,g.id),groups:g.name});
    }
    return rows;
  };
  const old=flatten(before),next=flatten(after),changes:MenuChange[]=[];
  for(const [key,row] of next) {
    const previous=old.get(key);
    if(!previous){if(!key.startsWith('price:'))changes.push({kind:'added',name:row.name,field:'新規',before:'',after:row.groups,sourceKey:key});continue;}
    for(const [field,kind,label] of [['name','renamed','名称'],['price','repriced','価格'],['groups','moved','所属・構成'],['description','updated','説明'],['quantity','updated','数量ルール']] as const) {
      if(key.startsWith('price:')&&field!=='price')continue;
      if(field==='groups'&&previous.groupIds===row.groupIds)continue;
      if(previous[field]!==row[field])changes.push({kind,name:row.name,field:label,before:String(previous[field]??''),after:String(row[field]??''),sourceKey:key});
    }
  }
  for(const [key,row] of old)if(!next.has(key)&&!key.startsWith('price:'))changes.push({kind:'missing',name:row.name,field:'削除候補',before:row.groups,after:'',sourceKey:key});
  return changes;
}
