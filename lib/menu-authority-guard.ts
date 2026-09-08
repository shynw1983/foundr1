import { sql } from './db';

/** Check both the persisted owner and requested brand: changing brandId cannot
 * bypass source ownership. Stock and local operational settings remain editable. */
export async function menuAuthorityWriteBlocked(body: Record<string, unknown>) {
  const kind = String(body.kind ?? '');
  if (!['source','category','item','group','option','sortOrder','externalPlatform','platformTargetSetting','adoptPlatformState','platformObjectMapping','platformImportCandidate'].includes(kind)) return false;
  const id = String(body.id ?? '');
  const rows = await sql`
    select id from menu_uber_sources sources where enabled=true and (
      brand_id::text=${String(body.brandId ?? '')}
      or brand_id in (select brand_id from menu_catalog_items where id::text=${id} and ${kind==='item'})
      or brand_id in (select brand_id from menu_categories where id::text=${id} and ${kind==='category'})
      or brand_id in (select brand_id from menu_option_groups where id::text=${id} and ${kind==='group'})
      or brand_id in (select g.brand_id from menu_option_groups g left join menu_options o on o.option_group_id=g.id where ${kind==='option'} and (o.id::text=${id} or g.id::text=${String(body.optionGroupId??'')}))
      or brand_id in (select brand_id from menu_sources where id::text=${id} and ${kind==='source'})
      or brand_id in (select brand_id from menu_external_platforms where id::text in (${id},${String(body.externalPlatformId??'')}) and ${['externalPlatform','platformTargetSetting','adoptPlatformState','platformObjectMapping','platformImportCandidate'].includes(kind)})
    ) limit 1`;
  return rows.length>0;
}

export const MENU_AUTHORITY_MESSAGE = 'このブランドのメニュー原本は Uber です。名称・構成・追加・削除は Uber で変更してください。OS 基準価格は Uber 連携の価格設定から変更できます。';
