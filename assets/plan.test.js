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
