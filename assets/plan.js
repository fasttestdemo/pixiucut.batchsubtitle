/**
 * 批量识别字幕：扩展名、相对路径、跳过已有结果、TXT 拼行。
 * 不调用宿主。浏览器挂 globalThis.BatchSubtitlePlan，Node 走 module.exports。
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.BatchSubtitlePlan = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  var VIDEO_EXTS = ['mp4', 'm4v', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'flv', 'ts', 'm2ts', 'mpeg', 'mpg']
  var AUDIO_EXTS = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'wma', 'opus']
  var MEDIA_EXTS = VIDEO_EXTS.concat(AUDIO_EXTS)

  var READY_BANNER = '语音识别使用本地语音模型，不上云，支持单机离线使用。'
  var BUSY_MESSAGE = '正在识别，请等当前一条结束'

  function sepOf(p) {
    return String(p).indexOf('\\') >= 0 ? '\\' : '/'
  }

  function stripSlash(p) {
    return String(p || '').replace(/[\\/]+$/, '')
  }

  function toSlash(p) {
    return stripSlash(p).replace(/\\/g, '/')
  }

  function joinPath(dir, name) {
    if (!dir) return name
    return stripSlash(dir) + sepOf(dir) + name
  }

  function basename(p) {
    var parts = String(p || '').split(/[\\/]/)
    return parts[parts.length - 1] || ''
  }

  function dirname(p) {
    var s = stripSlash(p)
    var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
    if (i < 0) return ''
    if (i === 2 && /^[A-Za-z]:[\\/]/.test(s)) return s.slice(0, 3)
    if (i === 0) return s.slice(0, 1)
    return s.slice(0, i)
  }

  function extOf(name) {
    var base = basename(name)
    var i = base.lastIndexOf('.')
    return i > 0 ? base.slice(i + 1).toLowerCase() : ''
  }

  function stemOf(name) {
    var base = basename(name)
    var i = base.lastIndexOf('.')
    return i > 0 ? base.slice(0, i) : base
  }

  function samePath(a, b) {
    return toSlash(a).toLowerCase() === toSlash(b).toLowerCase()
  }

  function isInside(parent, target) {
    var p = toSlash(parent).toLowerCase()
    var t = toSlash(target).toLowerCase()
    if (!p || !t) return false
    return t === p || t.indexOf(p + '/') === 0
  }

  function isDotName(name) {
    return String(name || '').charAt(0) === '.'
  }

  function isMediaName(name) {
    if (isDotName(name)) return false
    return MEDIA_EXTS.indexOf(extOf(name)) >= 0
  }

  /** 保存目录落在源树内部时返回它，扫描要跳过。与源相同则不跳过（字幕扩展名不会被扫进来）。 */
  function saveDirToSkip(src, save) {
    if (!src || !save) return ''
    if (samePath(src, save)) return ''
    if (isInside(src, save)) return save
    return ''
  }

  /** 文件相对源目录的父路径，用 /。顶层文件返回空串。 */
  function relativeParent(srcRoot, filePath) {
    var src = toSlash(srcRoot)
    var parent = toSlash(dirname(filePath))
    if (!src || samePath(src, parent)) return ''
    var srcLower = src.toLowerCase()
    var parentLower = parent.toLowerCase()
    if (parentLower.indexOf(srcLower + '/') === 0) {
      return parent.slice(src.length).replace(/^[/]+/, '')
    }
    return ''
  }

  function displayName(srcRoot, filePath) {
    var src = toSlash(srcRoot)
    var file = String(filePath || '').replace(/\\/g, '/')
    var srcLower = src.toLowerCase()
    var fileLower = file.toLowerCase()
    if (src && (fileLower === srcLower || fileLower.indexOf(srcLower + '/') === 0)) {
      return file.slice(src.length).replace(/^[/]+/, '')
    }
    return basename(filePath)
  }

  function outputPath(srcRoot, destRoot, filePath, ext) {
    var rel = relativeParent(srcRoot, filePath)
    var dest = stripSlash(destRoot)
    var dir = dest
    if (rel) dir = joinPath(dest, rel.replace(/\//g, sepOf(dest)))
    var dot = String(ext || '').charAt(0) === '.' ? String(ext) : '.' + ext
    return joinPath(dir, stemOf(filePath) + dot)
  }

  function wantedExts(format) {
    if (format === 'txt') return ['txt']
    if (format === 'both') return ['srt', 'txt']
    return ['srt']
  }

  /**
   * 还要写哪些扩展名。overwrite 时全部重写。
   * 同时输出时，两个都已存在才是空数组（调用方标已跳过）。
   */
  function pendingExts(format, exists, overwrite) {
    var all = wantedExts(format)
    if (overwrite) return all.slice()
    var pending = []
    for (var i = 0; i < all.length; i += 1) {
      if (!exists || !exists[all[i]]) pending.push(all[i])
    }
    return pending
  }

  function cuesToTxt(cues) {
    if (!cues || !cues.length) return ''
    var lines = []
    for (var i = 0; i < cues.length; i += 1) {
      var text = cues[i] && typeof cues[i].text === 'string' ? cues[i].text.trim() : ''
      if (text) lines.push(text)
    }
    return lines.length ? lines.join('\n') + '\n' : ''
  }

  function hasSpeech(result) {
    return !!(result && result.ok && result.cues && result.cues.length)
  }

  function statusFromPhase(phase) {
    return phase === 'extract' ? '提取音频' : '识别中'
  }

  /** 与 manifest.mcp.tools 同名同集。登记时按这个名单，少一条或多一条宿主都会拒绝。 */
  var MCP_TOOLS = ['start_subtitle_batch', 'subtitle_batch_status', 'stop_subtitle_batch']

  var STATUS_KEYS = {
    '等待': 'waiting',
    '提取音频': 'extracting',
    '识别中': 'recognizing',
    '完成': 'done',
    '已跳过': 'skipped',
    '没有识别到人声': 'silent',
    '已停止': 'stopped',
    '失败': 'failed',
  }

  function normalizeBatchArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, code: 'INVALID_PARAM', message: '参数必须是对象' }
    }
    var sourceDir = typeof args.sourceDir === 'string' ? args.sourceDir.trim() : ''
    var destDir = typeof args.destDir === 'string' ? args.destDir.trim() : ''
    if (!sourceDir || !destDir) {
      return { ok: false, code: 'INVALID_PARAM', message: '需要 sourceDir 和 destDir 两个绝对路径' }
    }
    var format = 'srt'
    if (args.format != null && args.format !== '') {
      if (typeof args.format !== 'string') {
        return { ok: false, code: 'INVALID_PARAM', message: 'format 只能是 srt、txt 或 both' }
      }
      format = args.format.toLowerCase()
      if (format !== 'srt' && format !== 'txt' && format !== 'both') {
        return { ok: false, code: 'INVALID_PARAM', message: 'format 只能是 srt、txt 或 both' }
      }
    }
    if (args.includeSubfolders != null && typeof args.includeSubfolders !== 'boolean') {
      return { ok: false, code: 'INVALID_PARAM', message: 'includeSubfolders 必须是布尔值' }
    }
    if (args.overwrite != null && typeof args.overwrite !== 'boolean') {
      return { ok: false, code: 'INVALID_PARAM', message: 'overwrite 必须是布尔值' }
    }
    return {
      ok: true,
      value: {
        sourceDir: sourceDir,
        destDir: destDir,
        includeSubfolders: !!args.includeSubfolders,
        format: format,
        overwrite: !!args.overwrite,
      },
    }
  }

  function matchBatchJob(jobId, job) {
    if (!job || !job.id) return { ok: false, code: 'NOT_FOUND', message: '还没有识别任务' }
    var id = typeof jobId === 'string' ? jobId.trim() : ''
    if (id && id !== job.id) return { ok: false, code: 'NOT_FOUND', message: '没有这一批任务' }
    return { ok: true }
  }

  function summarizeBatch(job, rows) {
    var list = []
    var counts = {
      waiting: 0,
      extracting: 0,
      recognizing: 0,
      done: 0,
      skipped: 0,
      silent: 0,
      stopped: 0,
      failed: 0,
    }
    var current = null
    var items = rows || []
    for (var i = 0; i < items.length; i += 1) {
      var row = items[i] || {}
      var status = typeof row.status === 'string' ? row.status : '等待'
      var item = {
        name: row.name || '',
        path: row.path || '',
        status: status,
        progress: row.progress || '—',
        detail: row.detail || '',
      }
      list.push(item)
      var key = STATUS_KEYS[status]
      if (key) counts[key] += 1
      if (status === '提取音频' || status === '识别中') current = item
    }
    return {
      ok: true,
      jobId: job && job.id ? job.id : '',
      phase: job && job.phase ? job.phase : '',
      sourceDir: job && job.sourceDir ? job.sourceDir : '',
      destDir: job && job.destDir ? job.destDir : '',
      format: job && job.format ? job.format : 'srt',
      includeSubfolders: !!(job && job.includeSubfolders),
      overwrite: !!(job && job.overwrite),
      fileCount: list.length,
      counts: counts,
      message: job && job.message ? job.message : '',
      current: current,
      files: list,
    }
  }

  return {
    VIDEO_EXTS: VIDEO_EXTS,
    AUDIO_EXTS: AUDIO_EXTS,
    MEDIA_EXTS: MEDIA_EXTS,
    READY_BANNER: READY_BANNER,
    BUSY_MESSAGE: BUSY_MESSAGE,
    joinPath: joinPath,
    basename: basename,
    dirname: dirname,
    extOf: extOf,
    stemOf: stemOf,
    samePath: samePath,
    isInside: isInside,
    isDotName: isDotName,
    isMediaName: isMediaName,
    saveDirToSkip: saveDirToSkip,
    relativeParent: relativeParent,
    displayName: displayName,
    outputPath: outputPath,
    wantedExts: wantedExts,
    pendingExts: pendingExts,
    cuesToTxt: cuesToTxt,
    hasSpeech: hasSpeech,
    statusFromPhase: statusFromPhase,
    MCP_TOOLS: MCP_TOOLS,
    normalizeBatchArgs: normalizeBatchArgs,
    matchBatchJob: matchBatchJob,
    summarizeBatch: summarizeBatch,
  }
})
