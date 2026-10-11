import { readFile, writeFile } from 'node:fs/promises';
const { applications } = JSON.parse(await readFile(new URL('./catalogue.json', import.meta.url), 'utf8'));
const quote = v => `'${String(v).replaceAll("'", "''")}'`;
const rows = new Map();
for (const app of applications) rows.set(app.connector_key, app);
let sql = '-- Generated from the installed open-source library by library/seed.mjs.\n';
for (const [key, app] of rows) {
  const name = key === 'google_workspace' ? 'Google Workspace' : key === 'microsoft_365' ? 'Microsoft 365' : app.name;
  const auth = ['google_workspace','microsoft_365'].includes(key) ? 'oauth2' : app.auth.type === 'custom' ? 'api_key' : app.auth.type;
  sql += `insert into public.platform_connectors(key,name,description,category,status,auth_method,connection_method,is_public) values(${quote(key)},${quote(name)},${quote(app.description.slice(0,500))},${quote(app.category)},'beta',${quote(auth)},'native',true) on conflict(key) do update set status=case when public.platform_connectors.status='planned' then 'beta' else public.platform_connectors.status end;\n`;
}
for (const app of applications) for (const action of app.actions.filter(a=>a.executable)) {
  const permission = ({ crm:'customer.update', finance:'report.read', field:'work_item.schedule', communications:'message.send', studio:'integration.manage', marketing:'marketing.read', support:'support.read', ai:'integration.manage', automations:'integration.manage' })[app.workspace] ?? 'document.create';
  sql += `insert into public.integration_library_actions values(${quote(action.capability)},${quote(app.connector_key)},${quote(app.key)},${quote(permission)},${quote(JSON.stringify(action.inputs))}::jsonb);\n`;
  sql += `insert into public.integration_capability_permissions values(${quote(action.capability)},${quote(permission)}) on conflict(capability_key) do nothing;\n`;
}
const file = new URL('../../../supabase/migrations/20261212000001_open_source_integration_library.sql', import.meta.url);
const base = (await readFile(file,'utf8')).split('-- Generated from the installed open-source library')[0];
await writeFile(file,base+sql);
