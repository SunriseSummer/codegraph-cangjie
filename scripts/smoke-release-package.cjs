#!/usr/bin/env node
// Exercise the actual npm tarballs, including their bundled runtime and MCP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const mainDir = path.resolve(process.argv[2]);
const repo = path.resolve(process.argv[3]);
const expected = require(path.join(repo, 'package.json')).version;
process.env.CODEGRAPH_TELEMETRY = '0';
process.env.DO_NOT_TRACK = '1';
const env = { ...process.env, CODEGRAPH_TELEMETRY: '0', CODEGRAPH_NO_DAEMON: '1', DO_NOT_TRACK: '1' };
const pkg = require(path.join(mainDir, 'package.json'));
assert.equal(pkg.version, expected);
const cli = spawnSync(process.execPath, [path.join(mainDir, 'npm-shim.js'), '--version'], { env, encoding: 'utf8', timeout: 30_000 });
assert.equal(cli.status, 0, cli.stderr);
assert.ok(cli.stdout.includes(expected), cli.stdout);
const platformPkg = require.resolve(`@cangjie-lang/codegraph-${process.platform}-${process.arch}/package.json`, { paths: [mainDir] });
const platformDir = path.dirname(platformPkg);
assert.ok(fs.existsSync(path.join(platformDir, 'lib/kernel/codegraph-kernel.node')));
assert.ok(fs.existsSync(path.join(platformDir, 'lib/dist/viewer/index.html')));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-release-smoke-'));
fs.cpSync(path.join(repo, '__tests__/fixtures/cangjie-1.0.6/codegraph-values'), project, { recursive: true });
const { CodeGraph } = require(mainDir);
function mcp() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(mainDir, 'npm-shim.js'), 'serve', '--mcp', '--no-watch'], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', finished = false, tools = 0;
    const timer = setTimeout(() => finish(new Error('MCP smoke timed out: ' + errors.slice(-500))), 30_000);
    const send = msg => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    function finish(error) {
      if (finished) return; finished = true; clearTimeout(timer); child.kill('SIGTERM');
      child.once('close', () => error ? reject(error) : resolve(tools));
    }
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', finish);
    child.on('close', (code) => { if (!finished) { finished = true; clearTimeout(timer); reject(new Error('MCP exited ' + code + ': ' + errors.slice(-500))); } });
    child.stdout.on('data', chunk => {
      output += chunk;
      let end;
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            assert.equal(msg.result.serverInfo.version, expected);
            send({ method: 'notifications/initialized' });
            send({ id: 2, method: 'tools/list', params: {} });
          } else if (msg.id === 2) {
            tools = msg.result.tools.length;
            assert.ok(msg.result.tools.some(t => t.name === 'codegraph_explore'));
            send({ id: 3, method: 'tools/call', params: { name: 'codegraph_explore', arguments: { query: 'readGlobal' } } });
          } else if (msg.id === 3) {
            assert.ok(!msg.error && !msg.result.isError, JSON.stringify(msg));
            assert.ok(JSON.stringify(msg.result).includes('readGlobal'));
            finish();
          }
        } catch (error) { finish(error); }
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'release-smoke', version: '1' }, rootUri: pathToFileURL(project).href } });
  });
}
(async () => {
  const graph = CodeGraph.initSync(project);
  try {
    await graph.indexAll();
    const one = name => { const nodes = graph.getNodesByName(name); assert.equal(nodes.length, 1, name); return nodes[0]; };
    const targets = (name, kind) => graph.getOutgoingEdges(one(name).id).filter(e => e.kind === kind).map(e => graph.getNode(e.target)?.qualifiedName);
    assert.ok(targets('readGlobal', 'references').includes('engineering::LIMIT'));
    assert.ok(targets('recursive', 'calls').includes('engineering::recursive'));
    assert.ok(!targets('parameterShadow', 'references').includes('engineering::LIMIT'));
    assert.ok(!targets('parameterCallback', 'calls').includes('engineering::handler'));
    const file = path.join(project, 'src/defs.cj');
    fs.writeFileSync(file, '// shipped-package sync probe\n' + fs.readFileSync(file, 'utf8'));
    await graph.sync({ paths: ['src/defs.cj'] });
    assert.ok(targets('readGlobal', 'references').includes('engineering::LIMIT'));
  } finally { graph.close(); }
  const tools = await mcp();
  console.log(JSON.stringify({ package: pkg.name, version: pkg.version, cli: 'passed', sdk: 'passed', cangjieIndexAndSync: 'passed', nativeKernel: true, viewerAssets: true, mcp: 'passed', tools }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(project, { recursive: true, force: true }));
