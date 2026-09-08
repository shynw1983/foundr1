import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSqlStatements} from './sql-statements.mjs';
test('Postgres function bodies, quoted identifiers and comments do not split migrations',()=>{
 const statements=splitSqlStatements(`-- comment ;\ncreate function f() returns void language plpgsql as $$ begin perform 'a;b'; end; $$;\n/* nested /* ; */ ; */ select 'it''s;ok', "a;b"; select 3;`);
 assert.equal(statements.length,3);
 assert.match(statements[0],/perform 'a;b'/);
 assert.deepEqual(splitSqlStatements('select $body$one;two$body$; select 2;'),['select $body$one;two$body$','select 2']);
 assert.throws(()=>splitSqlStatements("select 'unterminated"),/Unterminated/);
});
