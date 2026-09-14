import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const server = resolve('src/mcp.js');
const version = '2026-07-28';
const metadata = (v = version) => ({
  'io.modelcontextprotocol/protocolVersion': v,
  'io.modelcontextprotocol/clientCapabilities': {},
});
const request = (id, method, params = {}) => ({jsonrpc:'2.0',id,method,params:{_meta:metadata(),...params}});
function exchange(messages, cwd = process.cwd(), home) {
  const result = spawnSync(process.execPath,[server],{
    cwd, env:{...process.env, ...(home ? {DIRF_HOME:home} : {})},
    input:messages.map(m=>typeof m==='string'?m:JSON.stringify(m)).join('\n')+'\n',
    encoding:'utf8', timeout:10000,
  });
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}

test('modern discovery and tool listing work without initialization', () => {
  const [discovery,list] = exchange([request(0,'server/discover'),request(1,'tools/list')]);
  assert.equal(discovery.id,0);
  assert.deepEqual(discovery.result.supportedVersions,[version,'2024-11-05']);
  for (const response of [discovery,list]) {
    assert.equal(response.result.resultType,'complete');
    assert.equal(response.result.cacheScope,'private');
    assert.equal(response.result.ttlMs,0);
    assert.equal(response.result._meta['io.modelcontextprotocol/serverInfo'].name,'dirf');
  }
  assert.ok(list.result.tools.some(tool=>tool.name==='dirf_read_assignment'));
});

test('versions and capabilities are validated per request, with no inherited modern context', () => {
  const responses = exchange([
    request(1,'tools/list'),
    request(2,'tools/list',{_meta:metadata('2099-01-01')}),
    request(3,'tools/list',{_meta:{'io.modelcontextprotocol/protocolVersion':version}}),
    {jsonrpc:'2.0',id:4,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'legacy',version:'1'}}},
    {jsonrpc:'2.0',id:5,method:'tools/list'},
    request(6,'tools/list'),
  ]);
  assert.equal(responses[1].error.code,-32022);
  assert.ok(responses[1].error.data.supported.includes(version));
  assert.equal(responses[2].error.code,-32602);
  assert.equal(responses[3].result.protocolVersion,'2024-11-05');
  assert.equal(responses[4].result.resultType,undefined);
  assert.equal(responses[5].result.resultType,'complete');
});

test('invalid requests are specific, notifications never execute calls, and zero IDs get errors', () => {
  const results = exchange([
    '{broken', null, [],
    request(0,'unknown'),request(4,'tools/call'),
    request(5,'tools/call',{name:'not_a_tool'}),
    {jsonrpc:'2.0',method:'tools/call',params:{name:'dirf_write_handoff',arguments:{content:'must not run'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    request(6,'tools/list'),
  ]);
  assert.deepEqual(results.map(r=>r.error?.code ?? 'ok'),[-32700,-32600,-32600,-32601,-32602,-32602,'ok']);
  assert.equal(results[3].id,0);
});

test('modern execution failures use isError; invalid version cannot write state', () => {
  const folder = mkdtempSync(join(tmpdir(),'dirf-protocol-'));
  const home = join(folder,'store');
  try {
    const setup = spawnSync(process.execPath,[resolve('src/cli.js'),'setup',folder],{env:{...process.env,DIRF_HOME:home},encoding:'utf8',timeout:30000});
    assert.equal(setup.status,0,setup.stderr);
    const seed = join(folder,'seed.md');
    writeFileSync(seed,'# Original checkpoint\n');
    const written = spawnSync(process.execPath,[resolve('src/cli.js'),'state','write-handoff','--file',seed],{cwd:folder,env:{...process.env,DIRF_HOME:home},encoding:'utf8',timeout:30000});
    assert.equal(written.status,0,written.stderr);
    const results = exchange([
      request(1,'tools/call',{_meta:metadata('2099-01-01'),name:'dirf_write_handoff',arguments:{content:'overwrite'}}),
      request(2,'tools/call',{name:'dirf_read_handoff'}),
      request(3,'tools/call',{name:'dirf_read_assignment',arguments:{attempt:'missing'}}),
      request(4,'tools/call',{name:'dirf_write_handoff',arguments:{content:42}}),
      request(5,'tools/call',{name:'dirf_read_handoff'}),
    ],folder,home);
    assert.equal(results[0].error.code,-32022);
    assert.equal(results[1].result.structuredContent.content,'# Original checkpoint\n');
    assert.equal(results[1].result.isError,false);
    assert.equal(results[2].result.isError,true);
    assert.equal(results[2].result.resultType,'complete');
    assert.equal(results[3].result.isError,true);
    assert.equal(results[4].result.structuredContent.content,'# Original checkpoint\n');

    const checkpoint = '# Modern checkpoint\nDecision: keep isolated\nNext: recover in fresh process\n';
    const saved = exchange([request(6,'tools/call',{name:'dirf_write_handoff',arguments:{content:checkpoint}})],folder,home);
    assert.equal(saved[0].result.isError,false);
    const recovered = exchange([request(7,'tools/call',{name:'dirf_read_handoff'})],folder,home);
    assert.equal(recovered[0].result.structuredContent.content,checkpoint);
    assert.deepEqual(JSON.parse(recovered[0].result.content[0].text),recovered[0].result.structuredContent);
  } finally { rmSync(folder,{recursive:true,force:true}); }
});

test('modern stale progress returns a tool error while preserving the accepted checkpoint', () => {
  const folder = mkdtempSync(join(tmpdir(),'dirf-modern-progress-'));
  const home = join(folder,'store');
  const run = (cmd,args) => {
    const result = spawnSync(cmd,args,{cwd:folder,env:{...process.env,DIRF_HOME:home},encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr);
    return result.stdout.trim();
  };
  const cli = (...args) => run(process.execPath,[resolve('src/cli.js'),...args]);
  try {
    run('git',['init','-q']);
    run('git',['config','user.name','Fixture']);
    run('git',['config','user.email','fixture@example.invalid']);
    writeFileSync(join(folder,'value.txt'),'A');
    run('git',['add','value.txt']); run('git',['commit','-qm','A']);
    const a = run('git',['rev-parse','HEAD']);
    writeFileSync(join(folder,'value.txt'),'B');
    run('git',['commit','-qam','B']);
    const b = run('git',['rev-parse','HEAD']);
    cli('setup',folder);
    const attempt = JSON.parse(cli('build','test-progress','document the fixture','--json')).attempt.id;
    const progress = (id,revision,message) => request(id,'tools/call',{name:'dirf_record_progress',arguments:{attempt,message,nextAction:'Review',workItem:'pr:1',reviewRevision:revision}});
    const results = exchange([progress(1,b,'current'),progress(2,a,'stale'),request(3,'tools/call',{name:'dirf_read_handoff'})],folder,home);
    assert.equal(results[0].result.isError,false);
    assert.equal(results[1].result.isError,true);
    assert.equal(results[1].result.structuredContent.recorded,false);
    assert.equal(results[1].result.structuredContent.reason,'stale_review_revision');
    assert.match(results[2].result.structuredContent.content,new RegExp(b));
    assert.doesNotMatch(results[2].result.structuredContent.content,/stale/);
  } finally { rmSync(folder,{recursive:true,force:true}); }
});
