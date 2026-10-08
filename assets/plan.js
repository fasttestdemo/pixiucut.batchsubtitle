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
  }
})
