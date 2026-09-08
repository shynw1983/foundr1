// PostgreSQL statements may contain semicolons inside function bodies,
// strings and comments. Never split those into independent migrations.
export function splitSqlStatements(sql) {
 const result=[];let start=0,quote='',blockDepth=0,lineComment=false;
 for(let i=0;i<sql.length;i++) {
  if(lineComment){if(sql[i]==='\n')lineComment=false;continue;}
  if(blockDepth){if(sql.slice(i,i+2)==='/*'){blockDepth++;i++;}else if(sql.slice(i,i+2)==='*/'){blockDepth--;i++;}continue;}
  if(quote){if(sql.startsWith(quote,i)){if(quote.length===1&&sql[i+1]===quote){i++;continue;}i+=quote.length-1;quote='';}continue;}
  if(sql.slice(i,i+2)==='--'){lineComment=true;i++;continue;}
  if(sql.slice(i,i+2)==='/*'){blockDepth=1;i++;continue;}
  if(sql[i]==="'"||sql[i]==='"'){quote=sql[i];continue;}
  if(sql[i]==='$'){const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];if(tag){quote=tag;i+=tag.length-1;continue;}}
  if(sql[i]===';'){const statement=sql.slice(start,i).trim();if(statement)result.push(statement);start=i+1;}
 }
 if(quote||blockDepth)throw new Error('Unterminated SQL string or comment');
 const tail=sql.slice(start).trim();if(tail)result.push(tail);
 return result;
}
