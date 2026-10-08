'use strict'

var test = require('node:test')
var assert = require('node:assert/strict')
var fs = require('node:fs')
var path = require('node:path')
var plan = require('./plan.js')

var src = 'D:\\素材'
var dest = 'D:\\导出\\字幕'

test('只收清单里的视频和音频，跳过点号文件', function () {
  assert.equal(plan.isMediaName('口播.mp4'), true)
  assert.equal(plan.isMediaName('a.MOV'), true)
  assert.equal(plan.isMediaName('a.MP3'), true)
  assert.equal(plan.isMediaName('a.opus'), true)
  assert.equal(plan.isMediaName('a.jpg'), false)
  assert.equal(plan.isMediaName('a.srt'), false)
  assert.equal(plan.isMediaName('.hidden.mp4'), false)
})

test('保存目录与源相同不跳过，落在源内部才跳过', function () {
  assert.equal(plan.saveDirToSkip(src, src), '')
  assert.equal(plan.saveDirToSkip(src, 'D:\\素材\\输出'), 'D:\\素材\\输出')
  assert.equal(plan.saveDirToSkip(src, 'D:\\别的'), '')
  assert.equal(plan.isInside('D:\\src', 'D:\\src2'), false)
})

test('按相对路径落盘，子目录同名互不覆盖', function () {
  assert.equal(
    plan.outputPath(src, dest, 'D:\\素材\\口播.mp4', 'srt'),
    'D:\\导出\\字幕\\口播.srt',
  )
  assert.equal(
    plan.outputPath(src, dest, 'D:\\素材\\甲\\口播.mp4', 'srt'),
    'D:\\导出\\字幕\\甲\\口播.srt',
  )
  assert.equal(
    plan.outputPath(src, dest, 'D:/素材/乙/口播.mp4', 'txt'),
    'D:\\导出\\字幕\\乙\\口播.txt',
  )
  assert.equal(plan.displayName(src, 'D:\\素材\\甲\\口播.mp4'), '甲/口播.mp4')
  assert.equal(plan.displayName(src, 'D:\\素材\\口播.mp4'), '口播.mp4')
})

test('同时输出时缺一种才补写，覆盖则两种都写', function () {
  assert.deepEqual(plan.pendingExts('srt', { srt: true, txt: false }, false), [])
  assert.deepEqual(plan.pendingExts('both', { srt: true, txt: false }, false), ['txt'])
  assert.deepEqual(plan.pendingExts('both', { srt: true, txt: true }, false), [])
  assert.deepEqual(plan.pendingExts('both', { srt: true, txt: true }, true), ['srt', 'txt'])
  assert.deepEqual(plan.pendingExts('txt', { txt: false }, false), ['txt'])
})

test('TXT 每句一行，不带时间', function () {
  assert.equal(
    plan.cuesToTxt([
      { startUs: 0, endUs: 1000, text: '大家好' },
      { startUs: 1000, endUs: 2000, text: ' 第二句 ' },
    ]),
    '大家好\n第二句\n',
  )
  assert.equal(plan.cuesToTxt([]), '')
  assert.equal(plan.hasSpeech({ ok: true, cues: [], srt: '' }), false)
  assert.equal(plan.hasSpeech({ ok: true, cues: [{ text: '啊' }], srt: '1\n' }), true)
})

test('拖放优先读文件路径，文件落到所在目录', function () {
  var drop = require('./folderDropPath.js')
  assert.equal(drop.fileUrlToPath('file:///C:/Users/me/My%20Clips'), 'C:\\Users\\me\\My Clips')
  assert.equal(drop.parentDir('D:\\素材\\口播.mp4'), 'D:\\素材')
  assert.equal(drop.hasLikelyFileExtension('D:\\素材'), false)
  assert.deepEqual(
    drop.collectDroppedPaths({
      files: [{ path: 'D:\\素材' }],
      getData: function () { return 'file:///C:/ignored' },
    }),
    ['D:\\素材'],
  )
  assert.equal(drop.countForeignDropItems(['D:\\素材\\a.mp4', 'E:\\别的'], 'D:\\素材'), 1)
})

test('进度阶段对应状态词', function () {
  assert.equal(plan.statusFromPhase('extract'), '提取音频')
  assert.equal(plan.statusFromPhase('transcribe'), '识别中')
})

test('页面不提供模型、语种或 Whisper 安装', function () {
  var root = path.join(__dirname, '..')
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  var app = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8')
  var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  var blob = html + '\n' + app
  assert.equal(manifest.id, 'com.pixiucut.batchsubtitle')
  assert.equal(manifest.name, '批量识别字幕')
  assert.deepEqual(manifest.permissions.sort(), [
    'asr.transcribe',
    'fs.read',
    'fs.write',
    'media.probe',
    'ui.notify',
    'ui.pickDirectory',
    'ui.shell',
  ].sort())
  ;['Whisper', '语种', 'ggml', 'Tiny'].forEach(function (word) {
    assert.equal(blob.indexOf(word), -1, word)
  })
  assert.match(html, /folderDropPath\.js/)
  assert.match(html, /拖入/)
  assert.match(html, /id="btn-start"/)
  assert.match(html, /id="btn-stop"/)
  assert.match(html, /id="format"/)
  assert.match(html, /id="overwrite"/)
  assert.match(app, /asr\.transcribe\(row\.path\)/)
  assert.doesNotMatch(app, /extractAudio/)
  assert.doesNotMatch(app, /streamIndex/)
})

test('助手参数必须自带路径，覆盖开关是布尔值', function () {
  var ok = plan.normalizeBatchArgs({
    sourceDir: ' D:\\素材 ',
    destDir: 'D:\\字幕',
    includeSubfolders: true,
    format: 'BOTH',
    overwrite: false,
  })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, {
    sourceDir: 'D:\\素材',
    destDir: 'D:\\字幕',
    includeSubfolders: true,
    format: 'both',
    overwrite: false,
  })
  assert.equal(plan.normalizeBatchArgs({ destDir: 'D:\\字幕' }).code, 'INVALID_PARAM')
  assert.equal(plan.normalizeBatchArgs({ sourceDir: 'D:\\素材', destDir: 'D:\\字幕', format: 'vtt' }).code, 'INVALID_PARAM')
  assert.equal(plan.normalizeBatchArgs({ sourceDir: 'D:\\素材', destDir: 'D:\\字幕', overwrite: 'true' }).code, 'INVALID_PARAM')
  assert.equal(plan.normalizeBatchArgs({ sourceDir: 'D:\\素材', destDir: 'D:\\字幕' }).value.overwrite, false)
  assert.equal(plan.normalizeBatchArgs({ sourceDir: 'D:\\素材', destDir: 'D:\\字幕' }).value.format, 'srt')
})

test('任务查询按 jobId 对上当前这一批，并汇总每行状态', function () {
  var job = {
    id: 'batch-1',
    phase: 'running',
    sourceDir: 'D:\\素材',
    destDir: 'D:\\字幕',
    format: 'srt',
    includeSubfolders: false,
    overwrite: false,
    message: '正在处理 1/2',
  }
  assert.equal(plan.matchBatchJob('', null).code, 'NOT_FOUND')
  assert.equal(plan.matchBatchJob('batch-2', job).code, 'NOT_FOUND')
  assert.equal(plan.matchBatchJob('batch-1', job).ok, true)
  assert.equal(plan.matchBatchJob(undefined, job).ok, true)
  var snap = plan.summarizeBatch(job, [
    { name: 'a.mp4', path: 'D:\\素材\\a.mp4', status: '完成', progress: '100%', detail: '' },
    { name: 'b.mp4', path: 'D:\\素材\\b.mp4', status: '识别中', progress: '40%', detail: '' },
  ])
  assert.equal(snap.ok, true)
  assert.equal(snap.jobId, 'batch-1')
  assert.equal(snap.fileCount, 2)
  assert.equal(snap.counts.done, 1)
  assert.equal(snap.counts.recognizing, 1)
  assert.equal(snap.current.name, 'b.mp4')
})

test('清单里的助手工具与登记名单一致，处理函数不弹文件框', function () {
  var root = path.join(__dirname, '..')
  var app = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8')
  var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  var names = manifest.mcp.tools.map(function (tool) { return tool.name })
  assert.deepEqual(names, plan.MCP_TOOLS)
  var localName = /^[a-z][a-z0-9_]{0,47}$/
  manifest.mcp.tools.forEach(function (tool) {
    assert.match(tool.name, localName)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 0 && tool.description.length <= 512)
    assert.equal(tool.inputSchema.type, 'object')
  })
  assert.deepEqual(manifest.mcp.tools[0].inputSchema.required, ['sourceDir', 'destDir'])
  function fnBody(source, name) {
    var asyncMark = 'async function ' + name + '('
    var syncMark = 'function ' + name + '('
    var start = source.indexOf(asyncMark)
    var mark = asyncMark
    if (start < 0) {
      start = source.indexOf(syncMark)
      mark = syncMark
    }
    assert.ok(start >= 0, name)
    var rest = source.slice(start + mark.length)
    var cuts = []
    var nextAsync = rest.search(/\n  async function /)
    var nextSync = rest.search(/\n  function /)
    if (nextAsync >= 0) cuts.push(nextAsync)
    if (nextSync >= 0) cuts.push(nextSync)
    var end = cuts.length ? Math.min.apply(null, cuts) : rest.length
    return source.slice(start, start + mark.length + end)
  }
  ;['mcpStart', 'mcpStatus', 'mcpStop'].forEach(function (name) {
    var body = fnBody(app, name)
    assert.doesNotMatch(body, /pickDirectory|pickFiles|askOverwrite/)
  })
  assert.match(fnBody(app, 'registerMcp'), /P\.MCP_TOOLS/)
  assert.match(fnBody(app, 'registerMcp'), /mcp\.register/)
  var boot = fnBody(app, 'boot')
  assert.ok(boot.indexOf('await loadPrefs()') < boot.indexOf('await registerMcp()'))
  assert.ok(boot.indexOf('await registerMcp()') < boot.indexOf('await ensureModel()'))
  var catalogPath = path.join(__dirname, '../../../frontend/src/agent/catalog.tools.json')
  if (fs.existsSync(catalogPath)) {
    var catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    var core = {}
    catalog.forEach(function (tool) { if (tool && tool.name) core[tool.name] = true })
    plan.MCP_TOOLS.forEach(function (name) {
      assert.equal(core[name], undefined, name)
    })
  }
})
